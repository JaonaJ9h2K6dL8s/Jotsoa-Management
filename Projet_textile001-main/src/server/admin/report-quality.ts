import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import { dimWhere, type ReportFilters } from './filters';
import { buildPeriodKpi } from './overview';
import { FLOW_SOURCES } from './overview-sources';
import { table, type SectionReport } from './report-types';

/**
 * Rapports Qualité et Retouche. Défauts = occurrences (une pièce peut
 * avoir plusieurs défauts) ; pièces défectueuses = inspectées −
 * conformes ; interventions ≠ pièces traitées.
 */

export function qualiteReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  const db = sessionsDb();
  const dim = dimWhere(filters);
  const byType = (
    db
      .prepare(
        `SELECT df.nom AS defect, d.severity, d.decision,
                COUNT(*) AS occurrences, SUM(d.qty_pieces) AS pieces
         FROM cq_defauts d
         JOIN defects df ON df.id = d.defect_id
         JOIN coupe_lots l ON l.id = d.lot_id
         WHERE d.created_at >= ? AND d.created_at < ?${dim.where}
         GROUP BY d.defect_id, d.severity, d.decision
         ORDER BY pieces DESC LIMIT 100`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      defect: string;
      severity: string;
      decision: string;
      occurrences: number;
      pieces: number;
    }>
  ).map((row) => ({
    defaut: row.defect,
    gravite: row.severity,
    decision: row.decision,
    occurrences: row.occurrences,
    'pieces (cumul)': row.pieces,
  }));
  const controls = (
    db
      .prepare(
        `SELECT c.code, l.code AS lot, c.status,
                COALESCE(SUM(cl.inspected_qty), 0) AS inspected,
                COALESCE(SUM(cl.conforme_qty), 0) AS conforme
         FROM cq_controles c
         JOIN cq_controle_lines cl ON cl.controle_id = c.id
         JOIN coupe_lots l ON l.id = c.lot_id
         WHERE c.created_at >= ? AND c.created_at < ?${dim.where}
         GROUP BY c.id ORDER BY c.code LIMIT 200`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      code: string;
      lot: string;
      status: string;
      inspected: number;
      conforme: number;
    }>
  ).map((row) => ({
    controle: row.code,
    lot: row.lot,
    statut: row.status,
    controlees: row.inspected,
    conformes: row.conforme,
  }));
  const finals = (
    db
      .prepare(
        `SELECT fc.code, l.code AS lot, fc.status, COUNT(DISTINCT rq.id) AS requests
         FROM cq_final_controls fc
         JOIN cq_rework_requests rq ON rq.origin_final = fc.id
         JOIN coupe_lots l ON l.id = fc.lot_id
         WHERE fc.created_at >= ? AND fc.created_at < ?${dim.where}
         GROUP BY fc.id ORDER BY fc.code LIMIT 200`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      code: string;
      lot: string;
      status: string;
      requests: number;
    }>
  ).map((row) => ({
    'controle final': row.code,
    lot: row.lot,
    statut: row.status,
    'demandes rattachees': row.requests,
  }));
  return [
    table(
      'cq_defauts',
      'Défauts constatés (période)',
      [
        ['defaut', 'Défaut'],
        ['gravite', 'Gravité'],
        ['decision', 'Décision'],
        ['occurrences', 'Occurrences', true],
        ['pieces (cumul)', 'Pièces (cumul, pas uniques)', true],
      ],
      byType,
      'Une pièce peut avoir plusieurs défauts : le cumul de pièces n’est pas un nombre de pièces uniques.',
    ),
    table(
      'cq_controles',
      'Contrôles initiaux (période)',
      [
        ['controle', 'Contrôle'],
        ['lot', 'Lot'],
        ['statut', 'Statut'],
        ['controlees', 'Contrôlées', true],
        ['conformes', 'Conformes', true],
      ],
      controls,
    ),
    table(
      'cq_finals',
      'Contrôles finaux après retouche (période)',
      [
        ['controle final', 'Contrôle final'],
        ['lot', 'Lot'],
        ['statut', 'Statut'],
        ['demandes rattachees', 'Demandes rattachées', true],
      ],
      finals,
    ),
  ];
}

export function retoucheReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  const db = sessionsDb();
  const dim = dimWhere(filters);
  const assignments = (
    db
      .prepare(
        `SELECT a.status, COUNT(*) AS n
         FROM rt_assignments a
         JOIN cq_rework_requests rq ON rq.id = a.request_id
         JOIN coupe_lots l ON l.id = rq.lot_id
         WHERE a.created_at >= ? AND a.created_at < ?${dim.where}
         GROUP BY a.status`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{ status: string; n: number }>
  ).map((row) => ({ statut: row.status, affectations: row.n }));
  const interventions = (
    db
      .prepare(
        `SELECT i.status, COUNT(*) AS n,
                COUNT(DISTINCT a.request_id) AS requests,
                AVG(CASE WHEN i.ended_at IS NOT NULL
                    THEN (julianday(i.ended_at) - julianday(i.started_at)) * 24 END) AS avg_hours
         FROM rt_interventions i
         JOIN rt_assignments a ON a.id = i.assignment_id
         JOIN cq_rework_requests rq ON rq.id = a.request_id
         JOIN coupe_lots l ON l.id = rq.lot_id
         WHERE i.started_at >= ? AND i.started_at < ?${dim.where}
         GROUP BY i.status`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      status: string;
      n: number;
      requests: number;
      avg_hours: number | null;
    }>
  ).map((row) => ({
    statut: row.status,
    interventions: row.n,
    'demandes distinctes': row.requests,
    'delai moyen (h)': row.avg_hours === null ? null : Math.round(row.avg_hours * 10) / 10,
  }));
  const rebut = (
    db
      .prepare(
        `SELECT rb.status, SUM(rb.qty) AS qty, COUNT(*) AS n
         FROM rt_rebut_proposals rb
         JOIN cq_rework_requests rq ON rq.id = rb.request_id
         JOIN coupe_lots l ON l.id = rq.lot_id
         WHERE rb.created_at >= ? AND rb.created_at < ?${dim.where}
         GROUP BY rb.status`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      status: string;
      qty: number;
      n: number;
    }>
  ).map((row) => ({
    statut: row.status,
    'propositions': row.n,
    'pieces proposees': row.qty,
  }));
  return [
    table(
      'rt_assignments',
      'Affectations de retouche (période)',
      [['statut', 'Statut'], ['affectations', 'Affectations', true]],
      assignments,
    ),
    table(
      'rt_interventions',
      'Interventions (période)',
      [
        ['statut', 'Statut'],
        ['interventions', 'Interventions', true],
        ['demandes distinctes', 'Demandes distinctes', true],
        ['delai moyen (h)', 'Délai moyen (h)'],
      ],
      interventions,
      'Interventions ≠ pièces : une pièce peut recevoir plusieurs interventions.',
    ),
    table(
      'rt_rebut',
      'Propositions de rebut (période)',
      [
        ['statut', 'Statut'],
        ['propositions', 'Propositions', true],
        ['pieces proposees', 'Pièces proposées', true],
      ],
      rebut,
    ),
  ];
}

export function qualiteKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['cq_controle', 'cq_conforme', 'cq_defectueuses'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}

export function retoucheKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['rt_demandes', 'rt_interventions'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}
