import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import { dimWhere, type ReportFilters } from './filters';
import { buildPeriodKpi } from './overview';
import { FLOW_SOURCES } from './overview-sources';
import { pct, table, type SectionReport } from './report-types';

/**
 * Rapports Coupe et Couture. Quantités prévues vs réellement
 * enregistrées ; production cousue limitée au status = normal (les
 * corrections/annulations remplacées sont exclues par le module).
 */

export function coupeReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  const db = sessionsDb();
  const dim = dimWhere(filters);
  const lots = (
    db
      .prepare(
        `SELECT l.code, p.nom AS product, col.nom AS color,
                l.total_planned_qty AS planned,
                COALESCE(SUM(r.cut_qty), 0) AS cut,
                COALESCE(SUM(r.usable_qty), 0) AS usable,
                COALESCE(SUM(r.anomaly_qty), 0) AS anomaly,
                COALESCE(SUM(r.waste_qty), 0) AS waste,
                l.status
         FROM coupe_lots l
         JOIN products p ON p.id = l.product_id
         JOIN colors col ON col.id = l.color_id
         LEFT JOIN coupe_results r ON r.lot_id = l.id
         LEFT JOIN coupe_tasks t ON t.id = r.task_id AND t.status != 'annulee'
         WHERE 1 = 1${dim.where}
         GROUP BY l.id ORDER BY l.code LIMIT 300`,
      )
      .all(...dim.args) as Array<{
      code: string;
      product: string;
      color: string;
      planned: number;
      cut: number;
      usable: number;
      anomaly: number;
      waste: number;
      status: string;
    }>
  ).map((row) => ({
    lot: row.code,
    produit: row.product,
    couleur: row.color,
    prevu: row.planned,
    coupe: row.cut,
    utilisable: row.usable,
    anormal: row.anomaly,
    dechets: row.waste,
    statut: row.status,
  }));
  const wasteByType = (
    db
      .prepare(
        `SELECT w.waste_type, w.unit, SUM(w.qty) AS total
         FROM coupe_waste w
         JOIN coupe_lots l ON l.id = w.lot_id
         WHERE w.created_at >= ? AND w.created_at < ?${dim.where}
         GROUP BY w.waste_type, w.unit ORDER BY w.waste_type`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      waste_type: string;
      unit: string;
      total: number;
    }>
  ).map((row) => ({
    type: row.waste_type,
    unite: row.unit,
    quantite: row.total,
  }));
  const transfers = (
    db
      .prepare(
        `SELECT l.code AS lot, SUM(tl.qty) AS qty, MAX(ct.confirmed_at) AS last_transfer
         FROM coupe_transfers ct
         JOIN coupe_transfer_lines tl ON tl.transfer_id = ct.id
         JOIN coupe_lots l ON l.id = ct.lot_id
         WHERE ct.status = 'confirme' AND ct.confirmed_at >= ? AND ct.confirmed_at < ?${dim.where}
         GROUP BY ct.lot_id ORDER BY l.code LIMIT 200`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      lot: string;
      qty: number;
      last_transfer: string;
    }>
  ).map((row) => ({
    lot: row.lot,
    'transfere vers couture': row.qty,
    'dernier transfert': row.last_transfer?.slice(0, 16) ?? '',
  }));
  return [
    table(
      'coupe_lots',
      'Lots de coupe : prévu vs réalisé',
      [
        ['lot', 'Lot'],
        ['produit', 'Produit'],
        ['couleur', 'Couleur'],
        ['prevu', 'Prévu', true],
        ['coupe', 'Coupé', true],
        ['utilisable', 'Utilisable', true],
        ['anormal', 'Anormal', true],
        ['dechets', 'Déchets', true],
        ['statut', 'Statut'],
      ],
      lots,
      'Prévu = total_planned_qty du lot ; réalisé = coupe_results des tâches non annulées.',
    ),
    table(
      'coupe_waste',
      'Déchets et chutes (période)',
      [
        ['type', 'Type'],
        ['unite', 'Unité'],
        ['quantite', 'Quantité', true],
      ],
      wasteByType,
      'Unités réelles (kg/pièces) ; aucune conversion automatique.',
    ),
    table(
      'coupe_transfers',
      'Transferts vers la couture (période)',
      [
        ['lot', 'Lot'],
        ['transfere vers couture', 'Transféré (pièces)', true],
        ['dernier transfert', 'Dernier transfert'],
      ],
      transfers,
    ),
  ];
}

