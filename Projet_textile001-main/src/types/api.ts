/** Réponse de GET /api/health. */
export interface ApiHealthResponse {
  status: 'ok' | 'error';
  database?: {
    path: string;
    migrationsApplied: string[];
  };
  message?: string;
}
