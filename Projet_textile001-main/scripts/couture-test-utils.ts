/**
 * Outils d'assertion des tests du module Couture.
 */

import type { ServiceError } from '../src/server/api/service-error';
import type { CoupeTestTools } from './coupe-test-context';

export type CoutureTestTools = CoupeTestTools & {
  throws: (fn: () => void) => void;
};

export function createCoutureTools(
  ServiceErrorCtor: typeof ServiceError,
): CoutureTestTools {
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
    throws(fn) {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) throw new Error('Aucune erreur levée.');
    },
  };
}
