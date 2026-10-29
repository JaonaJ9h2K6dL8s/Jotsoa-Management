import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';

/**
 * Aides communes au service Commandes.
 * Réplique locale des utilitaires partagés (ex. coupe/common).
 */

/** Convertit un identifiant reçu en entier positif, sinon erreur 400. */
export function requireId(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ServiceError(`${label} invalide.`, 400);
  }
  return value;
}

/**
 * Génération de codes séquentiels pour les commandes.
 * Réplique locale de l'utilitaire partagé (ex. coupe/common).
 */
export function nextCode(
  db: Database.Database,
  table: string,
  prefix: string,
): string {
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`)
    .get() as { next: number };
  return `${prefix}${String(row.next).padStart(6, '0')}`;
}
