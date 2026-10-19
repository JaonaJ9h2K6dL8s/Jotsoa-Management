import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SensitiveRequestDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  approveSensitiveRequest,
  listPendingRequests,
  refuseSensitiveRequest,
  getRequestById,
  type SensitiveRequestRow,
} from '@/server/approvals/approvals';
import { addHistory, requireCq, requireId } from './common';
import { assertDecisionsWithinInspected } from './decisions';

/**
 * Traitement des secondes validations du module Contrôle qualité
 * (décisions de rebut notamment). L'auteur d'une demande ne peut
 * jamais l'approuver lui-même ; seul un autre contrôleur habilité
 * décide — règle imposée par le mécanisme central.
 */

const ALLOWED_ROLES = ['controleur_qualite'];

function toDTO(
  row: SensitiveRequestRow & { requester_nom?: string | null; decided_by_name?: string | null },
): SensitiveRequestDTO {
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
    decidedByName: row.decided_by_name ?? null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}

export function listSensitiveRequests(actor: Actor): SensitiveRequestDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  const pending = listPendingRequests(db).filter(
    (row) => row.action === 'decision_rebut_cq',
  );
  const decided = db
    .prepare(
      `SELECT r.*, u.nom || ' ' || u.prenom AS requester_nom,
              d.nom || ' ' || d.prenom AS decided_by_name
       FROM sensitive_requests r
       LEFT JOIN users u ON u.id = r.requested_by
       LEFT JOIN users d ON d.id = r.decided_by
       WHERE r.action = 'decision_rebut_cq' AND r.status != 'en_attente'
       ORDER BY r.id DESC LIMIT 50`,
    )
    .all() as Array<SensitiveRequestRow & {
    requester_nom: string | null;
    decided_by_name: string | null;
  }>;
  return [...pending.map(toDTO), ...decided.map(toDTO)];
}

/** Applique une décision de rebut approuvée. */
function applyRebutDecision(
  db: ReturnType<typeof sessionsDb>,
  approver: Actor,
  payload: unknown,
): void {
  const data = payload as { defautId: number };
  const defaut = db
    .prepare('SELECT id, controle_id, decision FROM cq_defauts WHERE id = ?')
    .get(data.defautId) as
    | { id: number; controle_id: number; decision: string }
    | undefined;
  if (!defaut) {
    throw new ServiceError('Le défaut à rebutter n’existe plus.', 404);
  }
  if (defaut.decision !== 'attente') {
    throw new ServiceError(
      'Ce défaut a déjà reçu une décision définitive : la validation est obsolète.',
      409,
    );
  }
  db.prepare("UPDATE cq_defauts SET decision = 'rebut' WHERE id = ?").run(defaut.id);
  // La cohérence globale est rejouée : si le rebut dépasse l'inspecté,
  // la transaction entière est annulée et l'approbation échoue.
  assertDecisionsWithinInspected(db, defaut.controle_id);
  addHistory(db, {
    action: 'REBUT_DECIDED',
    entityType: 'cq_defaut',
    entityId: defaut.id,
    actorId: approver.id,
    oldValue: { decision: 'attente' },
    newValue: { decision: 'rebut' },
  });
}

export function decideSensitiveRequest(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireCq(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const decision = String(input.decision ?? '');
  const note = typeof input.note === 'string' ? input.note : '';
  const request = getRequestById(db, requestId);
  if (!request) throw new ServiceError('Demande introuvable.', 404);
  if (request.action !== 'decision_rebut_cq') {
    throw new ServiceError(`Type de demande inconnu : ${request.action}.`, 400);
  }
  if (decision === 'approve') {
    approveSensitiveRequest(db, {
      requestId,
      approver: { id: actor.id, roleCode: actor.roleCode },
      allowedRoles: ALLOWED_ROLES,
      note: note.trim() || null,
      apply: (payload) => applyRebutDecision(db, actor, payload),
    });
    raiseAlert(db, {
      category: 'SECONDE_VALIDATION_APPROUVEE',
      severity: 'info',
      objectType: request.entity_type,
      objectId: request.entity_id,
      message: `Demande de rebut #${request.id} approuvée et appliquée.`,
      ownerRole: 'controleur_qualite',
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
      message: `Demande de rebut #${request.id} refusée.`,
      ownerRole: 'controleur_qualite',
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
