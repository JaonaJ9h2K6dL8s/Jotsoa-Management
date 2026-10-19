import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StDashboardDTO } from '@/types/stock';
import { requireStock } from './common';
import { listBalances } from './movements';
import { listWasteStock } from './waste';

/** Tableau de bord du stock : uniquement des données réelles. */
export function getDashboard(actor: Actor): StDashboardDTO {
  requireStock(actor);
  const db = sessionsDb();
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'cloture' THEN 1 ELSE 0 END) AS in_stock,
         SUM(CASE WHEN status = 'remplissage' THEN 1 ELSE 0 END) AS filling,
         SUM(CASE WHEN status = 'bloque' THEN 1 ELSE 0 END) AS blocked,
         COUNT(*) AS total
       FROM st_cartons WHERE status != 'annule'`,
    )
    .get() as {
    in_stock: number | null;
    filling: number | null;
    blocked: number | null;
    total: number | null;
  };
  const pendingCqTransfers = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cq_stock_transfers t
       WHERE t.status = 'confirme'
         AND NOT EXISTS (SELECT 1 FROM st_entries e WHERE e.transfer_id = t.id)`,
    )
    .get() as { n: number };
  const inventoriesInProgress = db
    .prepare(
      `SELECT COUNT(*) AS n FROM st_inventories
       WHERE status IN ('comptage','ecarts','attente_validation')`,
    )
    .get() as { n: number };
  const pendingAdjustments = db
    .prepare(
      `SELECT COUNT(*) AS n FROM st_adjustments WHERE status = 'en_attente'`,
    )
    .get() as { n: number };
  const openAlerts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM alerts
       WHERE owner_role = 'chef_stock' AND status IN ('nouvelle','en_cours')`,
    )
    .get() as { n: number };
  const totalPieces = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN -qty ELSE qty END), 0) AS total
       FROM st_movements WHERE movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')`,
    )
    .get() as { total: number };
  const locationsCount = db
    .prepare('SELECT COUNT(*) AS n FROM st_locations WHERE is_active = 1')
    .get() as { n: number };
  const recentHistory = (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom,
                h.old_value, h.new_value, h.reason, h.created_at
         FROM st_history h LEFT JOIN users u ON u.id = h.actor_id
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
    }>
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
  return {
    cartonsInStock: counts.in_stock ?? 0,
    cartonsFilling: counts.filling ?? 0,
    cartonsBlocked: counts.blocked ?? 0,
    cartonsCount: counts.total ?? 0,
    pendingCqTransfers: pendingCqTransfers.n,
    inventoriesInProgress: inventoriesInProgress.n,
    pendingAdjustments: pendingAdjustments.n,
    openAlerts: openAlerts.n,
    totalPiecesInStock: totalPieces.total,
    locationsCount: locationsCount.n,
    balances: listBalances(actor).slice(0, 30),
    waste: listWasteStock(actor),
    recentHistory,
  };
}
