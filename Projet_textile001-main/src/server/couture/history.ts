import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { AlertDTO, CoutureHistoryDTO } from '@/types/couture';
import { updateAlertStatus, type AlertStatus } from '@/server/alerts/alerts';
import { addHistory, normalizeText, requireCouture, requireId } from './common';

/**
 * Consultation de l'historique du module Couture et des alertes.
 * L'historique est en lecture seule ; les alertes suivent des
 * transitions contrôlées et exigent une résolution explicite.
 */
export function listHistory(
  actor: Actor,
  filters: { entityType?: string; entityId?: string; limit?: string } = {},
): CoutureHistoryDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.entityType) {
    clauses.push('h.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.entityId && Number.isInteger(Number(filters.entityId))) {
    clauses.push('h.entity_id = ?');
    params.push(Number(filters.entityId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit ?? 200) || 200, 1), 500);
  const rows = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actorNom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM couture_history h
       LEFT JOIN users u ON u.id = h.actor_id
       ${where} ORDER BY h.id DESC LIMIT ${limit}`,
    )
    .all(...params) as Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: number;
    actorNom: string | null;
    old_value: string | null;
    new_value: string | null;
    reason: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorNom: row.actorNom,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

function toAlertDTO(row: {
  id: number;
  category: string;
  severity: string;
  object_type: string | null;
  object_id: number | null;
  message: string;
  owner_role: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
}): AlertDTO {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    objectType: row.object_type,
    objectId: row.object_id,
    message: row.message,
    ownerRole: row.owner_role,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
  };
}

/** Alertes destinées au chef de couture. */
export function listAlerts(
  actor: Actor,
  filters: { status?: string } = {},
): AlertDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const clauses = ["owner_role = 'chef_couture'"];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const rows = db
    .prepare(
      `SELECT * FROM alerts WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 200`,
    )
    .all(...params) as Array<Parameters<typeof toAlertDTO>[0]>;
  return rows.map(toAlertDTO);
}

/** Transition contrôlée du statut d'une alerte. */
export function patchAlert(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): void {
  requireCouture(actor);
  const db = sessionsDb();
  const id = requireId(rawId, 'Alerte');
  const status = String(input.status ?? '') as AlertStatus;
  if (!['nouvelle', 'en_cours', 'resolue', 'cloturee'].includes(status)) {
    throw new ServiceError('Statut d’alerte inconnu.', 400);
  }
  const resolution = normalizeText(input.resolution, 500);
  const alert = db
    .prepare('SELECT * FROM alerts WHERE id = ?')
    .get(id) as { id: number; status: string } | undefined;
  if (!alert) throw new ServiceError('Alerte introuvable.', 404);
  updateAlertStatus(db, id, status, resolution);
  addHistory(db, {
    action: 'ALERT_STATUS_CHANGED',
    entityType: 'alerte',
    entityId: id,
    actorId: actor.id,
    oldValue: { status: alert.status },
    newValue: { status },
    reason: resolution,
  });
}
