/**
 * Harnais de tests du projet (style commun à tous les modules).
 * Aucune dépendance externe : assertions minimales et compteur.
 */

import { ServiceError } from '../src/server/api/service-error';

let passed = 0;

/** Exécute un bloc de vérifications ; incrémente si aucune erreur. */
export function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✔ ${label}`);
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Comparaison flottante avec tolérance (coordonnées en cm). */
export function expectClose(actual: number, expected: number, epsilon = 1e-9, label = ''): void {
  expect(Math.abs(actual - expected) <= epsilon, `${label || 'valeur'} : attendu ${expected}, reçu ${actual}`);
}

/** Vérifie qu'une fonction lève une ServiceError (statut optionnel). */
export function throwsService(fn: () => void, status?: number): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    if (!(error instanceof ServiceError)) {
      throw error;
    }
    if (status !== undefined && error.status !== status) {
      throw new Error(`Statut attendu ${status}, reçu ${error.status} : ${error.message}`);
    }
  }
  if (!threw) {
    throw new Error(`Aucune erreur levée (statut attendu ${status ?? 'quelconque'}).`);
  }
}

export function testPassed(): string {
  return `${passed} test(s) réussi(s).`;
}
