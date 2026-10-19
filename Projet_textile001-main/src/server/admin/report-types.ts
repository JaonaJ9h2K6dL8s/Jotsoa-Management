import type { PeriodRange } from './periods';
import type { ReportFilters } from './filters';
import type { Kpi } from './overview';

/** Types partagés des rapports par section (tableaux + KPI). */

export interface ReportTable {
  key: string;
  label: string;
  columns: Array<{ key: string; label: string; numeric?: boolean }>;
  rows: Array<Record<string, string | number | null>>;
  note?: string;
}

export interface SectionReport {
  section: string;
  title: string;
  periodLabel: string;
  previousLabel: string;
  kpis: Kpi[];
  tables: ReportTable[];
  notes: string[];
}

export interface SectionPayload {
  kpis: Kpi[];
  tables: ReportTable[];
  notes: string[];
}

export interface SectionDefinition {
  key: string;
  title: string;
  build: (input: {
    current: PeriodRange;
    previous: PeriodRange;
    filters: ReportFilters;
  }) => SectionPayload;
}

/** Assemble le rapport final (étiquettes de période + section). */
export function finalizeReport(
  definition: SectionDefinition,
  current: PeriodRange,
  previous: PeriodRange,
  payload: SectionPayload,
): SectionReport {
  return {
    section: definition.key,
    title: definition.title,
    periodLabel: current.label,
    previousLabel: previous.label,
    ...payload,
  };
}

export function table(
  key: string,
  label: string,
  columns: Array<[string, string, boolean?]>,
  rows: Array<Record<string, string | number | null>>,
  note?: string,
): ReportTable {
  return {
    key,
    label,
    columns: columns.map(([k, lab, numeric]) => ({ key: k, label: lab, numeric: numeric ?? false })),
    rows,
    note,
  };
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}
