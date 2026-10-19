'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Hook de chargement des données du module Magasinier via les routes
 * API internes (messages d'erreur en français, rechargement manuel).
 */
export function useMagasinierData<T>(url: string | null) {
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

/** Envoi d'une requête d'écriture (POST JSON) avec gestion d'erreurs FR. */
export async function sendMagasinier(
  url: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? 'L’opération a échoué.');
  }
  return payload as Record<string, unknown>;
}

/** Envoi d'un fichier (multipart) avec gestion d'erreurs FR. */
export async function uploadPdf(
  url: string,
  file: File,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(url, { method: 'POST', body: form });
  const payload = (await response.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? 'L’importation a échoué.');
  }
  return payload as Record<string, unknown>;
}
