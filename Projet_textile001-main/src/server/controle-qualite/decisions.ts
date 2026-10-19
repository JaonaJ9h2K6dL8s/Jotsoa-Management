import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CqDefautDTO, ReworkRequestDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import { createSensitiveRequest } from '@/server/approvals/approvals';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCq,
  requireId,
  toNumber,
} from './common';
import { decidedDefauts } from './controls';

/**
 * Défauts et demandes de retouche. Le rebut est une décision
 * sensible : il passe par la seconde validation. L'envoi en retouche
 * crée une demande traçable (point d'intégration avec l'étape 7 —
 * le module Retouche complet n'est pas développé ici).
 */

function mapDefaut(row: {
  id: number;
  controle_id: number;
  lot_id: number;
  size_id: number;
  size_label: string;
  lot_code: string;
  defect_id: number;
  defect_nom: string;
  defect_category: string | null;
  rework_zone_nom: string | null;
  qty_pieces: number;
  description: string | null;
  severity: 'mineure' | 'majeure' | 'critique';
  decision: 'attente' | 'retouche' | 'rebut';
  declared_by_name: string | null;
  created_at: string;
}): CqDefautDTO {
  return {
    id: row.id,
    controleId: row.controle_id,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    defectId: row.defect_id,
    defectNom: row.defect_nom,
    defectCategory: row.defect_category,
    reworkZoneNom: row.rework_zone_nom,
    qtyPieces: row.qty_pieces,
    description: row.description,
    severity: row.severity,
    decision: row.decision,
    declaredByName: row.declared_by_name,
    createdAt: row.created_at,
  };
}

const DEFAUT_SELECT = `
  SELECT d.*, s.nom AS size_label, l.code AS lot_code,
         df.nom AS defect_nom, df.category AS defect_category,
         rz.nom AS rework_zone_nom,
         u.nom || ' ' || u.prenom AS declared_by_name
  FROM cq_defauts d
  JOIN sizes s ON s.id = d.size_id
  JOIN coupe_lots l ON l.id = d.lot_id
  JOIN defects df ON df.id = d.defect_id
  LEFT JOIN rework_zones rz ON rz.id = d.rework_zone_id
  JOIN users u ON u.id = d.declared_by`;

