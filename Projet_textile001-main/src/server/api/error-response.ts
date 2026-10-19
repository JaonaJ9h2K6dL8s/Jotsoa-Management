/**
 * Construction centralisée des réponses d'erreur API.
 * Évite de dupliquer le formatage des erreurs dans chaque route.
 */

export interface ApiErrorBody {
  status: 'error';
  message: string;
}

export function toApiError(error: unknown, fallback: string): ApiErrorBody {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  return { status: 'error', message };
}
