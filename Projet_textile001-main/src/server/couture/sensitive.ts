import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SensitiveRequestDTO } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  approveSensitiveRequest,
  listPendingRequests,
  refuseSensitiveRequest,
  getRequestById,
  type SensitiveRequestRow,
} from '@/server/approvals/approvals';
import { addHistory, requireCouture, requireId, setLotStatus } from './common';
import { transferredCqForAssignment } from './productions';
import { getSizeBalances } from './balances';

/**
 * Traitement des secondes validations du module Couture. L'auteur
 * d'une demande ne peut jamais l'approuver lui-même (contrôlé dans le
 * mécanisme central) ; seul un autre chef de couture habilité décide.
 */

const ALLOWED_ROLES = ['chef_couture'];

function toDTO(row: SensitiveRequestRow & { requester_nom?: string | null }): SensitiveRequestDTO {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    reason: row.reason,
    status: row.status,
    requestedByName: row.requester_nom ?? null,
    requestedAt: row.requested_at,
    decidedByName: null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}

export function listSensitiveRequests(actor: Actor): SensitiveRequestDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const pending = listPendingRequests(db);
  const decided = db
    .prepare(
      `SELECT r.*, u.nom || ' ' || u.prenom AS requester_nom,
              d.nom || ' ' || d.prenom AS decided_by_name
       FROM sensitive_requests r
       LEFT JOIN users u ON u.id = r.requested_by
       LEFT JOIN users d ON d.id = r.decided_by
       WHERE r.status != 'en_attente'
       ORDER BY r.id DESC LIMIT 50`,
    )
    .all() as Array<SensitiveRequestRow & {
    requester_nom: string | null;
    decided_by_name: string | null;
  }>;
  return [
    ...pending.map(toDTO),
    ...decided.map((row) => ({
      ...toDTO(row),
      decidedByName: row.decided_by_name,
    })),
  ];
}

/** Applique une correction de production approuvée. */
function applyCorrectionProduction(
  db: ReturnType<typeof sessionsDb>,
  approver: Actor,
  payload: unknown,
): void {
  const data = payload as { productionId: number; newQty: number; previousQty: number };
  const production = db
    .prepare('SELECT * FROM couture_productions WHERE id = ?')
    .get(data.productionId) as
    | { id: number; assignment_id: number; lot_id: number; size_id: number; qty: number; status: string }
    | undefined;
  if (!production || production.status !== 'normal') {
    throw new ServiceError(
      'La production à corriger n’est plus active : la validation est obsolète.',
      409,
    );
  }
  const planned = db
    .prepare(
      'SELECT planned_qty FROM couture_assignment_sizes WHERE assignment_id = ? AND size_id = ?',
    )
    .get(production.assignment_id, production.size_id) as
    | { planned_qty: number }
    | undefined;
  const sewn = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
       WHERE assignment_id = ? AND size_id = ? AND status = 'normal'`,
    )
    .get(production.assignment_id, production.size_id) as { sewn: number };
  if (planned && sewn.sewn - production.qty + data.newQty > planned.planned_qty) {
    throw new ServiceError(
      `Correction impossible : le total cousu dépasserait le prévu (${planned.planned_qty}).`,
      409,
    );
  }
  const transferredCq = transferredCqForAssignment(
    db,
    production.assignment_id,
    production.size_id,
  );
  if (sewn.sewn - production.qty + data.newQty < transferredCq) {
    raiseAlert(db, {
      category: 'CORRECTION_SOUS_TRANSFERT',
      severity: 'critical',
      objectType: 'affectation',
      objectId: production.assignment_id,
      message: `Correction de production qui ferait passer le cousu sous le quantité déjà transférée au contrôle qualité (${transferredCq}).`,
      ownerRole: 'chef_couture',
    });
    throw new ServiceError(
      'Correction refusée : la quantité déjà transférée au contrôle qualité serait dépassée.',
      409,
    );
  }
  db.prepare(
    "UPDATE couture_productions SET status = 'corrigee', updated_at = datetime('now') WHERE id = ?",
  ).run(production.id);
  db.prepare(
    `INSERT INTO couture_productions
       (assignment_id, lot_id, size_id, qty, operator_id, recorded_by, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'normal', ?)`,
  ).run(
    production.assignment_id,
    production.lot_id,
    production.size_id,
    data.newQty,
    null,
    approver.id,
    `Correction de la production #${production.id} approuvée.`,
  );
  addHistory(db, {
    action: 'PRODUCTION_CORRECTED',
    entityType: 'production',
    entityId: production.id,
    actorId: approver.id,
    oldValue: { qty: production.qty },
    newValue: { qty: data.newQty },
  });
}

