import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CqDashboardDTO } from '@/types/cq';
import { requireCq } from './common';
import { getLotBalances } from './balances';

/**
 * Tableau de bord Contrôle qualité : uniquement des données réelles
 * issues de SQLite. Les quantités proviennent des mouvements réels
 * (réceptions, contrôles, retouches, contrôles finaux, transferts).
 */
export function getDashboard(actor: Actor): CqDashboardDTO {
  requireCq(actor);
  const db = sessionsDb();
  const controlsByStatus: Record<string, number> = {};
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS total FROM cq_controles GROUP BY status')
    .all() as Array<{ status: string; total: number }>) {
    controlsByStatus[row.status] = row.total;
  }
  const receptionsCount = (
    db.prepare('SELECT COUNT(*) AS total FROM cq_receptions').get() as { total: number }
  ).total;
  const balances = getLotBalances(actor);
  const sum = (key: 'totalReceived' | 'totalInspected' | 'totalConforme' | 'totalRework' | 'totalRebut' | 'totalAvailableStock') =>
    balances.reduce((acc, lot) => acc + lot[key], 0);
  const receivedQty = sum('totalReceived');
  const inspectedQty = sum('totalInspected');
  const conformeQty = sum('totalConforme');
  const reworkQty = sum('totalRework');
  const rebutQty = sum('totalRebut');
  const availableStockQty = sum('totalAvailableStock');
  const transferredStockQty = db
    .prepare(
      `SELECT COALESCE(SUM(stl.qty), 0) AS total
       FROM cq_stock_transfer_lines stl
       JOIN cq_stock_transfers st ON st.id = stl.transfer_id
       WHERE st.status = 'confirme'`,
    )
    .get() as { total: number };
  // Défauts = pièces défectueuses décidées retouche/rebut + défauts
  // encore en attente de décision (jamais confondus avec les pièces).
  const defautQty = (
    db
      .prepare(
        `SELECT COALESCE(SUM(qty_pieces), 0) AS total FROM cq_defauts
         WHERE decision IN ('retouche','rebut')`,
      )
      .get() as { total: number }
  ).total;
  const pendingQty = Math.max(0, receivedQty - inspectedQty);
  const pendingReworkRequests = (
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM cq_rework_requests WHERE status = 'en_attente'",
      )
      .get() as { total: number }
  ).total;
  const openAlerts = (
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM alerts WHERE status IN ('nouvelle','en_cours') AND owner_role = 'controleur_qualite'",
      )
      .get() as { total: number }
  ).total;
  const pendingRequests = (
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM sensitive_requests WHERE status = 'en_attente' AND action = 'decision_rebut_cq'",
      )
      .get() as { total: number }
  ).total;
  // Taux de conformité = conforme / inspecté ; non applicable si
  // aucune pièce inspectée (dénominateur nul → null, jamais 0).
  const conformanceRate =
    inspectedQty > 0 ? Math.round((conformeQty / inspectedQty) * 1000) / 10 : null;
  const recentHistory = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actorNom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM cq_history h
       LEFT JOIN users u ON u.id = h.actor_id
       ORDER BY h.id DESC LIMIT 15`,
    )
    .all() as Array<{
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
  return {
    controlsByStatus,
    receptionsCount,
    quantities: {
      receivedQty,
      inspectedQty,
      conformeQty,
      defautQty,
      reworkQty,
      rebutQty,
      pendingQty,
      availableStockQty,
      transferredStockQty: transferredStockQty.total,
    },
    pendingReworkRequests,
    openAlerts,
    pendingRequests,
    conformanceRate,
    recentHistory: recentHistory.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorNom: row.actorNom,
      oldValue: row.old_value,
      newValue: row.new_value,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}
