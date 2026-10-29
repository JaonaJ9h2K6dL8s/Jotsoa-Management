import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import {
  assertCoupeWrite, assertCoupeAdmin, requireId, requirePositive,
} from './common';

/**
 * Relevés de mesure atelier (phase 5.1) — module ADDITIF.
 *
 * Sémantique validée :
 * - pesée primaire sur le ROULEAU : `roll_weight_before_kg` (rouleau
 *   entier avant déroulage) et `roll_weight_after_kg` (rouleau RESTANT
 *   après coupe) — jamais une pesée du tissu déroulé au sol ;
 * - `consumed_kg = before − after` est une valeur DE SESSION, calculée
 *   une seule fois à la finalisation et jamais répartie artificiellement
 *   entre les plans d'une session multi-plans ;
 * - le poids des pièces et des chutes est un contrôle diagnostique
 *   facultatif, jamais une égalité obligatoire ; l'écart de bilan est
 *   DRAPEAU (jamais correction automatique, jamais invalidation
 *   arbitraire d'une mesure physique fiable) ;
 * - cycle de vie : brouillon (partiel, éditable, aucun indicateur) →
 *   complet (figé, indicateurs débloqués) → invalidé (motif obligatoire,
 *   hors indicateurs, jamais supprimé) ; correction = nouvelle version
 *   liée par replaces_id, l'ancienne passe en invalidé « Remplacée » ;
 * - ce module N'ÉCRIT JAMAIS dans coupe_rolls, coupe_roll_movements ni
 *   marker_plans : le stock reste piloté par les mouvements (phase 3).
 *
 * Tolérance du bilan (paramètre, ne touche pas à la consommation) :
 *   tol = max(3 × sqrt(u_avant² + u_après²), plancher)
 * avec u lu dans app_meta (0,1 kg SUPPOSÉ, à confirmer par l'atelier —
 * aucune balance n'est présumée conforme a priori) et plancher 0,3 kg.
 */

interface SessionRow {
  id: number;
  roll_id: number;
  status: 'brouillon' | 'complet' | 'invalide';
  roll_weight_before_kg: number | null;
  roll_weight_after_kg: number | null;
  consumed_kg: number | null;
  measured_gsm: number | null;
  measured_width_cm: number | null;
  instrument: string | null;
  bilan_flag: 'ok' | 'bilan_ecart' | null;
  bilan_comment: string | null;
  operator_id: number;
  finalized_by: number | null;
  finalized_at: string | null;
  invalide_reason: string | null;
  replaces_id: number | null;
  notes: string | null;
}

interface RecordRow {
  id: number;
  session_id: number;
  plan_id: number;
  roll_id: number;
  length_used_m: number | null;
  chutes_kg: number | null;
  pieces_kg: number | null;
}

export interface BilanTolerance {
  /** Incertitude de pesée configurée (kg), hypothèse documentée. */
  uncertaintyKg: number;
  /** Plancher absolu (kg), couvre dérive d'étalonnage et humidité. */
  floorKg: number;
  /** Tolérance effective : max(3 × √(u² + u²), plancher). */
  toleranceKg: number;
}

function readMeta(db: Database.Database, key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Tolérance effective du bilan matière, depuis la configuration. */
export function getBilanTolerance(db: Database.Database): BilanTolerance {
  const uncertaintyKg = readMeta(db, 'coupe_scale_uncertainty_kg', 0.1);
  const floorKg = readMeta(db, 'coupe_bilan_tolerance_floor_kg', 0.3);
  return {
    uncertaintyKg,
    floorKg,
    toleranceKg: Math.max(3 * Math.sqrt(uncertaintyKg ** 2 + uncertaintyKg ** 2), floorKg),
  };
}

/** Modifie la tolérance (admin only) — jamais la formule de consommation. */
export function setBilanTolerance(
  db: Database.Database,
  actor: Actor,
  input: { uncertaintyKg: unknown; floorKg: unknown },
): BilanTolerance {
  assertCoupeAdmin(actor);
  const upsert = db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const set = (key: string, raw: unknown, label: string): number => {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new ServiceError(`${label} doit être un nombre positif.`, 400);
    }
    upsert.run(key, String(value));
    return value;
  };
  const uncertaintyKg = set('coupe_scale_uncertainty_kg', input.uncertaintyKg, 'L\'incertitude de pesée');
  const floorKg = set('coupe_bilan_tolerance_floor_kg', input.floorKg, 'Le plancher de tolérance');
  return {
    uncertaintyKg,
    floorKg,
    toleranceKg: Math.max(3 * Math.sqrt(uncertaintyKg ** 2 + uncertaintyKg ** 2), floorKg),
  };
}

