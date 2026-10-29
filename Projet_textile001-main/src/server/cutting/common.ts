import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { parseNumberInput } from '@/lib/coupe-validation';

/**
 * Aides communes aux services du module Coupe reconstruit.
 * Règles d'autorisation : les opérations d'atelier (écriture) sont
 * réservées au chef de coupe ; validation des plans par le chef de coupe ;
 * validation des fiches/patrons et configuration des tables par l'admin.
 * Consulter le module ne donne aucun droit d'écriture.
 */

export function assertCoupeWrite(actor: Actor): void {
  if (actor.roleCode !== 'chef_coupe') {
    throw new ServiceError(
      'Seul le chef de coupe peut effectuer cette opération.',
      403,
    );
  }
}

export function assertCoupeAdmin(actor: Actor): void {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError(
      'Seul un administrateur peut effectuer cette opération.',
      403,
    );
  }
}

export function assertCoupePlanValidation(actor: Actor): void {
  if (actor.roleCode !== 'chef_coupe' && actor.roleCode !== 'admin') {
    throw new ServiceError('Seul le chef de coupe peut valider ce plan.', 403);
  }
}

/** Identifiant entier strictement positif. */
export function requireId(value: unknown, label: string): number {
  const parsed = parseNumberInput(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw new ServiceError(`${label} est requis.`, 400);
  }
  return parsed;
}

/** Entier dans un intervalle inclusif. */
export function requireInt(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const parsed = parseNumberInput(value);
  if (parsed === null || !Number.isInteger(parsed)) {
    throw new ServiceError(`${label} doit être un entier.`, 400);
  }
  if (parsed < min || parsed > max) {
    throw new ServiceError(
      `${label} doit être compris entre ${min} et ${max}.`,
      400,
    );
  }
  return parsed;
}

/** Nombre positif (strictement si `positive`). */
export function requirePositive(
  value: unknown,
  label: string,
  positive = true,
): number {
  const parsed = parseNumberInput(value);
  if (parsed === null) {
    throw new ServiceError(`${label} est requis et doit être numérique.`, 400);
  }
  if (parsed < 0) {
    throw new ServiceError(`${label} ne peut pas être négatif.`, 400);
  }
  if (positive && parsed === 0) {
    throw new ServiceError(`${label} doit être strictement positif.`, 400);
  }
  return parsed;
}

/** Texte non vide, borné. */
export function requireText(
  value: unknown,
  label: string,
  maxLength = 120,
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new ServiceError(`${label} est requis.`, 400);
  }
  if (text.length > maxLength) {
    throw new ServiceError(
      `${label} ne doit pas dépasser ${maxLength} caractères.`,
      400,
    );
  }
  return text;
}

/** Entier optionnel (référence nullable). */
export function optionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseNumberInput(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Exécute plusieurs écritures dans une transaction. */
export function inTransaction<T>(
  db: Database.Database,
  fn: () => T,
): T {
  return db.transaction(fn)();
}
