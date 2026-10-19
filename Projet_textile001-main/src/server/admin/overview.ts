import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import type { ReportFilters } from './filters';

/**
 * Vue générale : indicateurs d'instant (snapshot) + reconstruction des
 * indicateurs périodiques avec comparaison à la période précédente.
 * Dénominateur nul → pourcentage non calculé (valeur absolue seule).
 */

export interface Kpi {
  key: string;
  label: string;
  definition: string;
  value: number;
  unit: string;
  previous: number | null;
  delta: number | null;
  deltaPercent: number | null;
}

interface SnapshotSource {
  key: string;
  label: string;
  definition: string;
  unit: string;
  query: () => number;
}

const SNAPSHOT_SOURCES: SnapshotSource[] = [
  {
    key: 'lots_actifs',
    label: 'Lots actifs',
    definition:
      'Lots de coupe non annulés ni brouillons (statuts en_cours, attente_validation, bloque, pret_transfert, transfere). Source : coupe_lots.',
    unit: 'lots',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM coupe_lots
           WHERE status IN ('en_cours','attente_validation','bloque','pret_transfert','transfere')`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'cartons_stock',
    label: 'Cartons en stock (physiques)',
    definition:
      'Cartons ni vides ni annulés présents en stock (st_cartons.status IN cloture, en_stock, partiellement_sorti, reserve). Nombre de cartons ≠ nombre de pièces.',
    unit: 'cartons',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM st_cartons
           WHERE status IN ('cloture','en_stock','partiellement_sorti','reserve')`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'commandes_preparation',
    label: 'Commandes en préparation',
    definition:
      'Commandes externes en cours de préparation ou partiellement préparées (mg_orders.status IN en_preparation, partielle).',
    unit: 'commandes',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM mg_orders WHERE status IN ('en_preparation','partielle')`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'dossiers_attente',
    label: 'Dossiers en attente de contrôle sécurité',
    definition:
      'Derniers dossiers soumis sans décision de sécurité (mg_dossiers.status = soumis, security_result NULL, dernière version par commande).',
    unit: 'dossiers',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM mg_dossiers d
           WHERE d.status = 'soumis' AND d.security_result IS NULL
             AND d.id = (SELECT MAX(x.id) FROM mg_dossiers x WHERE x.order_id = d.order_id)`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'anomalies_bloquantes',
    label: 'Anomalies critiques ouvertes',
    definition:
      'Anomalies de sécurité critiques non résolues (sec_anomalies.severity = critical, status = ouverte).',
    unit: 'anomalies',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies
           WHERE severity = 'critical' AND status = 'ouverte'`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'validations_attente',
    label: 'Validations sensibles en attente',
    definition:
      'Demandes de double validation non traitées (sensitive_requests.status = en_attente), tous modules.',
    unit: 'demandes',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sensitive_requests WHERE status = 'en_attente'`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
  {
    key: 'alertes_ouvertes',
    label: 'Alertes ouvertes',
    definition:
      'Alertes non clôturées (alerts.status IN nouvelle, en_cours), tous modules confondus.',
    unit: 'alertes',
    query: () => {
      const row = sessionsDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM alerts WHERE status IN ('nouvelle','en_cours')`,
        )
        .get() as { n: number };
      return row.n;
    },
  },
];

function buildSnapshot(source: SnapshotSource): Kpi {
  return {
    key: source.key,
    label: source.label,
    definition: source.definition,
    value: source.query(),
    unit: source.unit,
    previous: null,
    delta: null,
    deltaPercent: null,
  };
}

/** Reconstruit un indicateur périodique avec sa comparaison. */
export function buildPeriodKpi(
  source: {
    key: string;
    label: string;
    definition: string;
    unit: string;
    query: (range: PeriodRange, filters: ReportFilters) => number;
  },
  current: PeriodRange,
  previous: PeriodRange,
  filters: ReportFilters,
): Kpi {
  const value = source.query(current, filters);
  const prev = source.query(previous, filters);
  const delta = value - prev;
  return {
    key: source.key,
    label: source.label,
    definition: source.definition,
    value,
    unit: source.unit,
    previous: prev,
    delta,
    deltaPercent: prev === 0 ? null : (delta / prev) * 100,
  };
}

export function snapshotKpis(): Kpi[] {
  return SNAPSHOT_SOURCES.map(buildSnapshot);
}
