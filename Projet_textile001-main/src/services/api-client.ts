/**
 * Client HTTP minimaliste pour les routes API internes.
 * Centralise le parsing JSON et la gestion d'erreur réseau.
 */

async function parseError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as
    | { message?: unknown }
    | null;
  const message =
    body && typeof body.message === 'string' && body.message.length > 0
      ? body.message
      : `Requête échouée (${response.status})`;
  throw new Error(message);
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    await parseError(response);
  }
  return (await response.json()) as T;
}

async function send<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT',
  payload: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  if (!response.ok) {
    await parseError(response);
  }
  return (await response.json()) as T;
}

export function apiPost<T>(url: string, payload: unknown): Promise<T> {
  return send<T>(url, 'POST', payload);
}

export function apiPatch<T>(url: string, payload: unknown): Promise<T> {
  return send<T>(url, 'PATCH', payload);
}

export function apiPut<T>(url: string, payload: unknown): Promise<T> {
  return send<T>(url, 'PUT', payload);
}