function getSessionRow(db: Database.Database, sessionId: number): SessionRow {
  const row = db.prepare('SELECT * FROM coupe_cut_sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;
  if (!row) throw new ServiceError('Session de mesure introuvable.', 404);
  return row;
}

function requireEditable(session: SessionRow): void {
  if (session.status !== 'brouillon') {
    throw new ServiceError(
      'Seule une session en brouillon peut être modifiée ; une session complète est figée '
      + '(passez par une correction par version).',
      409,
    );
  }
}

/**
 * Ouvre une session de mesure sur un rouleau. La pesée d'entrée est
 * OBLIGATOIRE (arbitrage 2) : sans elle, aucune consommation ne peut
 * être établie — pas de session « longueur seule ». Une seule session
 * OUVERTE (brouillon) par rouleau : impossible d'avoir deux intervalles
 * de mesure simultanés ; les sessions complètes ne bloquent pas, un
 * rouleau peut porter plusieurs pesées successives.
 */
export function createCutSession(
  db: Database.Database,
  actor: Actor,
  input: {
    rollId: unknown;
    rollWeightBeforeKg: unknown;
    instrument?: unknown;
    notes?: unknown;
  },
): SessionRow {
  assertCoupeWrite(actor);
  const rollId = requireId(input.rollId, 'Le rouleau');
  const before = requirePositive(input.rollWeightBeforeKg, 'Le poids avant déroulage');
  const roll = db.prepare('SELECT id, code FROM coupe_rolls WHERE id = ?').get(rollId) as
    | { id: number; code: string }
    | undefined;
  if (!roll) throw new ServiceError('Rouleau introuvable.', 404);
  const open = db.prepare(
    `SELECT id FROM coupe_cut_sessions WHERE roll_id = ? AND status = 'brouillon'`,
  ).get(rollId) as { id: number } | undefined;
  if (open) {
    throw new ServiceError(
      `Une session ouverte existe déjà pour ce rouleau (session #${open.id}) : `
      + 'finalisez-la ou invalidez-la avant d\'en ouvrir une nouvelle.',
      409,
    );
  }
  const info = db.prepare(
    `INSERT INTO coupe_cut_sessions
       (roll_id, status, roll_weight_before_kg, instrument, notes, operator_id)
     VALUES (?, 'brouillon', ?, ?, ?, ?)`,
  ).run(
    rollId,
    before,
    typeof input.instrument === 'string' && input.instrument.trim()
      ? input.instrument.trim().slice(0, 80) : null,
    typeof input.notes === 'string' && input.notes.trim()
      ? input.notes.trim().slice(0, 500) : null,
    actor.id,
  );
  return getSessionRow(db, Number(info.lastInsertRowid));
}

/** Modifie l'entrée d'une session en brouillon (pesée d'entrée, GSM/largeur mesurées, instrument). */
export function updateCutSession(
  db: Database.Database,
  actor: Actor,
  input: {
    sessionId: unknown;
    rollWeightBeforeKg?: unknown;
    measuredGsm?: unknown;
    measuredWidthCm?: unknown;
    instrument?: unknown;
    notes?: unknown;
  },
): SessionRow {
  assertCoupeWrite(actor);
  const session = getSessionRow(db, requireId(input.sessionId, 'La session'));
  requireEditable(session);
  const before = input.rollWeightBeforeKg === undefined || input.rollWeightBeforeKg === null
    ? session.roll_weight_before_kg
    : requirePositive(input.rollWeightBeforeKg, 'Le poids avant déroulage');
  const gsm = input.measuredGsm === undefined ? session.measured_gsm
    : input.measuredGsm === null ? null : requirePositive(input.measuredGsm, 'La GSM mesurée');
  const width = input.measuredWidthCm === undefined ? session.measured_width_cm
    : input.measuredWidthCm === null ? null : requirePositive(input.measuredWidthCm, 'La largeur mesurée');
  db.prepare(
    `UPDATE coupe_cut_sessions
        SET roll_weight_before_kg = ?, measured_gsm = ?, measured_width_cm = ?,
            instrument = COALESCE(?, instrument), notes = COALESCE(?, notes),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    before, gsm, width,
    typeof input.instrument === 'string' ? input.instrument.trim().slice(0, 80) || null : null,
    typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) || null : null,
    session.id,
  );
  return getSessionRow(db, session.id);
}

/** Enregistrements de plans d'une session. */
function listRecords(db: Database.Database, sessionId: number): RecordRow[] {
  return db.prepare(
    'SELECT * FROM coupe_cut_plan_records WHERE session_id = ? ORDER BY id',
  ).all(sessionId) as RecordRow[];
}

function assertPlanInSessionScope(
  db: Database.Database,
  session: SessionRow,
  planId: number,
): { id: number; roll_id: number | null; matelas_length_cm: number; status: string } {
  const plan = db.prepare(
    'SELECT id, roll_id, matelas_length_cm, status FROM marker_plans WHERE id = ?',
  ).get(planId) as { id: number; roll_id: number | null; matelas_length_cm: number; status: string } | undefined;
  if (!plan) throw new ServiceError('Plan de coupe introuvable.', 404);
  if (plan.roll_id === null || plan.roll_id !== session.roll_id) {
    throw new ServiceError(
      'Le plan n\'appartient pas au rouleau de la session : un changement de rouleau '
      + 'exige la clôture de la session en cours et une nouvelle session.',
      409,
    );
  }
  const attached = db.prepare(
    `SELECT r.session_id, s.status FROM coupe_cut_plan_records r
       JOIN coupe_cut_sessions s ON s.id = r.session_id
      WHERE r.plan_id = ? AND s.status IN ('brouillon', 'complet')`,
  ).get(planId) as { session_id: number; status: string } | undefined;
  if (attached && attached.session_id !== session.id) {
    throw new ServiceError(
      `Ce plan est déjà rattaché à une session active (#${attached.session_id}) : `
      + 'un plan ne peut appartenir qu\'à une seule session active.',
      409,
    );
  }
  return plan;
}

/**
 * Ajoute ou met à jour l'enregistrement d'un plan dans la session
 * (brouillon uniquement). La longueur déroulée réelle, les chutes et
 * le poids des pièces sont saisis ici — le poids consommé de session
 * n'est JAMAIS calculé ni réparti à ce niveau.
 */
export function savePlanRecord(
  db: Database.Database,
  actor: Actor,
  input: {
    sessionId: unknown;
    planId: unknown;
    lengthUsedM?: unknown;
    chutesKg?: unknown;
    piecesKg?: unknown;
  },
): RecordRow {
  assertCoupeWrite(actor);
  const session = getSessionRow(db, requireId(input.sessionId, 'La session'));
  requireEditable(session);
  const planId = requireId(input.planId, 'Le plan');
  assertPlanInSessionScope(db, session, planId);
  const parseOpt = (raw: unknown, label: string): number | null => {
    if (raw === undefined || raw === null || raw === '') return null;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 0 || (label.includes('longueur') && value <= 0)) {
      throw new ServiceError(
        label.includes('longueur')
          ? `${label} doit être un nombre strictement positif.`
          : `${label} doit être un nombre positif ou nul.`,
        400,
      );
    }
    return value;
  };
  const length = parseOpt(input.lengthUsedM, 'La longueur déroulée');
  const chutes = parseOpt(input.chutesKg, 'Le poids des chutes');
  const pieces = parseOpt(input.piecesKg, 'Le poids des pièces');
  const existing = db.prepare(
    'SELECT id FROM coupe_cut_plan_records WHERE session_id = ? AND plan_id = ?',
  ).get(session.id, planId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE coupe_cut_plan_records
          SET length_used_m = COALESCE(?, length_used_m),
              chutes_kg = ?, pieces_kg = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(length, chutes, pieces, existing.id);
    return db.prepare('SELECT * FROM coupe_cut_plan_records WHERE id = ?')
      .get(existing.id) as RecordRow;
  }
  const info = db.prepare(
    `INSERT INTO coupe_cut_plan_records
       (session_id, plan_id, roll_id, length_used_m, chutes_kg, pieces_kg)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(session.id, planId, session.roll_id, length, chutes, pieces);
  return db.prepare('SELECT * FROM coupe_cut_plan_records WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as RecordRow;
}

export interface SessionDiagnostics {
  /** Somme des attendus par plan (kg), si GSM/largeur mesurées et toutes les longueurs présentes. */
  expectedKg: number | null;
  /** Écart consumed − attendu (kg), si calculable. */
  gapKg: number | null;
  /** Tolérance effective appliquée (kg). */
  toleranceKg: number;
  /** Résidu non mesuré (kg) : consumed − pièces − chutes, si pesés. */
  residueKg: number | null;
}

/**
 * Diagnostics d'une session. `expectedKg` n'est calculé que si la GSM
 * ET la largeur MESURÉES sont présentes et que tous les plans de la
 * session ont leur longueur — un contrôle partiel ne vaut pas contrôle.
 */
export function computeDiagnostics(
  db: Database.Database,
  session: SessionRow,
  records: RecordRow[],
): SessionDiagnostics {
  const { toleranceKg } = getBilanTolerance(db);
  const diagnostics: SessionDiagnostics = {
    expectedKg: null, gapKg: null, toleranceKg, residueKg: null,
  };
  if (session.consumed_kg === null) return diagnostics;
  const allLengths = records.length > 0
    && records.every((record) => record.length_used_m !== null);
  if (session.measured_gsm !== null && session.measured_width_cm !== null && allLengths) {
    const expectedKg = records.reduce(
      (sum, record) => sum + (record.length_used_m as number)
        * (session.measured_width_cm as number) / 100
        * (session.measured_gsm as number) / 1000,
      0,
    );
    diagnostics.expectedKg = expectedKg;
    diagnostics.gapKg = session.consumed_kg - expectedKg;
  }
  const hasWeighings = records.some(
    (record) => record.pieces_kg !== null || record.chutes_kg !== null,
  );
  if (hasWeighings) {
    const weighed = records.reduce(
      (sum, record) => sum + (record.pieces_kg ?? 0) + (record.chutes_kg ?? 0),
      0,
    );
    diagnostics.residueKg = session.consumed_kg - weighed;
  }
  return diagnostics;
}

/**
 * Finalise une session : pesée de sortie obligatoire (rouleau RESTANT),
 * ≥ 1 plan avec longueur, consommation calculée UNE fois et figée.
 * L'écart de bilan au-delà de la tolérance n'empêche PAS la finalisation
 * d'une mesure physique fiable : il est drapeau (`bilan_ecart`) et exige
 * un commentaire tracé. Seules les incohérences physiques (after >
 * before) bloquent.
 */
export function finalizeCutSession(
  db: Database.Database,
  actor: Actor,
  input: {
    sessionId: unknown;
    rollWeightAfterKg: unknown;
    measuredGsm?: unknown;
    measuredWidthCm?: unknown;
    bilanComment?: unknown;
  },
): { session: SessionRow; diagnostics: SessionDiagnostics } {
  assertCoupeWrite(actor);
  const session = getSessionRow(db, requireId(input.sessionId, 'La session'));
  requireEditable(session);
  if (session.roll_weight_before_kg === null) {
    throw new ServiceError('Pesée d\'entrée manquante : aucune session sans pesée d\'entrée.', 400);
  }
  const after = requirePositive(input.rollWeightAfterKg, 'Le poids du rouleau restant');
  if (after > session.roll_weight_before_kg) {
    throw new ServiceError(
      `Poids du rouleau restant (${after} kg) supérieur au poids avant déroulage `
      + `(${session.roll_weight_before_kg} kg) : incohérence physique, finalisation refusée.`,
      400,
    );
  }
  const records = listRecords(db, session.id);
  const withLength = records.filter((record) => record.length_used_m !== null);
  if (withLength.length === 0) {
    throw new ServiceError(
      'Aucun plan avec longueur déroulée : au moins un enregistrement de plan '
      + 'doit porter la longueur réellement déroulée.',
      400,
    );
  }
  const gsm = input.measuredGsm === undefined || input.measuredGsm === null
    ? session.measured_gsm
    : requirePositive(input.measuredGsm, 'La GSM mesurée');
  const width = input.measuredWidthCm === undefined || input.measuredWidthCm === null
    ? session.measured_width_cm
    : requirePositive(input.measuredWidthCm, 'La largeur mesurée');
  const consumed = session.roll_weight_before_kg - after;
  const working: SessionRow = {
    ...session,
    roll_weight_after_kg: after,
    consumed_kg: consumed,
    measured_gsm: gsm,
    measured_width_cm: width,
  };
  const diagnostics = computeDiagnostics(db, working, records);
  let bilanFlag: 'ok' | 'bilan_ecart' | null = null;
  let bilanComment: string | null = null;
  if (diagnostics.gapKg !== null) {
    bilanFlag = Math.abs(diagnostics.gapKg) > diagnostics.toleranceKg
      ? 'bilan_ecart' : 'ok';
    if (bilanFlag === 'bilan_ecart') {
      const comment = typeof input.bilanComment === 'string' ? input.bilanComment.trim() : '';
      if (!comment) {
        throw new ServiceError(
          `Écart de bilan de ${diagnostics.gapKg.toFixed(3)} kg au-delà de la tolérance `
          + `(${diagnostics.toleranceKg.toFixed(3)} kg) : un commentaire est requis pour `
          + 'finaliser une session avec écart. La mesure n\'est pas invalidée.',
          400,
        );
      }
      bilanComment = comment.slice(0, 500);
    }
  }
  db.prepare(
    `UPDATE coupe_cut_sessions
        SET status = 'complet', roll_weight_after_kg = ?, consumed_kg = ?,
            measured_gsm = ?, measured_width_cm = ?, bilan_flag = ?, bilan_comment = ?,
            finalized_by = ?, finalized_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
  ).run(after, consumed, gsm, width, bilanFlag, bilanComment, actor.id, session.id);
  const finalized = getSessionRow(db, session.id);
  return {
    session: finalized,
    diagnostics: computeDiagnostics(db, finalized, records),
  };
}

