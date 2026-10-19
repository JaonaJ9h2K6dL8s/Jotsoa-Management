/**
 * Erreur métier transportant un statut HTTP, levée par les services
 * serveur et convertie en réponse JSON par les routes API.
 */
export class ServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

export function serviceErrorCode(error: unknown): number {
  return error instanceof ServiceError ? error.status : 500;
}
