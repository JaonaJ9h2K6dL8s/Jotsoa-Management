import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SecAnomalyDTO, SecDossierDTO, SecDecision } from '@/types/securite';
import { requireSecurite } from './common';

/**
 * Réception des dossiers de sortie transmis par le chef magasinier.
 * Le Chef Sécurité ne peut pas créer de dossier : il ne voit que les
 * dossiers réellement soumis (mg_dossiers.status = 'soumis').
 */

interface AnomalyRow {
  id: number;
  code: string;
  dossier_id: number | null;
  dossier_code: string | null;
  controle_id: number | null;
  carton_code: string | null;
  type: SecAnomalyDTO['type'];
  severity: SecAnomalyDTO['severity'];
  description: string;
  status: SecAnomalyDTO['status'];
  detected_by_name: string | null;
  detected_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution: string | null;
  resolution_reason: string | null;
}

export function mapAnomaly(row: AnomalyRow): SecAnomalyDTO {
  return {
    id: row.id,
    code: row.code,
    dossierId: row.dossier_id,
    dossierCode: row.dossier_code,
    controleId: row.controle_id,
    cartonCode: row.carton_code,
    type: row.type,
    severity: row.severity,
    description: row.description,
    status: row.status,
    detectedByName: row.detected_by_name,
    detectedAt: row.detected_at,
    resolvedByName: row.resolved_by_name,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    resolutionReason: row.resolution_reason,
  };
}

export const ANOMALY_SELECT = `
  SELECT a.*, d.code AS dossier_code, ct.code AS carton_code,
         du.nom || ' ' || du.prenom AS detected_by_name,
         ru.nom || ' ' || ru.prenom AS resolved_by_name
  FROM sec_anomalies a
  LEFT JOIN mg_dossiers d ON d.id = a.dossier_id
  LEFT JOIN st_cartons ct ON ct.id = a.carton_id
  LEFT JOIN users du ON du.id = a.detected_by
  LEFT JOIN users ru ON ru.id = a.resolved_by`;

interface DossierRow {
  id: number;
  code: string;
  order_id: number;
  order_code: string;
  external_order_no: string | null;
  version: number;
  status: 'soumis' | 'retour' | 'annule';
  notes: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
  security_result: SecDecision | null;
}

function anomaliesOf(db: import('better-sqlite3').Database, dossierId: number): SecAnomalyDTO[] {
  return (
    db
      .prepare(`${ANOMALY_SELECT} WHERE a.dossier_id = ? ORDER BY a.id DESC`)
      .all(dossierId) as AnomalyRow[]
  ).map(mapAnomaly);
}

export function mapSecDossier(
  db: import('better-sqlite3').Database,
  row: DossierRow,
): SecDossierDTO {
  const cartons = (
    db
      .prepare(
        `SELECT DISTINCT c.id AS carton_id, c.code, COALESCE(SUM(cl.qty), 0) AS total
         FROM mg_reservations r
         JOIN st_cartons c ON c.id = r.carton_id
         LEFT JOIN st_carton_lines cl ON cl.carton_id = c.id
         WHERE r.order_id = ? AND r.status = 'active'
         GROUP BY c.id ORDER BY c.code`,
      )
      .all(row.order_id) as Array<{ carton_id: number; code: string; total: number }>
  ).map((entry) => ({ cartonId: entry.carton_id, code: entry.code, totalQty: entry.total }));
  const lines = (
    db
      .prepare(
        `SELECT l.id, p.nom AS product_nom, col.nom AS color_nom, s.nom AS size_nom,
                l.raw_text, l.qty_ordered, l.qty_prepared
         FROM mg_order_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN colors col ON col.id = l.color_id
         LEFT JOIN sizes s ON s.id = l.size_id
         WHERE l.order_id = ? ORDER BY l.id`,
      )
      .all(row.order_id) as Array<{
      id: number;
      product_nom: string | null;
      color_nom: string | null;
      size_nom: string | null;
      raw_text: string | null;
      qty_ordered: number;
      qty_prepared: number;
    }>
  ).map((entry) => ({
    id: entry.id,
    productNom: entry.product_nom,
    colorNom: entry.color_nom,
    sizeNom: entry.size_nom,
    rawText: entry.raw_text,
    qtyOrdered: entry.qty_ordered,
    qtyPrepared: entry.qty_prepared,
  }));
  const checks = (
    db
      .prepare(
        `SELECT result, gaps, checked_at FROM mg_checks WHERE order_id = ? ORDER BY id DESC`,
      )
      .all(row.order_id) as Array<{ result: string; gaps: string | null; checked_at: string }>
  ).map((entry) => ({
    result: entry.result,
    gaps: entry.gaps,
    checkedAt: entry.checked_at,
  }));
  return {
    id: row.id,
    code: row.code,
    orderCode: row.order_code,
    externalOrderNo: row.external_order_no,
    version: row.version,
    status: row.status,
    notes: row.notes,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at,
    securityResult: row.security_result,
    cartons,
    lines,
    checks,
    anomalies: anomaliesOf(db, row.id),
  };
}

const DOSSIER_SELECT = `
  SELECT d.*, o.code AS order_code, o.external_order_no,
         u.nom || ' ' || u.prenom AS submitted_by_name
  FROM mg_dossiers d
  JOIN mg_orders o ON o.id = d.order_id
  LEFT JOIN users u ON u.id = d.submitted_by`;

/** File des dossiers à contrôler : soumis, plus toute la file récente. */
export function listDossiers(actor: Actor): SecDossierDTO[] {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${DOSSIER_SELECT} ORDER BY d.id DESC LIMIT 300`).all() as DossierRow[]
  ).map((row) => mapSecDossier(db, row));
}

export function getSecDossier(actor: Actor, dossierId: number): SecDossierDTO {
  requireSecurite(actor);
  const db = sessionsDb();
  const row = db
    .prepare(`${DOSSIER_SELECT} WHERE d.id = ?`)
    .get(dossierId) as DossierRow | undefined;
  if (!row) throw new ServiceError('Dossier introuvable.', 404);
  return mapSecDossier(db, row);
}