/** Invalide une session (motif obligatoire) — donnée préservée, hors indicateurs. */
export function invalidateCutSession(
  db: Database.Database,
  actor: Actor,
  input: { sessionId: unknown; reason: unknown },
): SessionRow {
  assertCoupeWrite(actor);
  const session = getSessionRow(db, requireId(input.sessionId, 'La session'));
  if (session.status === 'invalide') {
    throw new ServiceError('Cette session est déjà invalidée.', 409);
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) {
    throw new ServiceError('Un motif d\'invalidation est requis.', 400);
  }
  db.prepare(
    `UPDATE coupe_cut_sessions
        SET status = 'invalide', invalide_reason = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(reason.slice(0, 500), session.id);
  return getSessionRow(db, session.id);
}

/**
 * Correction par version : crée une NOUVELLE session en brouillon
 * (replaces_id → l'ancienne) copiant pesée d'entrée, mesures et
 * enregistrements de plans, puis invalide l'ancienne avec le motif
 * « Remplacée ». L'historique de la mesure précédente est préservé ;
 * aucune donnée n'est réécrite en place.
 */
export function replaceCutSession(
  db: Database.Database,
  actor: Actor,
  sessionId: unknown,
): SessionRow {
  assertCoupeWrite(actor);
  const session = getSessionRow(db, requireId(sessionId, 'La session'));
  if (session.status !== 'complet') {
    throw new ServiceError(
      'Seule une session complète peut être corrigée par version ; '
      + 'une session en brouillon se modifie directement.',
      409,
    );
  }
  const replacement = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO coupe_cut_sessions
         (roll_id, status, roll_weight_before_kg, roll_weight_after_kg, consumed_kg,
          measured_gsm, measured_width_cm, instrument, notes, operator_id, replaces_id)
       VALUES (?, 'brouillon', ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.roll_id, session.roll_weight_before_kg,
      session.measured_gsm, session.measured_width_cm, session.instrument,
      session.notes, actor.id, session.id,
    );
    const createdId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO coupe_cut_plan_records
         (session_id, plan_id, roll_id, length_used_m, chutes_kg, pieces_kg)
       SELECT ?, plan_id, roll_id, length_used_m, chutes_kg, pieces_kg
         FROM coupe_cut_plan_records WHERE session_id = ?`,
    ).run(createdId, session.id);
    db.prepare(
      `UPDATE coupe_cut_sessions
          SET status = 'invalide',
              invalide_reason = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(`Remplacée par la version #${createdId}.`, session.id);
    return getSessionRow(db, createdId);
  })();
  return replacement;
}

