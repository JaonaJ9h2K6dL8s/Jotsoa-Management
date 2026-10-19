/**
 * Types du module Rapports & pilotage (admin), côté client. Miroir des
 * structures produites par /api/admin/rapports et /api/admin/alertes.
 */

export type PeriodPreset =
  | 'jour'
  | 'semaine'
  | 'mois'
  | 'trimestre'
  | 'annee'
  | 'personnalisee';

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

export interface AlertRow {
  id: number;
  category: string;
  severity: string;
  status: string;
  message: string;
  objectType: string | null;
  objectId: number | null;
  ownerRole: string | null;
  createdAt: string;
}

/** Filtres numériques/texte applicables aux rapports. */
export interface PilotageFilterState {
  lotId: string;
  productId: string;
  colorId: string;
  sizeId: string;
  roomId: string;
  lineId: string;
  userId: string;
  status: string;
  orderRef: string;
  cartonId: string;
  locationId: string;
}

export const EMPTY_FILTERS: PilotageFilterState = {
  lotId: '',
  productId: '',
  colorId: '',
  sizeId: '',
  roomId: '',
  lineId: '',
  userId: '',
  status: '',
  orderRef: '',
  cartonId: '',
  locationId: '',
};

/** Construit la chaîne de requête (période + filtres) pour les API. */
export function buildQuery(
  period: PeriodPreset,
  from: string,
  to: string,
  filters: PilotageFilterState,
): string {
  const params = new URLSearchParams();
  params.set('period', period);
  if (period === 'personnalisee') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim() !== '') params.set(key, value.trim());
  }
  return params.toString();
}
