/**
 * Contexte partagé des tests du module Coupe.
 * Fournit les acteurs, les références de configuration et les aides
 * d'assertion aux fichiers de cas de test.
 */

import type Database from 'better-sqlite3';
import type { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';

export interface CoupeTestContext {
  db: Database.Database;
  CHEF: Actor;
  STOCK: Actor;
  ADMIN: Actor;
  productId: number;
  colorId: number;
  sizeIds: number[];
}

export interface CoupeTestTools {
  passed: { count: number };
  check: (label: string, fn: () => void) => void;
  throwsService: (fn: () => void, status: number) => void;
}

export function createTestTools(
  ServiceErrorCtor: typeof ServiceError,
): CoupeTestTools {
  const passed = { count: 0 };
  return {
    passed,
    check(label, fn) {
      fn();
      passed.count += 1;
      console.log(`  ✔ ${label}`);
    },
    throwsService(fn, status) {
      let threw = false;
      try {
        fn();
      } catch (error) {
        threw = true;
        if (!(error instanceof ServiceErrorCtor) || error.status !== status) {
          throw error;
        }
      }
      if (!threw) {
        throw new Error(`Aucune erreur levée (statut attendu ${status}).`);
      }
    },
  };
}
