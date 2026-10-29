import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { checkRollCoherence } from './fabric-estimate';
import { assertCoupeWrite, requireId, requireText } from './common';

/**
 * Étape 13 — exploitation professionnelle des rouleaux.
 * Réutilise exclusivement les tables existantes : `coupe_rolls`
 * (états opérationnels CHECK SQL) et `coupe_roll_movements`
 * (historique : motif, utilisateur, date). Aucune migration : les
 * types de mouvement 'correction_poids', 'blocage', 'deblocage' et
 * 'statut' étaient prévus mais jamais écrits — c'est désormais leur
 * seule porte d'entrée, afin qu'aucune modification de stock ne soit
 * silencieuse.
 */

export interface RollAlert {
  code: 'remaining_over_initial' | 'remaining_missing' | 'weight_over_initial'
    | 'silent_consumption' | 'coherence_grammage';
  message: string;
}

export interface RollDetail {
  id: number;
  code: string;
  fabricRef: string;
  colorNom: string | null;
  weightKg: number;
  remainingWeightKg: number | null;
  lengthM: number | null;
  /** Longueur consommée selon la fiche (initial − restant), en m. */
  consumedM: number | null;
  remainingM: number | null;
  widthCm: number | null;
  usableWidthCm: number | null;
  grammageGm2: number | null;
  status: string;
  createdAt: string;
  responsable: string | null;
  alerts: RollAlert[];
}

interface RollDetailRow {
  id: number;
  code: string;
  fabric_ref: string;
  color_nom: string | null;
  initial_weight_kg: number;
  remaining_weight_kg: number | null;
  initial_qty: number | null;
  remaining_qty: number | null;
  qty_unit: string | null;
  width_cm: number | null;
  usable_width_cm: number | null;
  grammage_g_m2: number | null;
  status: string;
  created_at: string;
  responsable: string | null;
  physical_moves: number;
}

const DETAIL_SELECT = `
  SELECT r.id, r.code, r.fabric_ref, c.nom AS color_nom,
         r.initial_weight_kg, r.remaining_weight_kg,
         r.initial_qty, r.remaining_qty, r.qty_unit,
         r.width_cm, r.usable_width_cm, r.grammage_g_m2,
         r.status, r.created_at,
         (SELECT u.username FROM coupe_roll_movements m
            JOIN users u ON u.id = m.user_id
           WHERE m.roll_id = r.id AND m.movement_type = 'creation'
           ORDER BY m.id LIMIT 1) AS responsable,
         (SELECT COUNT(*) FROM coupe_roll_movements m2
           WHERE m2.roll_id = r.id
             AND m2.movement_type IN ('consommation','correction_poids'))
           AS physical_moves
    FROM coupe_rolls r
    LEFT JOIN colors c ON c.id = r.color_id`;