export function listDefauts(actor: Actor, filters: { controleId?: string } = {}): CqDefautDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.controleId && Number.isInteger(Number(filters.controleId))) {
    clauses.push('d.controle_id = ?');
    params.push(Number(filters.controleId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (db
    .prepare(`${DEFAUT_SELECT} ${where} ORDER BY d.id DESC LIMIT 300`)
    .all(...params) as never[]).map(mapDefaut);
}

/** Déclare un défaut constaté pendant un contrôle en cours. */
export function declareDefaut(
  actor: Actor,
  input: Record<string, unknown>,
): CqDefautDTO {
  requireCq(actor);
  const db = sessionsDb();
  const controleId = requireId(input.controleId, 'Contrôle');
  const sizeId = requireId(input.sizeId, 'Taille');
  const defectId = requireId(input.defectId, 'Catégorie de défaut');
  const qtyPieces = toNumber(input.qtyPieces, 'Le nombre de pièces');
  if (qtyPieces <= 0) {
    throw new ServiceError('Le nombre de pièces concernées doit être supérieur à 0.', 400);
  }
  const reworkZoneId =
    input.reworkZoneId === null || input.reworkZoneId === undefined
      ? null
      : requireId(input.reworkZoneId, 'Zone de retouche');
  const description = normalizeText(input.description, 500);
  const severity = String(input.severity ?? 'mineure');
  if (!['mineure', 'majeure', 'critique'].includes(severity)) {
    throw new ServiceError('Gravité invalide.', 400);
  }
  const insert = db.transaction((): number => {
    const control = db
      .prepare('SELECT id, lot_id, status FROM cq_controles WHERE id = ?')
      .get(controleId) as
      | { id: number; lot_id: number; status: string }
      | undefined;
    if (!control) throw new ServiceError('Contrôle introuvable.', 404);
    if (!['en_cours', 'incomplet'].includes(control.status)) {
      throw new ServiceError(
        'Les défauts se déclarent sur un contrôle en cours ou incomplet.',
        409,
      );
    }
    const defect = db
      .prepare('SELECT id FROM defects WHERE id = ? AND is_active = 1')
      .get(defectId) as { id: number } | undefined;
    if (!defect) {
      throw new ServiceError('Catégorie de défaut inconnue ou désactivée.', 400);
    }
    const sizeLine = db
      .prepare(
        'SELECT inspected_qty FROM cq_controle_lines WHERE controle_id = ? AND size_id = ?',
      )
      .get(controleId, sizeId) as { inspected_qty: number } | undefined;
    if (!sizeLine) {
      throw new ServiceError('Cette taille n’est pas inspectée dans ce contrôle.', 400);
    }
    const declared = db
      .prepare(
        `SELECT COALESCE(SUM(qty_pieces), 0) AS qty FROM cq_defauts
         WHERE controle_id = ? AND size_id = ?`,
      )
      .get(controleId, sizeId) as { qty: number };
    // Plusieurs défauts peuvent toucher une même pièce : on borne
    // simplement le total déclaré par l'inspecté pour éviter les
    // invraisemblances, sans préjuger du double comptage de pièces.
    if (declared.qty + qtyPieces > sizeLine.inspected_qty * 2) {
      throw new ServiceError(
        `Volume de défauts invraisemblable en taille ${sizeId} : total déclaré ${declared.qty + qtyPieces} pour ${sizeLine.inspected_qty} pièce(s) inspectée(s).`,
        400,
      );
    }
    const result = db
      .prepare(
        `INSERT INTO cq_defauts
           (controle_id, lot_id, size_id, defect_id, rework_zone_id, qty_pieces, description, severity, declared_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        controleId,
        control.lot_id,
        sizeId,
        defectId,
        reworkZoneId,
        qtyPieces,
        description,
        severity,
        actor.id,
      );
    const defautId = Number(result.lastInsertRowid);
    if (severity === 'critique') {
      raiseAlert(db, {
        category: 'DEFAUT_CRITIQUE_CQ',
        severity: 'critical',
        objectType: 'cq_defaut',
        objectId: defautId,
        message: `Défaut critique déclaré sur le contrôle #${controleId} : ${description ?? 'sans description'}.`,
        ownerRole: 'controleur_qualite',
      });
    }
    addHistory(db, {
      action: 'DEFAUT_DECLARED',
      entityType: 'cq_defaut',
      entityId: defautId,
      actorId: actor.id,
      newValue: { controleId, sizeId, defectId, qtyPieces, severity },
    });
    return defautId;
  });
  const defautId = insert();
  const row = db
    .prepare(`${DEFAUT_SELECT} WHERE d.id = ?`)
    .get(defautId) as never;
  return mapDefaut(row);
}

/**
 * Soumet une décision de rebut (opération sensible : seconde
 * validation par un autre contrôleur habilité).
 */
export function requestDefautRebut(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): { requestId: number } {
  requireCq(actor);
  const db = sessionsDb();
  const defautId = requireId(rawId, 'Défaut');
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif est obligatoire pour décider un rebut.', 400);
  }
  const defaut = db
    .prepare('SELECT id, decision FROM cq_defauts WHERE id = ?')
    .get(defautId) as { id: number; decision: string } | undefined;
  if (!defaut) throw new ServiceError('Défaut introuvable.', 404);
  if (defaut.decision !== 'attente') {
    throw new ServiceError('Ce défaut a déjà reçu une décision définitive.', 409);
  }
  const requestId = createSensitiveRequest(db, {
    action: 'decision_rebut_cq',
    entityType: 'cq_defaut',
    entityId: defautId,
    payload: { defautId },
    reason,
    requestedBy: actor.id,
  });
  raiseAlert(db, {
    category: 'REBUT_EN_ATTENTE_CQ',
    severity: 'info',
    objectType: 'cq_defaut',
    objectId: defautId,
    message: `Demande de rebut #${requestId} en attente de seconde validation.`,
    ownerRole: 'controleur_qualite',
  });
  addHistory(db, {
    action: 'REBUT_REQUESTED',
    entityType: 'cq_defaut',
    entityId: defautId,
    actorId: actor.id,
    reason,
  });
  return { requestId };
}

