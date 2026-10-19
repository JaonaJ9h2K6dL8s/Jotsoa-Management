'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildQuery,
  EMPTY_FILTERS,
  type AlertRow,
  type PeriodPreset,
  type PilotageFilterState,
  type SectionReport,
} from '@/types/pilotage';

/**
 * Chargement des rapports et alertes admin via les API internes.
 * Aucun calcul local : les chiffres proviennent des services serveur.
 */

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as {
    status?: string;
    item?: T;
    items?: T[];
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? 'Erreur de chargement.');
  }
  return body.item as T;
}

export function usePilotageReport(query: string) {
  const [report, setReport] = useState<SectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchJson<SectionReport>(`/api/admin/rapports?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { report, loading, error, refresh };
}

export function usePilotageAlerts(query: string) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<AlertRow[]>(`/api/admin/alertes?${query}`);
      setAlerts(Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { alerts, loading, error, refresh };
}

/** État partagé de navigation du module (section, période, filtres). */
export function usePilotageState() {
  const [section, setSection] = useState('general');
  const [period, setPeriod] = useState<PeriodPreset>('mois');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<PilotageFilterState>(EMPTY_FILTERS);
  const [alertsSeverity, setAlertsSeverity] = useState('');
  const [alertsStatus, setAlertsStatus] = useState('');

  const reportQuery = buildQuery(period, from, to, filters);
  const alertParams = new URLSearchParams();
  alertParams.set('period', 'mois');
  if (alertsSeverity) alertParams.set('severity', alertsSeverity);
  if (alertsStatus) alertParams.set('status', alertsStatus);
  if (filters.userId.trim() !== '') alertParams.set('userId', filters.userId.trim());
  const alertsQuery = alertParams.toString();

  const setFilter = (key: keyof PilotageFilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const exportUrl = (format: 'excel' | 'pdf') =>
    `/api/admin/exports?format=${format}&section=${encodeURIComponent(section)}&${reportQuery}`;

  return {
    section,
    setSection,
    period,
    setPeriod,
    from,
    setFrom,
    to,
    setTo,
    filters,
    setFilter,
    resetFilters,
    reportQuery,
    alertsQuery,
    alertsSeverity,
    setAlertsSeverity,
    alertsStatus,
    setAlertsStatus,
    exportUrl,
  };
}