/** Alertes de cohérence : jamais de valeur inventée (règle 9). */
function buildAlerts(row: RollDetailRow): RollAlert[] {
  const alerts: RollAlert[] = [];
  if (row.initial_qty !== null && row.remaining_qty !== null
    && row.remaining_qty > row.initial_qty + 1e-9) {
    alerts.push({
      code: 'remaining_over_initial',
      message: `Incohérence : restant ${row.remaining_qty} m > initial ${row.initial_qty} m.`,
    });
  }
  if (row.initial_qty !== null && row.remaining_qty === null) {
    alerts.push({
      code: 'remaining_missing',
      message: 'Longueur restante inconnue (donnée historique incomplète).',
    });
  }
  if (row.remaining_weight_kg !== null
    && row.remaining_weight_kg > row.initial_weight_kg + 1e-9) {
    alerts.push({
      code: 'weight_over_initial',
      message: `Incohérence : poids restant ${row.remaining_weight_kg} kg > initial `
        + `${row.initial_weight_kg} kg.`,
    });
  }
  const consumedM = row.initial_qty !== null && row.remaining_qty !== null
    ? row.initial_qty - row.remaining_qty : null;
  if (consumedM !== null && consumedM > 0.001 && row.physical_moves === 0) {
    alerts.push({
      code: 'silent_consumption',
      message: 'Consommation sans mouvement enregistré (modification directe).',
    });
  }
  // Alerte informative sur les données historiques incohérentes : le
  // grammage implicite (poids ÷ longueur ÷ largeur) contredit le
  // grammage déclaré. JAMAIS de correction automatique : un relevé
  // physique (correction de stock) reste la seule voie de régularisation.
  if (row.qty_unit === 'm' && row.initial_qty !== null && row.initial_qty > 0
    && row.grammage_g_m2 !== null && row.width_cm !== null) {
    const coherence = checkRollCoherence(
      row.initial_weight_kg, row.initial_qty, row.grammage_g_m2, row.width_cm,
    );
    if (coherence.anomaly) {
      alerts.push({
        code: 'coherence_grammage',
        message: `Incohérence déclarative (donnée historique) : grammage `
          + `implicite ${coherence.implicitGrammage.toFixed(0)} g/m² ≠ `
          + `grammage déclaré ${row.grammage_g_m2} g/m² (écart `
          + `${coherence.deviationPct.toFixed(0)} %). Vérifier par relevé `
          + 'physique ; aucune correction automatique.',
      });
    }
  }
  return alerts;
}

function toDetail(row: RollDetailRow): RollDetail {
  const consumedM = row.initial_qty !== null && row.remaining_qty !== null
    ? Math.round((row.initial_qty - row.remaining_qty) * 1000) / 1000 : null;
  return {
    id: row.id,
    code: row.code,
    fabricRef: row.fabric_ref,
    colorNom: row.color_nom,
    weightKg: row.initial_weight_kg,
    remainingWeightKg: row.remaining_weight_kg,
    lengthM: row.initial_qty,
    consumedM,
    remainingM: row.remaining_qty,
    widthCm: row.width_cm,
    usableWidthCm: row.usable_width_cm,
    grammageGm2: row.grammage_g_m2,
    status: row.status,
    createdAt: row.created_at,
    responsable: row.responsable,
    alerts: buildAlerts(row),
  };
}

/** Vue complète (chef de coupe) : TOUS les rouleaux, y compris bloqués. */
export function listRollsDetailed(db: Database.Database): RollDetail[] {
  const rows = db
    .prepare(`${DETAIL_SELECT} ORDER BY r.created_at DESC, r.id DESC`)
    .all() as RollDetailRow[];
  return rows.map(toDetail);
}

export interface MovementItem {
  id: number;
  movementType: string;
  qty: number | null;
  unit: string | null;
  reason: string | null;
  username: string;
  createdAt: string;
}

/** Historique des mouvements d'un rouleau (traçabilité complète). */
export function listMovements(
  db: Database.Database,
  rollId: number,
): MovementItem[] {
  return db.prepare(
    `SELECT m.id, m.movement_type AS movementType, m.qty, m.unit, m.reason,
            u.username, m.created_at AS createdAt
       FROM coupe_roll_movements m
       JOIN users u ON u.id = m.user_id
      WHERE m.roll_id = ?
      ORDER BY m.id DESC`,
  ).all(rollId) as MovementItem[];
}

interface RollStateRow {
  id: number;
  status: string;
  initial_weight_kg: number;
  remaining_weight_kg: number | null;
  initial_qty: number | null;
  remaining_qty: number | null;
  physical_moves: number;
}

const STATE_SELECT = `
  SELECT r.id, r.status, r.initial_weight_kg, r.remaining_weight_kg,
         r.initial_qty, r.remaining_qty,
         (SELECT COUNT(*) FROM coupe_roll_movements m2
           WHERE m2.roll_id = r.id
             AND m2.movement_type IN ('consommation','correction_poids'))
           AS physical_moves
    FROM coupe_rolls r WHERE r.id = ?`;

