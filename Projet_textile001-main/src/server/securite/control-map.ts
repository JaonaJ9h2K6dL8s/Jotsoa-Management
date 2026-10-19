import type Database from 'better-sqlite3';
import type { SecControlDTO, SecControlLevel, SecControlStatus } from '@/types/securite';
import { ANOMALY_SELECT, mapAnomaly } from './dossiers';

/** Mapping des contrôles de sécurité vers les DTO (partagé). */

export interface ControlRow {
  id: number;
  code: string;
  dossier_id: number;
  dossier_code: string;
  order_code: string;
  version: number;
  level: SecControlLevel;
  status: SecControlStatus;
  notes: string | null;
  started_by_name: string | null;
  started_at: string;
  finished_at: string | null;
}

export const CONTROL_SELECT = `
  SELECT c.*, d.code AS dossier_code, o.code AS order_code,
         u.nom || ' ' || u.prenom AS started_by_name
  FROM sec_controles c
  JOIN mg_dossiers d ON d.id = c.dossier_id
  JOIN mg_orders o ON o.id = d.order_id
  LEFT JOIN users u ON u.id = c.started_by`;

export function mapControl(db: Database.Database, row: ControlRow): SecControlDTO {
  const expectedCartons = (
    db
      .prepare(
        `SELECT DISTINCT c.id AS carton_id, c.code, COALESCE(SUM(cl.qty), 0) AS total
         FROM mg_reservations r
         JOIN mg_dossiers d ON d.order_id = r.order_id AND d.id = ?
         JOIN st_cartons c ON c.id = r.carton_id
         LEFT JOIN st_carton_lines cl ON cl.carton_id = c.id
         WHERE r.status = 'active'
         GROUP BY c.id ORDER BY c.code`,
      )
      .all(row.dossier_id) as Array<{ carton_id: number; code: string; total: number }>
  ).map((entry) => ({
    cartonId: entry.carton_id,
    code: entry.code,
    totalQty: entry.total,
  }));
  const observations = (
    db
      .prepare(
        `SELECT o.id, o.carton_id, c.code AS carton_code, o.code_saisi, o.result,
                o.qty_total, o.observed_at
         FROM sec_observations o JOIN st_cartons c ON c.id = o.carton_id
         WHERE o.controle_id = ? ORDER BY o.id`,
      )
      .all(row.id) as Array<{
      id: number;
      carton_id: number;
      carton_code: string;
      code_saisi: string;
      result: 'attendu' | 'supplementaire';
      qty_total: number;
      observed_at: string;
    }>
  ).map((entry) => ({
    id: entry.id,
    cartonId: entry.carton_id,
    cartonCode: entry.carton_code,
    codeSaisi: entry.code_saisi,
    result: entry.result,
    qtyTotal: entry.qty_total,
    observedAt: entry.observed_at,
  }));
  const lineChecks = (
    db
      .prepare(
        `SELECT order_line_id, qty_checked FROM sec_line_checks WHERE controle_id = ? ORDER BY id`,
      )
      .all(row.id) as Array<{ order_line_id: number; qty_checked: number }>
  ).map((entry) => ({
    orderLineId: entry.order_line_id,
    qtyChecked: entry.qty_checked,
  }));
  const anomalies = (
    db
      .prepare(`${ANOMALY_SELECT} WHERE a.controle_id = ? ORDER BY a.id DESC`)
      .all(row.id) as Parameters<typeof mapAnomaly>[0][]
  ).map(mapAnomaly);
  return {
    id: row.id,
    code: row.code,
    dossierCode: row.dossier_code,
    orderCode: row.order_code,
    version: row.version,
    level: row.level,
    status: row.status,
    notes: row.notes,
    startedByName: row.started_by_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expectedCartons,
    observations,
    lineChecks,
    anomalies,
  };
}
