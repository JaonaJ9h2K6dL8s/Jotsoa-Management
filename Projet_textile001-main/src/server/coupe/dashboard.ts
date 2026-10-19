import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { HistoryEntryDTO, RollDTO } from '@/types/coupe';
import { requireCoupe } from './common';
import { mapRoll } from './rolls';

/**
 * Tableau de bord Coupe : uniquement des compteurs calculés depuis
 * les données réelles de SQLite. Aucune statistique fictive.
 */

function countBy(db: ReturnType<typeof sessionsDb>, sql: string): Record<string, number> {
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[String(row.key)] = Number(row.value ?? 0);
  }
  return result;
}

export interface CoupeDashboardDTO {
  lotsByStatus: Record<string, number>;
  tasksByStatus: Record<string, number>;
  rollsByStatus: Record<string, number>;
  rollsLowWeight: RollDTO[];
  quantities: {
    plannedQty: number;
    cutQty: number;
    usableQty: number;
    anomalyQty: number;
  };
  waste: { count: number; totalQty: number };
  transfers: { count: number };
  recentHistory: HistoryEntryDTO[];
}

export function getDashboard(actor: Actor): CoupeDashboardDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const lowWeightRows = db
    .prepare(
      `SELECT r.*, c.nom AS color_nom
       FROM coupe_rolls r
       LEFT JOIN colors c ON c.id = r.color_id
       WHERE r.remaining_weight_kg IS NOT NULL AND r.remaining_weight_kg < 9
         AND r.status NOT IN ('epuise')
       ORDER BY r.id DESC LIMIT 10`,
    )
    .all() as Parameters<typeof mapRoll>[0][];
  const historyRows = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actor_nom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM coupe_history h
       LEFT JOIN users u ON u.id = h.actor_id
       ORDER BY h.id DESC LIMIT 12`,
    )
    .all() as Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: number;
    actor_nom: string | null;
    old_value: string | null;
    new_value: string | null;
    reason: string | null;
    created_at: string;
  }>;
  const quantities = db
    .prepare(
      `SELECT
         COALESCE(SUM(planned_qty), 0) AS planned,
         COALESCE(SUM(cut_qty), 0) AS cut,
         COALESCE(SUM(usable_qty), 0) AS usable,
         COALESCE(SUM(anomaly_qty), 0) AS anomaly
       FROM coupe_results`,
    )
    .get() as { planned: number; cut: number; usable: number; anomaly: number };
  const waste = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(qty), 0) AS total FROM coupe_waste`,
    )
    .get() as { count: number; total: number };
  const transfers = db
    .prepare(`SELECT COUNT(*) AS count FROM coupe_transfers`)
    .get() as { count: number };
  return {
    lotsByStatus: countBy(
      db,
      "SELECT status AS key, COUNT(*) AS value FROM coupe_lots GROUP BY status",
    ),
    tasksByStatus: countBy(
      db,
      "SELECT status AS key, COUNT(*) AS value FROM coupe_tasks GROUP BY status",
    ),
    rollsByStatus: countBy(
      db,
      "SELECT status AS key, COUNT(*) AS value FROM coupe_rolls GROUP BY status",
    ),
    rollsLowWeight: lowWeightRows.map(mapRoll),
    quantities: {
      plannedQty: quantities.planned,
      cutQty: quantities.cut,
      usableQty: quantities.usable,
      anomalyQty: quantities.anomaly,
    },
    waste: { count: waste.count, totalQty: waste.total },
    transfers,
    recentHistory: historyRows.map(
      (row): HistoryEntryDTO => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorNom: row.actor_nom,
        oldValue: row.old_value,
        newValue: row.new_value,
        reason: row.reason,
        createdAt: row.created_at,
      }),
    ),
  };
}