function recordMovement(
  db: Database.Database,
  rollId: number,
  movementType: 'correction_poids' | 'blocage' | 'deblocage' | 'statut',
  fields: {
    weightBefore?: number | null;
    weightAfter?: number | null;
    qty?: number | null;
    unit?: string | null;
    reason: string;
  },
  actor: Actor,
): void {
  db.prepare(
    `INSERT INTO coupe_roll_movements
       (roll_id, movement_type, weight_before, weight_after, qty, unit, reason, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rollId, movementType,
    fields.weightBefore ?? null, fields.weightAfter ?? null,
    fields.qty ?? null, fields.unit ?? null, fields.reason, actor.id,
  );
}

export interface AdjustRollInput {
  rollId: unknown;
  /** Nouvelle longueur restante (m). Absent → inchangée. */
  newRemainingM?: unknown;
  /** Nouveau poids restant (kg). Absent → inchangé. */
  newRemainingKg?: unknown;
  /** Motif OBLIGATOIRE (validé par `requireText`, pas par le type). */
  reason?: unknown;
}

/**
 * Correction de stock (règle 7) : jamais silencieuse — motif obligatoire,
 * utilisateur et date enregistrés via `coupe_roll_movements`. La
 * correction ne peut pas créer de stock hors bornes (0 ≤ restant ≤
 * initial) ni toucher un rouleau épuisé (créer un nouveau rouleau).
 */
export function adjustRoll(
  db: Database.Database,
  actor: Actor,
  input: AdjustRollInput,
): RollDetail {
  assertCoupeWrite(actor);
  const rollId = requireId(input.rollId, 'Le rouleau');
  const reason = requireText(input.reason, 'Le motif de la correction');
  const row = db.prepare(STATE_SELECT).get(rollId) as RollStateRow | undefined;
  if (!row) throw new ServiceError('Rouleau introuvable.', 404);
  if (row.status === 'epuise') {
    throw new ServiceError(
      'Rouleau épuisé : créer un nouveau rouleau plutôt que de le corriger.',
      409,
    );
  }
  const apply = db.transaction(() => {
    let lengthDelta: { before: number; after: number } | null = null;
    let weightDelta: { before: number; after: number } | null = null;
    if (input.newRemainingM !== undefined) {
      const initial = row.initial_qty;
      if (initial === null) {
        throw new ServiceError(
          'Longueur initiale inconnue : correction de longueur impossible.',
          409,
        );
      }
      const parsed = typeof input.newRemainingM === 'number' ? input.newRemainingM : null;
      if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
        throw new ServiceError(
          'La longueur restante doit être un nombre positif ou nul.',
          400,
        );
      }
      if (parsed > initial + 1e-9) {
        throw new ServiceError(
          `La longueur restante ne peut pas dépasser la longueur initiale (${initial} m).`,
          400,
        );
      }
      const after = Math.round(parsed * 1000) / 1000;
      lengthDelta = { before: row.remaining_qty ?? initial, after };
      db.prepare('UPDATE coupe_rolls SET remaining_qty = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(after, rollId);
      recordMovement(db, rollId, 'correction_poids',
        {
          qty: Math.round((after - lengthDelta.before) * 1000) / 1000,
          unit: 'm', reason,
        }, actor);
    }
    if (input.newRemainingKg !== undefined) {
      const parsed = typeof input.newRemainingKg === 'number' ? input.newRemainingKg : null;
      if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
        throw new ServiceError(
          'Le poids restant doit être un nombre positif ou nul.',
          400,
        );
      }
      if (parsed > row.initial_weight_kg + 1e-9) {
        throw new ServiceError(
          `Le poids restant ne peut pas dépasser le poids initial `
          + `(${row.initial_weight_kg} kg).`,
          400,
        );
      }
      const after = Math.round(parsed * 1000) / 1000;
      weightDelta = { before: row.remaining_weight_kg ?? row.initial_weight_kg, after };
      // Épuisement (tolérance 0,001) : le poids fait foi. Le métrage
      // pris en compte est celui corrigé dans la même transaction le
      // cas échéant. Métrage NULL (suivi kg seul ou inconnu) : le
      // passage à zéro du poids suffit. Métrage restant > 0 avec un
      // poids nul : contradiction explicite, aucun statut automatique.
      const metersAfter = lengthDelta !== null ? lengthDelta.after : row.remaining_qty;
      if (after <= 0.001 && metersAfter !== null && metersAfter > 0.001) {
        throw new ServiceError(
          `Données contradictoires : poids restant nul mais ${metersAfter} m `
          + 'déclarés restants. Corrigez également le métrage : un rouleau '
          + 'avec du métrage ne peut pas être épuisé.',
          409,
        );
      }
      const exhausted = after <= 0.001
        && (metersAfter === null || metersAfter <= 0.001);
      db.prepare(
        `UPDATE coupe_rolls SET remaining_weight_kg = ?, status =
           CASE WHEN ? = 1 THEN 'epuise' ELSE status END,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(after, exhausted ? 1 : 0, rollId);
      recordMovement(db, rollId, 'correction_poids',
        {
          weightBefore: weightDelta.before, weightAfter: after,
          qty: Math.round((after - weightDelta.before) * 1000) / 1000,
          unit: 'kg', reason,
        }, actor);
    }
    if (lengthDelta === null && weightDelta === null) {
      throw new ServiceError(
        'Aucune correction demandée : fournir une longueur ou un poids restant.',
        400,
      );
    }
    const fresh = db.prepare(STATE_SELECT).get(rollId) as RollStateRow;
    if (fresh.status === 'epuise' && row.status !== 'epuise') {
      recordMovement(db, rollId, 'statut',
        { unit: 'etat', reason: `Épuisement constaté — ${reason}` }, actor);
    }
  });
  apply();
  const detail = db
    .prepare(`${DETAIL_SELECT} WHERE r.id = ?`)
    .get(rollId) as RollDetailRow;
  return toDetail(detail);
}

