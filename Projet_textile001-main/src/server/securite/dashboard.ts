import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SecDashboardDTO } from '@/types/securite';
import { requireSecurite } from './common';

/** Tableau de bord du Chef Sécurité : uniquement des données réelles. */
export function getDashboard(actor: Actor): SecDashboardDTO {
  requireSecurite(actor);
  const db = sessionsDb();
  const dossiers = db
    .prepare(
      `SELECT
         SUM(CASE WHEN d.status = 'soumis' AND d.security_result IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN d.status = 'soumis' AND d.security_result IN ('non_conforme','attente_correction','contrev_crequise') THEN 1 ELSE 0 END) AS blocked
       FROM mg_dossiers d
       WHERE d.id = (SELECT MAX(id) FROM mg_dossiers x WHERE x.order_id = d.order_id)`,
    )
    .get() as { pending: number | null; blocked: number | null };
  const controls = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'en_cours' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'conforme' THEN 1 ELSE 0 END) AS conforme
       FROM sec_controles`,
    )
    .get() as { running: number | null; conforme: number | null };
  const cartons = db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT r.carton_id)
          FROM mg_reservations r
          JOIN mg_dossiers d ON d.order_id = r.order_id
          WHERE r.status = 'active'
            AND d.status = 'soumis'
            AND d.id = (SELECT MAX(id) FROM mg_dossiers x WHERE x.order_id = d.order_id)
         ) AS expected,
         (SELECT COUNT(*) FROM sec_observations o
          JOIN sec_controles c ON c.id = o.controle_id
          WHERE c.status = 'en_cours' AND o.result = 'attendu') AS observed`,
    )
    .get() as { expected: number | null; observed: number | null };
  const anomalies = db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'ouverte' THEN 1 ELSE 0 END) AS open
       FROM sec_anomalies`,
    )
    .get() as { open: number | null };
  const counterChecks = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sensitive_requests
       WHERE entity_type = 'sec_anomalie' AND status = 'en_attente'`,
    )
    .get() as { n: number };
  const sorties = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'autorisee' THEN 1 ELSE 0 END) AS authorized,
         SUM(CASE WHEN status = 'confirmee' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'refusee' THEN 1 ELSE 0 END) AS refused
       FROM sec_sorties`,
    )
    .get() as { authorized: number | null; confirmed: number | null; refused: number | null };
  const recentHistory = (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom, h.reason, h.created_at
         FROM sec_history h LEFT JOIN users u ON u.id = h.actor_id
         ORDER BY h.id DESC LIMIT 12`,
      )
      .all() as Array<{
      id: number;
      action: string;
      entity_type: string;
      entity_id: number;
      actor_nom: string | null;
      reason: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorNom: row.actor_nom,
    reason: row.reason,
    createdAt: row.created_at,
  }));
  return {
    dossiersPending: dossiers.pending ?? 0,
    dossiersBlocked: dossiers.blocked ?? 0,
    controlsRunning: controls.running ?? 0,
    controlsConforme: controls.conforme ?? 0,
    cartonsExpected: cartons.expected ?? 0,
    cartonsObserved: cartons.observed ?? 0,
    anomaliesOpen: anomalies.open ?? 0,
    counterChecksPending: counterChecks.n,
    sortiesAuthorized: sorties.authorized ?? 0,
    sortiesConfirmed: sorties.confirmed ?? 0,
    sortiesRefused: sorties.refused ?? 0,
    recentHistory,
  };
}

export function listSecHistory(actor: Actor): Array<{
  id: number;
  action: string;
  entityType: string;
  entityId: number;
  actorNom: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
}> {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom,
                h.old_value, h.new_value, h.reason, h.created_at
         FROM sec_history h
         LEFT JOIN users u ON u.id = h.actor_id
         ORDER BY h.id DESC LIMIT 400`,
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
}

export function listSecAlerts(actor: Actor): Array<{
  id: number;
  category: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
}> {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT id, category, severity, message, status, created_at
         FROM alerts WHERE owner_role = 'chef_securite'
         ORDER BY id DESC LIMIT 300`,
      )
      .all() as Array<{
      id: number;
      category: string;
      severity: string;
      message: string;
      status: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }));
}
