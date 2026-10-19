'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Hook de chargement des données du module Coupe via les routes API
 * internes (messages d'erreur en français, rechargement contrôlé).
 */
export function useCoupeData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        status: string;
        item?: T;
        items?: T;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message ?? 'Erreur de chargement.');
      }
      setData((body.item ?? body.items ?? null) as T | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh, setError };
}
