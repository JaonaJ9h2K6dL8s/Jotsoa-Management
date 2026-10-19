import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { ProductionDTO } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import { createSensitiveRequest } from '@/server/approvals/approvals';
import {
  addHistory,
  normalizeText,
  requireCouture,
  requireId,
  setLotStatus,
  toNumber,
} from './common';

/**
 * Enregistrement de la production réellement cousue.
 * Plusieurs enregistrements sont possibles pour une même affectation ;
 * le total cousu ne peut jamais dépasser la quantité prévue par taille.
 * La correction ou l'annulation d'une production est une opération
 * sensible : elle passe par une seconde validation.
 */

const PRODUCTION_SELECT = `
  SELECT p.*, u.nom || ' ' || u.prenom AS operator_name,
         r.nom || ' ' || r.prenom AS recorded_by_name
  FROM couture_productions p
  LEFT JOIN users u ON u.id = p.operator_id
  JOIN users r ON r.id = p.recorded_by`;

function mapProduction(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    assignment_id: number;
    lot_id: number;
    size_id: number;
    qty: number;
    operator_id: number | null;
    operator_name: string | null;
    recorded_by_name: string | null;
    status: 'normal' | 'corrigee' | 'annulee';
    notes: string | null;
    created_at: string;
  },
): ProductionDTO {
  const assignment = db
    .prepare(
      `SELECT a.code, a.lot_id, l.code AS lot_code, s.nom AS size_label
       FROM couture_assignments a
       JOIN coupe_lots l ON l.id = a.lot_id
       JOIN sizes s ON s.id = ?
       WHERE a.id = ?`,
    )
    .get(row.size_id, row.assignment_id) as
    | { code: string; lot_id: number; lot_code: string; size_label: string }
    | undefined;
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    assignmentCode: assignment?.code ?? '',
    lotId: row.lot_id,
    lotCode: assignment?.lot_code ?? '',
    sizeId: row.size_id,
    sizeLabel: assignment?.size_label ?? '',
    qty: row.qty,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    recordedByName: row.recorded_by_name,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function listProductions(
  actor: Actor,
  filters: { lotId?: string; assignmentId?: string } = {},
): ProductionDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.lotId && Number.isInteger(Number(filters.lotId))) {
    clauses.push('p.lot_id = ?');
    params.push(Number(filters.lotId));
  }
  if (filters.assignmentId && Number.isInteger(Number(filters.assignmentId))) {
    clauses.push('p.assignment_id = ?');
    params.push(Number(filters.assignmentId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${PRODUCTION_SELECT} ${where} ORDER BY p.id DESC LIMIT 500`)
    .all(...params) as Array<Parameters<typeof mapProduction>[1]>;
  return rows.map((row) => mapProduction(db, row));
}

/** Couture par taille pour une affectation (hors corrections/annulations). */
function sewnForAssignment(
  db: ReturnType<typeof sessionsDb>,
  assignmentId: number,
  sizeId: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
       WHERE assignment_id = ? AND size_id = ? AND status = 'normal'`,
    )
    .get(assignmentId, sizeId) as { sewn: number };
  return row.sewn;
}

/** Transféré CQ pour une affectation (statut confirmé uniquement). */
export function transferredCqForAssignment(
  db: ReturnType<typeof sessionsDb>,
  assignmentId: number,
  sizeId: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ctl.qty), 0) AS qty FROM couture_transfer_lines ctl
       JOIN couture_transfers t ON t.id = ctl.transfer_id
       WHERE t.assignment_id = ? AND t.status = 'confirme' AND ctl.size_id = ?`,
    )
    .get(assignmentId, sizeId) as { qty: number };
  return row.qty;
}

export function recordProduction(
  actor: Actor,
  input: Record<string, unknown>,
): ProductionDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const assignmentId = requireId(input.assignmentId, 'Affectation');
  const sizeId = requireId(input.sizeId, 'Taille');
  const qty = toNumber(input.qty, 'La quantité cousue');
  if (qty <= 0) {
    throw new ServiceError('La quantité cousue doit être supérieure à 0.', 400);
  }
  const operatorId =
    input.operatorId === null || input.operatorId === undefined
      ? null
      : requireId(input.operatorId, 'Opérateur');
  const notes = normalizeText(input.notes, 500);
  // Pré-validation hors transaction : l'alerte doit survivre au refus.
  const assignment = db
    .prepare('SELECT id, lot_id, status FROM couture_assignments WHERE id = ?')
    .get(assignmentId) as
    | { id: number; lot_id: number; status: string }
    | undefined;
  if (!assignment) {
    throw new ServiceError('Affectation introuvable.', 404);
  }
  if (!['affecte', 'en_cours'].includes(assignment.status)) {
    throw new ServiceError(
      'La production ne peut être enregistrée que sur une affectation affectée ou en cours.',
      409,
    );
  }
  const planned = db
    .prepare(
      'SELECT planned_qty FROM couture_assignment_sizes WHERE assignment_id = ? AND size_id = ?',
    )
    .get(assignmentId, sizeId) as { planned_qty: number } | undefined;
  if (!planned) {
    throw new ServiceError(
      'Cette taille ne fait pas partie de l’affectation concernée.',
      400,
    );
  }
  const sewn = sewnForAssignment(db, assignmentId, sizeId);
  if (sewn + qty > planned.planned_qty) {
    raiseAlert(db, {
      category: 'PRODUCTION_EXCEDENT',
      severity: 'warning',
      objectType: 'affectation',
      objectId: assignmentId,
      message: `Tentative d'enregistrement de ${qty} pièce(s) cousues alors que le prévu de l'affectation est de ${planned.planned_qty} (déjà cousu : ${sewn}).`,
      ownerRole: 'chef_couture',
    });
    throw new ServiceError(
      `Production refusée : déjà cousu ${sewn} / prévu ${planned.planned_qty}.`,
      409,
    );
  }
  const insert = db.transaction((): number => {
    const current = db
      .prepare('SELECT id, lot_id, status FROM couture_assignments WHERE id = ?')
      .get(assignmentId) as
      | { id: number; lot_id: number; status: string }
      | undefined;
    if (!current || !['affecte', 'en_cours'].includes(current.status)) {
      throw new ServiceError(
        'La production ne peut être enregistrée que sur une affectation affectée ou en cours.',
        409,
      );
    }
    const sewnInTx = sewnForAssignment(db, assignmentId, sizeId);
    if (sewnInTx + qty > planned.planned_qty) {
      throw new ServiceError(
        `Production refusée : déjà cousu ${sewnInTx} / prévu ${planned.planned_qty}.`,
        409,
      );
    }
    const result = db
      .prepare(
        `INSERT INTO couture_productions
           (assignment_id, lot_id, size_id, qty, operator_id, recorded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(assignmentId, current.lot_id, sizeId, qty, operatorId, actor.id, notes);
    const productionId = Number(result.lastInsertRowid);
    if (current.status === 'affecte') {
      db.prepare(
        "UPDATE couture_assignments SET status = 'en_cours', updated_at = datetime('now') WHERE id = ?",
      ).run(assignmentId);
    }
    setLotStatus(db, current.lot_id, 'en_cours');
    addHistory(db, {
      action: 'PRODUCTION_RECORDED',
      entityType: 'production',
      entityId: productionId,
      actorId: actor.id,
      newValue: { assignmentId, sizeId, qty, operatorId },
    });
    return productionId;
  });
  const productionId = insert();
  const row = db
    .prepare(`${PRODUCTION_SELECT} WHERE p.id = ?`)
    .get(productionId) as Parameters<typeof mapProduction>[1];
  return mapProduction(db, row);
}