/** Liste des sessions (lecture chef + admin), la plus récente d'abord. */
export function listCutSessions(db: Database.Database): Array<
  SessionRow & { rollCode: string; operator: string | null }
> {
  return db.prepare(
    `SELECT s.*, r.code AS rollCode, u.nom AS operator
       FROM coupe_cut_sessions s
       JOIN coupe_rolls r ON r.id = s.roll_id
       LEFT JOIN users u ON u.id = s.operator_id
      ORDER BY s.id DESC`,
  ).all() as Array<SessionRow & { rollCode: string; operator: string | null }>;
}

export interface CutSessionDetail {
  session: SessionRow;
  rollCode: string;
  records: Array<RecordRow & {
    planMatelasM: number | null;
    lengthGapM: number | null;
  }>;
  /** Plans validés du rouleau, rattachables à cette session. */
  availablePlans: Array<{ id: number; matelas_length_cm: number; status: string }>;
  diagnostics: SessionDiagnostics | null;
  /** Consommation attribuable au plan : uniquement en session mono-plan. */
  planConsumedKg: number | null;
  tolerance: BilanTolerance;
}

/**
 * Détail d'une session. Les indicateurs finaux (consommation, bilan)
 * ne sont exposés que pour une session `complet` : un relevé incomplet
 * ne produit jamais d'indicateur. En session mono-plan, la consommation
 * est attribuable au plan directement (ce n'est pas une répartition) ;
 * en multi-plans, `planConsumedKg` reste NULL — aucune attribution
 * artificielle.
 */
