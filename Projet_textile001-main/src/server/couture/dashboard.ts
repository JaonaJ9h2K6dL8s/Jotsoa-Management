import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CoutureDashboardDTO } from '@/types/couture';
import { requireCouture } from './common';
import { getLotBalances } from './balances';

/**
 * Tableau de bord Couture : uniquement des données réelles calculées
 * depuis SQLite. Une tâche terminée non validée n'est jamais confondue
 * avec une production comptabilisée ; les statuts viennent des tables
 * de suivi, les quantités des mouvements réels.
 */
export function getDashboard(actor: Actor): CoutureDashboardDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const lotsByStatus: Record<string, number> = {};
  for (const row of db
    .prepare(
      `SELECT COALESCE(cs.status, 'en_attente_reception') AS status, COUNT(*) AS total
       FROM coupe_lots l
       JOIN coupe_transfers t ON t.lot_id = l.id AND t.status = 'confirme'
       LEFT JOIN couture_lot_status cs ON cs.lot_id = l.id
       GROUP BY COALESCE(cs.status, 'en_attente_reception')`,
    )
    .all() as Array<{ status: string; total: number }>) {
    lotsByStatus[row.status] = row.total;
  }
  const assignmentsByStatus: Record<string, number> = {};
  for (const row of db
    .prepare(
      'SELECT status, COUNT(*) AS total FROM couture_assignments GROUP BY status',
    )
    .all() as Array<{ status: string; total: number }>) {
    assignmentsByStatus[row.status] = row.total;
  }
  const balances = getLotBalances(actor);
  const sum = (key: 'receivedQty' | 'contestedQty' | 'assignedQty' | 'sewnQty' | 'transferredCqQty') =>
    balances.reduce((acc, lot) => acc + lot[key], 0);
  const assignedQty = sum('assignedQty');
  const sewnQty = sum('sewnQty');
  const receivedQty = sum('receivedQty');
  const contestedQty = sum('contestedQty');
  const transferredCqQty = sum('transferredCqQty');
  const incidents = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM couture_incidents WHERE status IN ('ouverte','en_cours')) AS open_incidents,
         (SELECT COUNT(*) FROM couture_incidents WHERE status IN ('ouverte','en_cours') AND severity = 'critique') AS critical_incidents`,
    )
    .get() as { open_incidents: number; critical_incidents: number };
  const openAlerts = (
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM alerts WHERE status IN ('nouvelle','en_cours') AND owner_role = 'chef_couture'",
      )
      .get() as { total: number }
  ).total;
  const pendingRequests = (
    db
      .prepare("SELECT COUNT(*) AS total FROM sensitive_requests WHERE status = 'en_attente'")
      .get() as { total: number }
  ).total;
  const productionByLine = db
    .prepare(
      `SELECT li.nom AS lineNom, COALESCE(SUM(p.qty), 0) AS qty
       FROM couture_productions p
       JOIN couture_assignments a ON a.id = p.assignment_id
       JOIN sewing_lines li ON li.id = a.line_id
       WHERE p.status = 'normal'
       GROUP BY li.id ORDER BY qty DESC LIMIT 10`,
    )
    .all() as Array<{ lineNom: string; qty: number }>;
  const recentHistory = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actorNom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM couture_history h
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
    lotsByStatus,
    assignmentsByStatus,
    quantities: {
      receivedQty,
      contestedQty,
      assignedQty,
      sewnQty,
      remainingToSew: Math.max(0, assignedQty - sewnQty),
      transferredCqQty,
    },
    openIncidents: incidents.open_incidents,
    criticalIncidents: incidents.critical_incidents,
    openAlerts,
    pendingRequests,
    productionByLine,
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
