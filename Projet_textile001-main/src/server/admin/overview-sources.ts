import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import type { ReportFilters } from './filters';
import { dimWhere } from './filters';

/**
 * Indicateurs périodiques de la vue générale. Une seule table
 * événement par mesure ; corrections et annulations respectées selon
 * les conventions de chaque module (ex. couture : status = normal).
 */

export interface KpiSource {
  key: string;
  label: string;
  definition: string;
  unit: string;
  query: (range: PeriodRange, filters: ReportFilters) => number;
}

export const FLOW_SOURCES: KpiSource[] = [
  {
    key: 'coupe_cut',
    label: 'Quantités coupées',
    definition:
      'Somme des quantités coupées (coupe_results.cut_qty) des tâches non annulées, créées dans la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(r.cut_qty), 0) AS total
           FROM coupe_results r
           JOIN coupe_tasks t ON t.id = r.task_id AND t.status != 'annulee'
           JOIN coupe_lots l ON l.id = r.lot_id
           WHERE r.created_at >= ? AND r.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'coupe_usable',
    label: 'Quantités utilisables (coupe)',
    definition:
      'Somme des quantités utilisables issues de la coupe (coupe_results.usable_qty), tâches non annulées. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(r.usable_qty), 0) AS total
           FROM coupe_results r
           JOIN coupe_tasks t ON t.id = r.task_id AND t.status != 'annulee'
           JOIN coupe_lots l ON l.id = r.lot_id
           WHERE r.created_at >= ? AND r.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'couture_recue',
    label: 'Quantités reçues en couture',
    definition:
      'Somme des quantités réellement reçues par la couture (couture_reception_lines.received_qty), réceptions de la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(rl.received_qty), 0) AS total
           FROM couture_reception_lines rl
           JOIN couture_receptions rec ON rec.id = rl.reception_id
           JOIN coupe_lots l ON l.id = rec.lot_id
           WHERE rec.received_at >= ? AND rec.received_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'couture_cousu',
    label: 'Quantités cousues',
    definition:
      'Somme des productions normales (couture_productions.qty, status = normal ; corrections et annulations exclues conformément au module Couture), créées dans la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cp.qty), 0) AS total
           FROM couture_productions cp
           JOIN coupe_lots l ON l.id = cp.lot_id
           WHERE cp.status = 'normal' AND cp.created_at >= ? AND cp.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'cq_controle',
    label: 'Quantités contrôlées (1er contrôle)',
    definition:
      'Somme des quantités inspectées au premier contrôle (cq_controle_lines.inspected_qty), contrôles créés dans la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cl.inspected_qty), 0) AS total
           FROM cq_controle_lines cl
           JOIN cq_controles c ON c.id = cl.controle_id
           JOIN coupe_lots l ON l.id = c.lot_id
           WHERE c.created_at >= ? AND c.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'cq_conforme',
    label: 'Quantités conformes (1er contrôle)',
    definition:
      'Somme des quantités déclarées conformes au premier contrôle (cq_controle_lines.conforme_qty), contrôles de la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cl.conforme_qty), 0) AS total
           FROM cq_controle_lines cl
           JOIN cq_controles c ON c.id = cl.controle_id
           JOIN coupe_lots l ON l.id = c.lot_id
           WHERE c.created_at >= ? AND c.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'cq_defectueuses',
    label: 'Pièces défectueuses (1er contrôle)',
    definition:
      'Différence inspectées − conformes au premier contrôle : nombre de pièces concernées, sans additionner les défauts multiples d’une même pièce.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cl.inspected_qty - cl.conforme_qty), 0) AS total
           FROM cq_controle_lines cl
           JOIN cq_controles c ON c.id = cl.controle_id
           JOIN coupe_lots l ON l.id = c.lot_id
           WHERE c.created_at >= ? AND c.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'rt_demandes',
    label: 'Demandes de retouche',
    definition:
      'Demandes de retouche créées dans la période (cq_rework_requests, toutes origines). Unité : demandes.',
    unit: 'demandes',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM cq_rework_requests rq
           JOIN coupe_lots l ON l.id = rq.lot_id
           WHERE rq.created_at >= ? AND rq.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { n: number };
      return row.n;
    },
  },
  {
    key: 'rt_interventions',
    label: 'Interventions de retouche',
    definition:
      'Interventions de retouche non annulées commencées dans la période (rt_interventions). Nombre d’interventions ≠ nombre de pièces traitées.',
    unit: 'interventions',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM rt_interventions i
           JOIN rt_assignments a ON a.id = i.assignment_id
           JOIN cq_rework_requests rq ON rq.id = a.request_id
           JOIN coupe_lots l ON l.id = rq.lot_id
           WHERE i.status != 'annulee' AND i.started_at >= ? AND i.started_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { n: number };
      return row.n;
    },
  },
  {
    key: 'sorties_confirmees',
    label: 'Sorties physiquement confirmées',
    definition:
      'Sorties confirmées par le chef sécurité dans la période (sec_sorties.status = confirmee). Une sortie autorisée mais non confirmée n’est pas comptée.',
    unit: 'sorties',
    query: (range) => {
      const db = sessionsDb();
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_sorties
           WHERE status = 'confirmee' AND confirmed_at >= ? AND confirmed_at < ?`,
        )
        .get(range.from, range.to) as { n: number };
      return row.n;
    },
  },
  {
    key: 'stock_entrees',
    label: 'Entrées en stock',
    definition:
      'Mouvements d’entrée depuis le contrôle qualité (st_movements.movement_type = entree_cq) de la période. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(m.qty), 0) AS total
           FROM st_movements m
           JOIN coupe_lots l ON l.id = m.lot_id
           WHERE m.movement_type = 'entree_cq' AND m.created_at >= ? AND m.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
  {
    key: 'stock_sorties',
    label: 'Sorties de stock',
    definition:
      'Mouvements de sortie définitifs (st_movements.movement_type = sortie) de la période : seule source des quantités réellement sorties. Unité : pièces.',
    unit: 'pièces',
    query: (range, filters) => {
      const db = sessionsDb();
      const dim = dimWhere(filters);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(m.qty), 0) AS total
           FROM st_movements m
           JOIN coupe_lots l ON l.id = m.lot_id
           WHERE m.movement_type = 'sortie' AND m.created_at >= ? AND m.created_at < ?${dim.where}`,
        )
        .get(range.from, range.to, ...dim.args) as { total: number };
      return row.total;
    },
  },
];