export function getCutSession(db: Database.Database, sessionId: unknown): CutSessionDetail {
  const id = requireId(sessionId, 'La session');
  const session = getSessionRow(db, id);
  const roll = db.prepare('SELECT code FROM coupe_rolls WHERE id = ?')
    .get(session.roll_id) as { code: string } | undefined;
  const records = listRecords(db, id).map((record) => {
    const plan = db.prepare('SELECT matelas_length_cm FROM marker_plans WHERE id = ?')
      .get(record.plan_id) as { matelas_length_cm: number } | undefined;
    const planMatelasM = plan ? plan.matelas_length_cm / 100 : null;
    return {
      ...record,
      planMatelasM,
      lengthGapM: record.length_used_m !== null && planMatelasM !== null
        ? record.length_used_m - planMatelasM
        : null,
    };
  });
  const availablePlans = db.prepare(
    `SELECT mp.id, mp.matelas_length_cm, mp.status
       FROM marker_plans mp
      WHERE mp.roll_id = ? AND mp.status = 'valide'
        AND NOT EXISTS (
          SELECT 1 FROM coupe_cut_plan_records r
            JOIN coupe_cut_sessions s ON s.id = r.session_id
           WHERE r.plan_id = mp.id AND s.status IN ('brouillon', 'complet'))
      ORDER BY mp.id`,
  ).all(session.roll_id) as Array<{ id: number; matelas_length_cm: number; status: string }>;
  const measurable = session.status === 'complet';
  return {
    session,
    rollCode: roll?.code ?? '',
    records,
    availablePlans,
    diagnostics: measurable ? computeDiagnostics(db, session, records) : null,
    planConsumedKg: measurable && records.length === 1 ? session.consumed_kg : null,
    tolerance: getBilanTolerance(db),
  };
}
