import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import type { ReportFilters } from './filters';
import { buildPeriodKpi, snapshotKpis } from './overview';
import { FLOW_SOURCES } from './overview-sources';
import type {
  SectionDefinition,
  SectionPayload,
} from './report-types';
import {
  coupeKpis,
  coupeReport,
  coutureKpis,
  coutureReport,
  initialConformityRate,
} from './report-production';
import {
  qualiteKpis,
  qualiteReport,
  retoucheKpis,
  retoucheReport,
} from './report-quality';
import {
  sortiesKpis,
  sortiesReport,
  stockKpis,
  stockReport,
} from './report-logistics';

/** Registre des sections de rapport (une seule source de calcul). */

function overviewSection({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: [
      ...FLOW_SOURCES.map((source) => buildPeriodKpi(source, current, previous, filters)),
      ...snapshotKpis(),
    ],
    tables: [],
    notes: [
      'Les quantités des différentes étapes (coupées, cousues, contrôlées, stockées) ne sont jamais additionnées entre elles.',
      'Chaque indicateur documente sa source exacte ; les définitions figurent sous chaque carte.',
    ],
  };
}

function buildCoupe({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: coupeKpis(current, previous, filters),
    tables: coupeReport(current, filters),
    notes: [
      'Prévu ≠ coupé ≠ utilisable : aucune conversion automatique du tissu (kg) en pièces.',
    ],
  };
}

function buildCouture({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: coutureKpis(current, previous, filters),
    tables: coutureReport(current, filters),
    notes: [
      'Quantité affectée ≠ quantité cousue ; seules les productions normales sont comptées.',
    ],
  };
}

function buildQualite({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  const conformity = initialConformityRate(current, filters);
  return {
    kpis: qualiteKpis(current, previous, filters),
    tables: qualiteReport(current, filters),
    notes: [
      conformity.rate === null
        ? 'Taux de conformité initiale : données insuffisantes (aucune pièce contrôlée sur la période).'
        : `Taux de conformité initiale : ${conformity.rate.toFixed(1)} % (${conformity.conforme} / ${conformity.controlled} pièces contrôlées).`,
      'Occurrences de défauts ≠ pièces défectueuses : une pièce peut présenter plusieurs défauts.',
    ],
  };
}

function buildRetouche({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: retoucheKpis(current, previous, filters),
    tables: retoucheReport(current, filters),
    notes: [
      'Conformité finale : seule la décision du contrôle qualité final détermine la conformité.',
    ],
  };
}

function buildStock({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: stockKpis(current, previous, filters),
    tables: stockReport(current, filters),
    notes: [
      'Stock disponible selon la convention du module Stock (mouvements autorisés uniquement).',
    ],
  };
}

function buildSorties({
  current,
  previous,
  filters,
}: {
  current: PeriodRange;
  previous: PeriodRange;
  filters: ReportFilters;
}): SectionPayload {
  return {
    kpis: sortiesKpis(current, previous, filters),
    tables: sortiesReport(current, filters),
    notes: [
      'Une commande importée ou préparée n’est jamais une sortie définitive ; seuls les mouvements de sortie enregistrés le prouvent.',
    ],
  };
}

export const SECTIONS: SectionDefinition[] = [
  { key: 'general', title: 'Vue générale de l’entreprise', build: overviewSection },
  { key: 'coupe', title: 'Coupe et consommation', build: buildCoupe },
  { key: 'couture', title: 'Couture et production', build: buildCouture },
  { key: 'qualite', title: 'Contrôle qualité', build: buildQualite },
  { key: 'retouche', title: 'Retouche et rebuts', build: buildRetouche },
  { key: 'stock', title: 'Cartons et stock', build: buildStock },
  { key: 'sorties', title: 'Commandes et sorties', build: buildSorties },
];

export function resolveSection(key: string): SectionDefinition {
  const section = SECTIONS.find((item) => item.key === key);
  if (!section) {
    throw new Error('Section de rapport inconnue.');
  }
  return section;
}

/** Alertes transversales (lecture seule, admin). */
export function transversalAlerts(
  filters: ReportFilters,
  current: PeriodRange,
): Array<{
  id: number;
  category: string;
  severity: string;
  status: string;
  message: string;
  objectType: string | null;
  objectId: number | null;
  ownerRole: string | null;
  createdAt: string;
}> {
  const db = sessionsDb();
  const clauses: string[] = ['a.created_at >= ?', 'a.created_at < ?'];
  const args: unknown[] = [current.from, current.to];
  if (filters.severity !== null) {
    clauses.push('a.severity = ?');
    args.push(filters.severity);
  }
  if (filters.status !== null) {
    clauses.push('a.status = ?');
    args.push(filters.status);
  }
  if (filters.userId !== null) {
    clauses.push('a.owner_role = (SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?)');
    args.push(filters.userId);
  }
  return (
    db
      .prepare(
        `SELECT a.id, a.category, a.severity, a.status, a.message,
                a.object_type, a.object_id, a.owner_role, a.created_at
         FROM alerts a
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.id DESC LIMIT 300`,
      )
      .all(...args) as Array<{
      id: number;
      category: string;
      severity: string;
      status: string;
      message: string;
      object_type: string | null;
      object_id: number | null;
      owner_role: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    message: row.message,
    objectType: row.object_type,
    objectId: row.object_id,
    ownerRole: row.owner_role,
    createdAt: row.created_at,
  }));
}
