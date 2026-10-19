import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { HistoryEntryDTO } from '@/types/coupe';
import { requireCoupe } from './common';

/**
 * Historique du module Coupe : traçabilité complète et non modifiable
 * des opérations importantes.
 */

export function listHistory(
  actor: Actor,
  filters: { entityType?: string; entityId?: string; limit?: string } = {},
): HistoryEntryDTO[] {
  requireCoupe(actor);
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
  const limitRaw = Number(filters.limit ?? 100);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 300) : 100;
  const rows = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actor_nom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM coupe_history h
       LEFT JOIN users u ON u.id = h.actor_id
       ${where}
       ORDER BY h.id DESC
       LIMIT ${limit}`,
    )
    .all(...params) as Array<
    Omit<HistoryEntryDTO, 'actorNom'> & { actor_nom: string | null }
  >;
  return rows.map((row) => ({ ...row, actorNom: row.actor_nom }));
}