const STATUS_MOVEMENT = {
  bloque: 'blocage',
  defectueux: 'blocage',
  disponible: 'deblocage',
} as const;

export interface RollConsumptionSources {
  rollId: number;
  code: string;
  qtyUnit: string | null;
  /** Disponible physique (rouleau) : valeurs stockées + alertes phase 3. */
  physical: {
    initialWeightKg: number;
    remainingWeightKg: number | null;
    remainingQtyM: number | null;
    widthCm: number | null;
    grammageGm2: number | null;
    alerts: RollAlert[];
  };
  /**
   * Placement réel (plans validés et transférés de CE rouleau) :
   * matelas déclaré × couches × largeur nominale × GSM. Lecture pure :
   * le contrôle d'anomalie du transfert ne bloque pas une consultation
   * (aucun recalcul, aucune écriture, plan #20 inclus).
   */
  placement: { kg: number | null; plans: number; reason: string | null };
  /** Consommation enregistrée : somme des mouvements 'consommation'. */
  recorded: { kg: number | null; movements: number; reason: string | null };
}

/**
 * Les quatre sources de consommation pour UN rouleau (phase 4, lecture
 * seule). La source « estimation formule » (commande) vit dans le
 * calculateur et n'est pas rattachée à un rouleau. Chaque figure porte
 * son étiquette ; `null` + cause explicite quand non calculable —
 * jamais de valeur inventée.
 */
