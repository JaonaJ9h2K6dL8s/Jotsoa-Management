import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StAlertDTO, StHistoryDTO } from '@/types/stock';
import { requireStock } from './common';

/** Historique du module Stock et alertes destinées au chef_stock. */

interface HistoryRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  actor_nom: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
}

export function listHistory(actor: Actor): StHistoryDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom,
                h.old_value, h.new_value, h.reason, h.created_at
         FROM st_history h
         LEFT JOIN users u ON u.id = h.actor_id
         ORDER BY h.id DESC LIMIT 400`,
      )
      .all() as HistoryRow[]
  ).map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorNom: row.actor_nom,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export function listAlerts(actor: Actor): StAlertDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT id, category, severity, object_type, object_id, message,
              owner_role, status, created_at
       FROM alerts
       WHERE owner_role = 'chef_stock'
       ORDER BY id DESC LIMIT 300`,
    )
    .all() as Array<{
    id: number;
    category: string;
    severity: string;
    object_type: string | null;
    object_id: number | null;
    message: string;
    owner_role: string | null;
    status: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    objectType: row.object_type,
    objectId: row.object_id,
    message: row.message,
    ownerRole: row.owner_role,
    status: row.status,
    createdAt: row.created_at,
  }));
}