/** Crée une demande de retouche à partir d'un défaut (traçable). */
export function createReworkRequest(
  actor: Actor,
  input: Record<string, unknown>,
): ReworkRequestDTO {
  requireCq(actor);
  const db = sessionsDb();
  const defautId = requireId(input.defautId, 'Défaut');
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif de retouche est obligatoire.', 400);
  }
  const insert = db.transaction((): number => {
    const defaut = db
      .prepare('SELECT * FROM cq_defauts WHERE id = ?')
      .get(defautId) as
      | { id: number; controle_id: number; lot_id: number; size_id: number; qty_pieces: number; decision: string }
      | undefined;
    if (!defaut) throw new ServiceError('Défaut introuvable.', 404);
    if (defaut.decision !== 'attente') {
      throw new ServiceError('Ce défaut a déjà reçu une décision définitive.', 409);
    }
    const control = db
      .prepare('SELECT status FROM cq_controles WHERE id = ?')
      .get(defaut.controle_id) as { status: string } | undefined;
    if (!control || !['en_cours', 'incomplet'].includes(control.status)) {
      throw new ServiceError('Le contrôle d’origine n’accepte plus de décision.', 409);
    }
    const code = nextCode(db, 'cq_rework_requests', 'RT-');
    const result = db
      .prepare(
        `INSERT INTO cq_rework_requests
           (code, controle_id, lot_id, origin, status, reason, requested_by)
         VALUES (?, ?, ?, 'initial', 'en_attente', ?, ?)`,
      )
      .run(code, defaut.controle_id, defaut.lot_id, reason, actor.id);
    const requestId = Number(result.lastInsertRowid);
    db.prepare(
      'INSERT INTO cq_rework_lines (request_id, size_id, qty) VALUES (?, ?, ?)',
    ).run(requestId, defaut.size_id, defaut.qty_pieces);
    db.prepare("UPDATE cq_defauts SET decision = 'retouche' WHERE id = ?").run(defautId);
    addHistory(db, {
      action: 'REWORK_REQUESTED',
      entityType: 'cq_rework_request',
      entityId: requestId,
      actorId: actor.id,
      newValue: { code, defautId, qty: defaut.qty_pieces, sizeId: defaut.size_id },
      reason,
    });
    return requestId;
  });
  const requestId = insert();
  return getReworkRequest(actor, requestId);
}

const REWORK_SELECT = `
  SELECT rw.*, c.code AS controle_code, l.code AS lot_code,
         u.nom || ' ' || u.prenom AS requested_by_name
  FROM cq_rework_requests rw
  JOIN cq_controles c ON c.id = rw.controle_id
  JOIN coupe_lots l ON l.id = rw.lot_id
  JOIN users u ON u.id = rw.requested_by`;

function mapRework(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    controle_id: number;
    lot_id: number;
    origin: 'initial' | 'final';
    status: 'en_attente' | 'acceptee' | 'refusee' | 'annulee';
    reason: string;
    requested_by_name: string | null;
    created_at: string;
    controle_code: string;
    lot_code: string;
  },
): ReworkRequestDTO {
  const lines = db
    .prepare(
      `SELECT rwl.size_id, s.nom AS size_label, rwl.qty
       FROM cq_rework_lines rwl
       JOIN sizes s ON s.id = rwl.size_id
       WHERE rwl.request_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{ size_id: number; size_label: string; qty: number }>;
  return {
    id: row.id,
    code: row.code,
    controleId: row.controle_id,
    controleCode: row.controle_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    origin: row.origin,
    status: row.status,
    reason: row.reason,
    requestedByName: row.requested_by_name,
    createdAt: row.created_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      qty: line.qty,
    })),
  };
}

export function listReworkRequests(actor: Actor): ReworkRequestDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  return (db
    .prepare(`${REWORK_SELECT} ORDER BY rw.id DESC`)
    .all() as never[]).map((row) => mapRework(db, row));
}

export function getReworkRequest(actor: Actor, rawId: unknown): ReworkRequestDTO {
  requireCq(actor);
  const id = requireId(rawId, 'Demande de retouche');
  const row = db0().prepare(`${REWORK_SELECT} WHERE rw.id = ?`).get(id) as never;
  if (!row) throw new ServiceError('Demande de retouche introuvable.', 404);
  return mapRework(db0(), row);
}

function db0() {
  return sessionsDb();
}

/** Rejoue les bornes de cohérence après toute décision. */
export function assertDecisionsWithinInspected(
  db: ReturnType<typeof sessionsDb>,
  controleId: number,
): void {
  const lines = db
    .prepare(
      'SELECT size_id, inspected_qty, conforme_qty FROM cq_controle_lines WHERE controle_id = ?',
    )
    .all(controleId) as Array<{ size_id: number; inspected_qty: number; conforme_qty: number }>;
  for (const line of lines) {
    const decided = decidedDefauts(db, controleId, line.size_id);
    if (decided.rework + decided.rebut + line.conforme_qty > line.inspected_qty) {
      throw new ServiceError(
        `Décisions incohérentes en taille ${line.size_id} : elles dépassent la quantité inspectée.`,
        409,
      );
    }
  }
}
