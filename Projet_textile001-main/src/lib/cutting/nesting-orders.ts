import type { NestItem } from './nesting';

/**
 * Ordres de placement déterministes du nesting BLF (étape 16).
 * Chaque ordre est une stratégie identifiable, décroissante sauf
 * mention contraire, avec départage stable par code :
 * 1. hauteur minimale (les pièces hautes d'abord) ;
 * 2. aire décroissante (les grandes surfaces d'abord) ;
 * 3. largeur maximale (les pièces larges d'abord) ;
 * 4. complexité du contour (sommets décroissants) : les pièces
 *    concaves/complexes placées en premier laissent les pièces
 *    simples remplir les creux ensuite.
 */
export type NestOrder = (first: NestItem, second: NestItem) => number;

function complexityOf(item: NestItem): number {
  return item.orientations[0]?.points.length ?? 0;
}

export const NEST_ORDERS: NestOrder[] = [
  (a, b) => b.minH - a.minH || b.maxW - a.maxW || a.code.localeCompare(b.code),
  (a, b) => b.areaM2 - a.areaM2 || b.maxW - a.maxW || a.code.localeCompare(b.code),
  (a, b) => b.maxW - a.maxW || b.minH - a.minH || a.code.localeCompare(b.code),
  (a, b) => complexityOf(b) - complexityOf(a)
    || b.areaM2 - a.areaM2 || a.code.localeCompare(b.code),
];
