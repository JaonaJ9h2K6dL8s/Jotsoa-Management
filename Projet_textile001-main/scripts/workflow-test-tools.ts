/**
 * Aides d'assertion partagées des tests du workflow des lots de coupe.
 */

let passed = 0;

export function testPassed(): number {
  return passed;
}

export function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✔ ${label}`);
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion échouée : ${message}`);
}

export function throwsService(fn: () => void, status: number): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    const err = error as { status?: number };
    if (err.status !== status) throw error;
  }
  if (!threw) {
    throw new Error(`Aucune erreur levée (statut attendu ${status}).`);
  }
}