/** Applique une annulation de production approuvée. */
function applyCancelProduction(
  db: ReturnType<typeof sessionsDb>,
  approver: Actor,
  payload: unknown,
): void {
  const data = payload as { productionId: number };
  const production = db
    .prepare('SELECT * FROM couture_productions WHERE id = ?')
    .get(data.productionId) as
    | { id: number; assignment_id: number; size_id: number; qty: number; status: string }
    | undefined;
  if (!production || production.status !== 'normal') {
    throw new ServiceError('La production à annuler n’est plus active.', 409);
  }
  const transferredCq = transferredCqForAssignment(
    db,
    production.assignment_id,
    production.size_id,
  );
  const sewn = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
       WHERE assignment_id = ? AND size_id = ? AND status = 'normal'`,
    )
    .get(production.assignment_id, production.size_id) as { sewn: number };
  if (sewn.sewn - production.qty < transferredCq) {
    throw new ServiceError(
      'Annulation refusée : la quantité déjà transférée au contrôle qualité serait dépassée.',
      409,
    );
  }
  db.prepare(
    "UPDATE couture_productions SET status = 'annulee', updated_at = datetime('now') WHERE id = ?",
  ).run(production.id);
  addHistory(db, {
    action: 'PRODUCTION_CANCELLED',
    entityType: 'production',
    entityId: production.id,
    actorId: approver.id,
    oldValue: { qty: production.qty },
  });
}

/** Applique l'annulation d'un transfert CQ approuvée. */
function applyCancelTransfer(
  db: ReturnType<typeof sessionsDb>,
  approver: Actor,
  payload: unknown,
): void {
  const data = payload as { transferId: number };
  const transfer = db
    .prepare('SELECT * FROM couture_transfers WHERE id = ?')
    .get(data.transferId) as
    | { id: number; lot_id: number; status: string }
    | undefined;
  if (!transfer || transfer.status !== 'confirme') {
    throw new ServiceError('Le transfert à annuler n’est plus confirmé.', 409);
  }
  db.prepare(
    "UPDATE couture_transfers SET status = 'annule' WHERE id = ?",
  ).run(transfer.id);
  const balances = getSizeBalances(db, transfer.lot_id);
  const remaining = balances.reduce(
    (acc, size) => acc + Math.max(0, size.sewn - size.transferredCq),
    0,
  );
  if (remaining > 0) {
    setLotStatus(db, transfer.lot_id, 'attente_transfert');
  }
  addHistory(db, {
    action: 'TRANSFER_CQ_CANCELLED',
    entityType: 'transfert_cq',
    entityId: transfer.id,
    actorId: approver.id,
  });
}

export function decideSensitiveRequest(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireCouture(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const decision = String(input.decision ?? '');
  const note = typeof input.note === 'string' ? input.note : '';
  const request = getRequestById(db, requestId);
  if (!request) throw new ServiceError('Demande introuvable.', 404);
  if (decision === 'approve') {
    approveSensitiveRequest(db, {
      requestId,
      approver: { id: actor.id, roleCode: actor.roleCode },
      allowedRoles: ALLOWED_ROLES,
      note: note.trim() || null,
      apply: (payload) => {
        if (request.action === 'correction_production') {
          applyCorrectionProduction(db, actor, payload);
        } else if (request.action === 'annulation_production') {
          applyCancelProduction(db, actor, payload);
        } else if (request.action === 'annulation_transfert_couture') {
          applyCancelTransfer(db, actor, payload);
        } else {
          throw new ServiceError(
            `Type de demande inconnu : ${request.action}.`,
            400,
          );
        }
      },
    });
    raiseAlert(db, {
      category: 'SECONDE_VALIDATION_APPROUVEE',
      severity: 'info',
      objectType: request.entity_type,
      objectId: request.entity_id,
      message: `Demande #${request.id} (${request.action}) approuvée et appliquée.`,
      ownerRole: 'chef_couture',
    });
    addHistory(db, {
      action: 'SENSITIVE_APPROVED',
      entityType: 'demande_sensitive',
      entityId: requestId,
      actorId: actor.id,
      newValue: { action: request.action },
    });
  } else if (decision === 'refuse') {
    refuseSensitiveRequest(db, {
      requestId,
      approver: { id: actor.id, roleCode: actor.roleCode },
      allowedRoles: ALLOWED_ROLES,
      note,
    });
    raiseAlert(db, {
      category: 'SECONDE_VALIDATION_REFUSEE',
      severity: 'warning',
      objectType: request.entity_type,
      objectId: request.entity_id,
      message: `Demande #${request.id} (${request.action}) refusée.`,
      ownerRole: 'chef_couture',
    });
    addHistory(db, {
      action: 'SENSITIVE_REFUSED',
      entityType: 'demande_sensitive',
      entityId: requestId,
      actorId: actor.id,
      newValue: { action: request.action },
    });
  } else {
    throw new ServiceError('Décision inconnue : approuver ou refuser.', 400);
  }
}
