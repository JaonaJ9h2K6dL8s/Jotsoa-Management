import type { OptimizerPlacement, OptimizerResult } from './optimizer';

/**
 * Score de comparaison documenté (étapes 5–6) — pur, sans I/O :
 * 1. quantité totale de pièces non placées croissante (ne jamais
 *    « gagner » en oubliant des pièces) ;
 * 2. longueur consommée croissante (max des enveloppes Y, cm) ;
 * 3. empreinte sérialisée des placements (départage stable,
 *    déterminisme d'une exécution à l'autre).
 * Aucune comparaison de taux d'utilisation : deux solutions ne sont
 * comparables qu'à pièces et contraintes égales.
 */

/** Longueur consommée d'un placement (max des enveloppes Y, cm). */
export function consumedLength(placements: OptimizerPlacement[]): number {
  let length = 0;
  for (const placement of placements) {
    length = Math.max(length, placement.points.length
      ? Math.max(...placement.points.map((p) => p.y))
      : 0);
  }
  return length;
}

function resultRank(result: OptimizerResult): [number, number, string] {
  const unplacedQty = result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
  const fingerprint = JSON.stringify(
    result.placements.map((p) => [p.pieceId, p.x, p.y, p.rotation]),
  );
  return [unplacedQty, Math.round(consumedLength(result.placements) * 1000), fingerprint];
}

/** true si `candidate` bat strictement `reference` selon le score. */
export function rankBetter(candidate: OptimizerResult, reference: OptimizerResult): boolean {
  const a = resultRank(candidate);
  const b = resultRank(reference);
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}