/**
 * Soumet une correction de production (opération sensible). La
 * modification n'est appliquée qu'après approbation par un autre
 * utilisateur habilité.
 */
export function requestProductionCorrection(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): { requestId: number } {
  requireCouture(actor);
  const db = sessionsDb();
  const productionId = requireId(rawId, 'Production');
  const newQty = toNumber(input.newQty, 'La nouvelle quantité');
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif est obligatoire pour corriger une production.', 400);
  }
  const production = db
    .prepare('SELECT * FROM couture_productions WHERE id = ?')
    .get(productionId) as
    | { id: number; assignment_id: number; size_id: number; qty: number; status: string }
    | undefined;
  if (!production) throw new ServiceError('Production introuvable.', 404);
  if (production.status !== 'normal') {
    throw new ServiceError('Seule une production active peut être corrigée.', 409);
  }
  if (newQty <= 0) {
    throw new ServiceError('La nouvelle quantité doit être supérieure à 0.', 400);
  }
  if (newQty === production.qty) {
    throw new ServiceError('La nouvelle quantité est identique à l’ancienne.', 400);
  }
  const planned = db
    .prepare(
      'SELECT planned_qty FROM couture_assignment_sizes WHERE assignment_id = ? AND size_id = ?',
    )
    .get(production.assignment_id, production.size_id) as
    | { planned_qty: number }
    | undefined;
  if (planned) {
    const sewn = sewnForAssignment(db, production.assignment_id, production.size_id);
    if (sewn - production.qty + newQty > planned.planned_qty) {
      throw new ServiceError(
        `Correction refusée : le total cousu dépasserait le prévu (${planned.planned_qty}).`,
        409,
      );
    }
  }
  const requestId = createSensitiveRequest(db, {
    action: 'correction_production',
    entityType: 'production',
    entityId: productionId,
    payload: { productionId, newQty, previousQty: production.qty },
    reason,
    requestedBy: actor.id,
  });
  addHistory(db, {
    action: 'PRODUCTION_CORRECTION_REQUESTED',
    entityType: 'production',
    entityId: productionId,
    actorId: actor.id,
    oldValue: { qty: production.qty },
    newValue: { qty: newQty },
    reason,
  });
  return { requestId };
}

/** Soumet l'annulation d'une production (opération sensible). */
export function requestProductionCancel(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): { requestId: number } {
  requireCouture(actor);
  const db = sessionsDb();
  const productionId = requireId(rawId, 'Production');
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif est obligatoire pour annuler une production.', 400);
  }
  const production = db
    .prepare('SELECT id, status FROM couture_productions WHERE id = ?')
    .get(productionId) as { id: number; status: string } | undefined;
  if (!production) throw new ServiceError('Production introuvable.', 404);
  if (production.status !== 'normal') {
    throw new ServiceError('Seule une production active peut être annulée.', 409);
  }
  const requestId = createSensitiveRequest(db, {
    action: 'annulation_production',
    entityType: 'production',
    entityId: productionId,
    payload: { productionId },
    reason,
    requestedBy: actor.id,
  });
  addHistory(db, {
    action: 'PRODUCTION_CANCEL_REQUESTED',
    entityType: 'production',
    entityId: productionId,
    actorId: actor.id,
    reason,
  });
  return { requestId };
}
