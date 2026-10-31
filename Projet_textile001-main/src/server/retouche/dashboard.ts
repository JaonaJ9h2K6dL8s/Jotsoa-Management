import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtDashboardDTO } from '@/types/retouche';
import { requireRetouche } from './common';

/**
 * Tableau de bord Retouche : uniquement des données réelles issues de
 * SQLite. Les quantités proviennent des mouvements réels (réceptions,
 * affectations, interventions, retours).
 */
export function getDashboard(actor: Actor): RtDashboardDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { total: number }).total;
  const requestsCount = count('SELECT COUNT(*) AS total FROM cq_rework_requests');
  const pendingReception = count(
    `SELECT COUNT(*) AS total FROM cq_rework_requests r
     WHERE r.status = 'en_attente'
       AND NOT EXISTS (SELECT 1 FROM rt_receptions rec WHERE rec.request_id = r.id)`,
  );
  const pendingAssignment = count(
    `SELECT COUNT(*) AS total FROM rt_receptions rec
     JOIN cq_rework_requests r ON r.id = rec.request_id
     WHERE r.status = 'en_attente'
       AND NOT EXISTS (SELECT 1 FROM rt_assignments a WHERE a.request_id = r.id AND a.status != 'annulee')`,
  );
  const assignmentsInProgress = count(
    "SELECT COUNT(*) AS total FROM rt_assignments WHERE status = 'en_cours'",
  );
  const interventionsInProgress = count(
    "SELECT COUNT(*) AS total FROM rt_interventions WHERE status = 'en_cours'",
  );
  const scalar = (sql: string): number =>
    (db.prepare(sql).get() as { total: number }).total;
  const quantities = {
    requestedQty: scalar('SELECT COALESCE(SUM(qty), 0) AS total FROM cq_rework_lines'),
    receivedQty: scalar(
      'SELECT COALESCE(SUM(received_qty), 0) AS total FROM rt_reception_lines',
    ),
    assignedQty: scalar(
      `SELECT COALESCE(SUM(al.qty), 0) AS total FROM rt_assignment_lines al
       JOIN rt_assignments a ON a.id = al.assignment_id WHERE a.status != 'annulee'`,
    ),
    processedQty: scalar(
      `SELECT COALESCE(SUM(il.processed_qty), 0) AS total
       FROM rt_intervention_lines il
       JOIN rt_interventions i ON i.id = il.intervention_id
       WHERE i.status = 'terminee'`,
    ),
    repairedQty: scalar(
      `SELECT COALESCE(SUM(il.processed_qty), 0) AS total
       FROM rt_intervention_lines il
       JOIN rt_interventions i ON i.id = il.intervention_id
       WHERE i.status = 'terminee' AND il.result = 'repare'`,
    ),
    returnedQty: scalar(
      `SELECT COALESCE(SUM(rl.qty), 0) AS total FROM rt_return_lines rl
       JOIN rt_returns t ON t.id = rl.return_id WHERE t.status = 'transmis'`,
    ),
    irreparableQty: scalar(
      `SELECT COALESCE(SUM(il.processed_qty), 0) AS total
       FROM rt_intervention_lines il
       JOIN rt_interventions i ON i.id = il.intervention_id
       WHERE i.status = 'terminee' AND il.result = 'irreparable'`,
    ),
  };
  const recentHistory = db
    .prepare(
      `SELECT h.id, h.action, h.entity_type, h.entity_id,
              u.nom || ' ' || u.prenom AS actorNom,
              h.old_value, h.new_value, h.reason, h.created_at
       FROM rt_history h
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
  // Heures travaillées par retoucheur : cumul des interventions
  // terminées + segment en cours (temps réel serveur, pauses exclues).
  const workedByRetoucheur = (
    db
      .prepare(
        `SELECT u.nom || ' ' || u.prenom AS retoucheurNom,
                COALESCE(SUM(a.worked_seconds), 0)
                  + COALESCE(SUM(CASE WHEN i.id IS NOT NULL THEN
                    CAST((julianday('now') - julianday(i.started_at)) * 86400 AS INTEGER)
                  ELSE 0 END), 0) AS workedSeconds,
                COUNT(DISTINCT i.id) AS activeTasks
         FROM rt_assignments a
         JOIN users u ON u.id = a.retoucheur_id
         LEFT JOIN rt_interventions i ON i.assignment_id = a.id AND i.status = 'en_cours'
         WHERE a.status != 'annulee'
         GROUP BY u.id ORDER BY workedSeconds DESC`,
      )
      .all() as Array<{
      retoucheurNom: string;
      workedSeconds: number;
      activeTasks: number;
    }>
  ).map((row) => ({
    retoucheurNom: row.retoucheurNom,
    workedSeconds: Math.max(0, Math.floor(row.workedSeconds)),
    activeTasks: row.activeTasks,
  }));
  return {
    requestsCount,
    pendingReception,
    pendingAssignment,
    assignmentsInProgress,
    interventionsInProgress,
    quantities,
    workedByRetoucheur,
    pendingRebutProposals: count(
      "SELECT COUNT(*) AS total FROM rt_rebut_proposals WHERE status = 'en_attente'",
    ),
    openAlerts: count(
      `SELECT COUNT(*) AS total FROM alerts
       WHERE status IN ('nouvelle','en_cours') AND owner_role = 'retoucheur'`,
    ),
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
