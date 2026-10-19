import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { MgDashboardDTO } from '@/types/magasinier';
import { requireMagasinier } from './common';

/** Tableau de bord du chef magasinier : uniquement des données réelles. */
export function getDashboard(actor: Actor): MgDashboardDTO {
  requireMagasinier(actor);
  const db = sessionsDb();
  const documents = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status != 'rejete' THEN 1 ELSE 0 END) AS imported,
         SUM(CASE WHEN status IN ('a_verifier','extraction_partielle','ocr_indisponible','importe') THEN 1 ELSE 0 END) AS to_verify,
         SUM(CASE WHEN status IN ('erreur','rejete') THEN 1 ELSE 0 END) AS errored
       FROM mg_documents`,
    )
    .get() as { imported: number | null; to_verify: number | null; errored: number | null };
  const orders = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'valide' THEN 1 ELSE 0 END) AS validated,
         SUM(CASE WHEN status = 'en_preparation' THEN 1 ELSE 0 END) AS preparing,
         SUM(CASE WHEN status = 'partielle' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS complete,
         SUM(CASE WHEN status IN ('anomalie','a_verifier') THEN 1 ELSE 0 END) AS blocked
       FROM mg_orders WHERE status != 'annule'`,
    )
    .get() as {
    validated: number | null;
    preparing: number | null;
    partial: number | null;
    complete: number | null;
    blocked: number | null;
  };
  const dossiers = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'soumis' THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN status = 'retour' THEN 1 ELSE 0 END) AS returned
       FROM mg_dossiers`,
    )
    .get() as { submitted: number | null; returned: number | null };
  const quantities = db
    .prepare(
      `SELECT COALESCE(SUM(qty_ordered), 0) AS ordered,
              COALESCE(SUM(qty_prepared), 0) AS prepared
       FROM mg_order_lines l
       JOIN mg_orders o ON o.id = l.order_id
       WHERE o.status != 'annule'`,
    )
    .get() as { ordered: number; prepared: number };
  const openAlerts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM alerts
       WHERE owner_role = 'chef_magasinier' AND status IN ('nouvelle','en_cours')`,
    )
    .get() as { n: number };
  const recentHistory = (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom, h.reason, h.created_at
         FROM mg_history h LEFT JOIN users u ON u.id = h.actor_id
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
    documentsImported: documents.imported ?? 0,
    documentsToVerify: documents.to_verify ?? 0,
    documentsErrored: documents.errored ?? 0,
    ordersValidated: orders.validated ?? 0,
    ordersInPreparation: orders.preparing ?? 0,
    ordersPartial: orders.partial ?? 0,
    ordersComplete: orders.complete ?? 0,
    dossiersSubmitted: dossiers.submitted ?? 0,
    dossiersReturned: dossiers.returned ?? 0,
    ordersBlocked: orders.blocked ?? 0,
    totalOrderedQty: quantities.ordered,
    totalPreparedQty: quantities.prepared,
    openAlerts: openAlerts.n,
    recentHistory,
  };
}

export function listMgHistory(actor: Actor): Array<{
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
  requireMagasinier(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT h.id, h.action, h.entity_type, h.entity_id,
                u.nom || ' ' || u.prenom AS actor_nom,
                h.old_value, h.new_value, h.reason, h.created_at
         FROM mg_history h
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

export function listMgAlerts(actor: Actor): Array<{
  id: number;
  category: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
}> {
  requireMagasinier(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT id, category, severity, message, status, created_at
       FROM alerts WHERE owner_role = 'chef_magasinier'
       ORDER BY id DESC LIMIT 300`,
    )
    .all() as Array<{
    id: number;
    category: string;
    severity: string;
    message: string;
    status: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }));
}