export function rollConsumptionSources(
  db: Database.Database,
  rollId: number,
): RollConsumptionSources {
  const row = db.prepare(`${DETAIL_SELECT} WHERE r.id = ?`).get(rollId) as
    | RollDetailRow
    | undefined;
  if (!row) throw new ServiceError('Rouleau introuvable.', 404);
  const widthKnown = row.width_cm !== null && row.width_cm > 0;
  const grammageKnown = row.grammage_g_m2 !== null && row.grammage_g_m2 > 0;
  let placementKg: number | null = null;
  let placementReason: string | null = null;
  let placementPlans = 0;
  if (widthKnown && grammageKnown) {
    const plans = db.prepare(
      `SELECT matelas_length_cm, layers FROM marker_plans
        WHERE roll_id = ? AND lot_id IS NOT NULL AND status = 'valide'`,
    ).all(rollId) as Array<{ matelas_length_cm: number; layers: number }>;
    placementPlans = plans.length;
    placementKg = plans.reduce(
      (sum, plan) => sum
        + (plan.layers * plan.matelas_length_cm * (row.width_cm as number))
          / 10000
          * (row.grammage_g_m2 as number) / 1000,
      0,
    );
  } else {
    placementReason = !widthKnown
      ? 'Largeur nominale du rouleau inconnue : placement en kg non calculable.'
      : 'Grammage du rouleau inconnu : placement en kg non calculable.';
  }
  const recorded = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS kg
       FROM coupe_roll_movements
      WHERE roll_id = ? AND movement_type = 'consommation' AND unit = 'kg'`,
  ).get(rollId) as { n: number; kg: number };
  return {
    rollId: row.id,
    code: row.code,
    qtyUnit: row.qty_unit,
    physical: {
      initialWeightKg: row.initial_weight_kg,
      remainingWeightKg: row.remaining_weight_kg,
      remainingQtyM: row.remaining_qty,
      widthCm: row.width_cm,
      grammageGm2: row.grammage_g_m2,
      alerts: buildAlerts(row),
    },
    placement: { kg: placementKg, plans: placementPlans, reason: placementReason },
    recorded: {
      kg: recorded.n > 0 ? recorded.kg : null,
      movements: recorded.n,
      reason: recorded.n > 0
        ? null
        : 'Aucun mouvement de consommation enregistré (aucun transfert).',
    },
  };
}

export interface SetRollStatusInput {
  rollId: unknown;
  status: unknown;
  reason: unknown;
}

/**
 * Blocage / déblocage avec motif (règles 6 et 7). Un rouleau bloqué ou
 * défectueux ne peut plus être affecté à une coupe (contrôle déjà
 * appliqué par `createPlan`). Le statut d'un rouleau en cours
 * d'utilisation ne change pas ici : le flux de production le pilote.
 */
export function setRollStatus(
  db: Database.Database,
  actor: Actor,
  input: SetRollStatusInput,
): RollDetail {
  assertCoupeWrite(actor);
  const rollId = requireId(input.rollId, 'Le rouleau');
  const reason = requireText(input.reason, 'Le motif du changement d’état');
  const target = typeof input.status === 'string' ? input.status : '';
  if (!(target in STATUS_MOVEMENT)) {
    throw new ServiceError(
      'État cible invalide : bloque, defectueux ou disponible attendus.',
      400,
    );
  }
  const row = db.prepare('SELECT id, status FROM coupe_rolls WHERE id = ?')
    .get(rollId) as { id: number; status: string } | undefined;
  if (!row) throw new ServiceError('Rouleau introuvable.', 404);
  if (row.status === 'en_utilisation') {
    throw new ServiceError(
      'Rouleau en cours d’utilisation : état piloté par la production.',
      409,
    );
  }
  if (row.status === 'epuise') {
    throw new ServiceError('Rouleau épuisé : état définitif.', 409);
  }
  if (row.status === target) {
    throw new ServiceError(`Le rouleau est déjà dans l'état « ${target} ».`, 409);
  }
  db.transaction(() => {
    db.prepare("UPDATE coupe_rolls SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(target, rollId);
    recordMovement(db, rollId, STATUS_MOVEMENT[target as keyof typeof STATUS_MOVEMENT],
      { unit: 'etat', reason }, actor);
  })();
  const detail = db
    .prepare(`${DETAIL_SELECT} WHERE r.id = ?`)
    .get(rollId) as RollDetailRow;
  return toDetail(detail);
}