export function coutureReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filters.roomId !== null) {
    clauses.push('r.id = ?');
    args.push(filters.roomId);
  }
  if (filters.lineId !== null) {
    clauses.push('ln.id = ?');
    args.push(filters.lineId);
  }
  if (filters.productId !== null) {
    clauses.push('l.product_id = ?');
    args.push(filters.productId);
  }
  if (filters.lotId !== null) {
    clauses.push('cp.lot_id = ?');
    args.push(filters.lotId);
  }
  const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  const byLine = (
    db
      .prepare(
        `SELECT r.nom AS room, ln.code AS line, p.nom AS product,
                COALESCE(SUM(cp.qty), 0) AS sewn,
                COUNT(DISTINCT cp.operator_id) AS operators
         FROM couture_productions cp
         JOIN couture_assignments a ON a.id = cp.assignment_id
         JOIN sewing_lines ln ON ln.id = a.line_id
         JOIN sewing_rooms r ON r.id = ln.room_id
         JOIN coupe_lots l ON l.id = cp.lot_id
         JOIN products p ON p.id = l.product_id
         WHERE cp.status = 'normal' AND cp.created_at >= ? AND cp.created_at < ?${where}
         GROUP BY ln.id ORDER BY r.nom, ln.code LIMIT 300`,
      )
      .all(current.from, current.to, ...args) as Array<{
      room: string;
      line: string;
      product: string;
      sewn: number;
      operators: number;
    }>
  ).map((row) => ({
    salle: row.room,
    ligne: row.line,
    produit: row.product,
    cousu: row.sewn,
    'ope. distincts': row.operators,
  }));
  const incidents = (
    db
      .prepare(
        `SELECT ci.incident_type, ci.severity, ci.status, COUNT(*) AS n
         FROM couture_incidents ci
         WHERE ci.created_at >= ? AND ci.created_at < ?${where}
         GROUP BY ci.incident_type, ci.severity, ci.status ORDER BY n DESC LIMIT 100`,
      )
      .all(current.from, current.to, ...args) as Array<{
      incident_type: string;
      severity: string;
      status: string;
      n: number;
    }>
  ).map((row) => ({
    type: row.incident_type,
    gravite: row.severity,
    statut: row.status,
    nombre: row.n,
  }));
  return [
    table(
      'couture_lines',
      'Production par salle et ligne (période)',
      [
        ['salle', 'Salle'],
        ['ligne', 'Ligne'],
        ['produit', 'Produit'],
        ['cousu', 'Cousu (pièces)', true],
        ['ope. distincts', 'Opérateurs distincts', true],
      ],
      byLine,
      'Cousu = productions normales uniquement ; quantité affectée ≠ quantité cousue.',
    ),
    table(
      'couture_incidents',
      'Incidents de production (période)',
      [
        ['type', 'Type'],
        ['gravite', 'Gravité'],
        ['statut', 'Statut'],
        ['nombre', 'Nombre', true],
      ],
      incidents,
    ),
  ];
}

export function coupeKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['coupe_cut', 'coupe_usable'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}

export function coutureKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['couture_recue', 'couture_cousu'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}

/** Taux de conformité initiale, uniquement si le périmètre est cohérent. */
export function initialConformityRate(
  current: PeriodRange,
  filters: ReportFilters,
): { controlled: number; conforme: number; rate: number | null } {
  const db = sessionsDb();
  const dim = dimWhere(filters);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cl.inspected_qty), 0) AS inspected,
              COALESCE(SUM(cl.conforme_qty), 0) AS conforme
       FROM cq_controle_lines cl
       JOIN cq_controles c ON c.id = cl.controle_id
       JOIN coupe_lots l ON l.id = c.lot_id
       WHERE c.created_at >= ? AND c.created_at < ?${dim.where}`,
    )
    .get(current.from, current.to, ...dim.args) as { inspected: number; conforme: number };
  return {
    controlled: row.inspected,
    conforme: row.conforme,
    rate: pct(row.conforme, row.inspected),
  };
}
