/**
 * Benchmark étape 15 — performances réelles des algorithmes de
 * placement, sur des jeux synthétiques DÉTERMINISTES (aucune donnée
 * historique, aucune base de production) : 20, 60, 100 et 200 pièces.
 *
 * Algorithmes testés sur EXACTEMENT les mêmes pièces, contraintes,
 * dimensions utiles et rotations :
 * - shelf-ffd      : optimizePlacement (étagères, enveloppes) ;
 * - nest-blf       : nestPlacement (contours réels, 3 ordres) ;
 * - shelf+local    : improvePlacementLocal appliquée au shelf-ffd ;
 * - combiné        : optimizePlacementBest (shelf + nest + local).
 *
 * Mesures : durée, longueur occupée, surface pièces, taux
 * d'utilisation géométrique, perte géométrique, placées / non
 * placées, chevauchements réels (contrôle exact sur contours),
 * algorithme, recours au repli / budget.
 *
 * Exécution : npx tsx scripts/benchmark-cutting-nesting.ts [--quick]
 * (--quick : 20 et 60 pièces seulement, pour itérations de dev).
 */

import {
  computeMetrics,
  optimizePlacement,
  type OptimizerInput,
  type OptimizerResult,
} from '../src/lib/cutting/optimizer';
import { nestPlacement } from '../src/lib/cutting/nesting';
import { improvePlacementLocal } from '../src/lib/cutting/local-improve';
import { optimizePlacementBest } from '../src/lib/cutting/best-placement';
import {
  bounds,
  grainPermittedRotations,
  polygonArea,
  polygonsConflictFast,
} from '../src/lib/cutting/geometry';
import { makeBenchmarkPieces } from './nesting-benchmark-fixtures';

/** Contrôle exact de validité d'une solution (contours réels, O(n²)). */
function countConflicts(input: OptimizerInput, result: OptimizerResult): number {
  const gap = input.gapCm;
  const placements = result.placements;
  let conflicts = 0;
  for (const placement of placements) {
    if (placement.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      conflicts += 1;
      continue;
    }
    const box = bounds(placement.points);
    if (box.minX < -1e-6 || box.minY < -1e-6
      || box.maxX > input.usableWidthCm + 1e-6
      || box.maxY > input.maxLengthCm + 1e-6) conflicts += 1;
    const source = input.pieces.find((piece) => piece.id === placement.pieceId);
    if (!source || !grainPermittedRotations(
      source.grainDirection, source.allowedRotations, input.oneWayFabric ?? false,
    ).includes(placement.rotation)) conflicts += 1;
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (polygonsConflictFast(a.points, b.points, gap)) conflicts += 1;
    }
  }
  return conflicts;
}

interface BenchRow {
  scenario: number;
  algorithm: string;
  durationMs: number;
  consumedLengthCm: number;
  piecesAreaM2: number;
  utilizationPct: number;
  wasteAreaM2: number;
  placed: number;
  unplaced: number;
  conflicts: number;
  usedFallback: boolean;
  budgetExpired: boolean;
  method: string;
  phaseMs: { shelfFfd: number; nestBlf: number; localImprove: number } | null;
}

function evaluate(
  scenario: number,
  algorithm: string,
  input: OptimizerInput,
  result: OptimizerResult,
  durationMs: number,
): BenchRow {
  const conflicts = countConflicts(input, result);
  const unplaced = result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
  return {
    scenario,
    algorithm,
    durationMs,
    consumedLengthCm: result.metrics.consumedLengthCm,
    piecesAreaM2: result.metrics.piecesAreaM2,
    utilizationPct: result.metrics.utilizationPct,
    wasteAreaM2: result.metrics.wasteAreaM2,
    placed: result.placements.length,
    unplaced,
    conflicts,
    usedFallback: algorithm === 'combiné' && result.fallbackUsed === true,
    budgetExpired: result.budgetExpired === true || result.stats?.expired === true
      || result.improve?.expired === true,
    method: result.method,
    phaseMs: result.phaseMs ?? null,
  };
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function printRow(row: BenchRow): void {
  const cells = [
    String(row.scenario).padStart(4),
    row.algorithm.padEnd(12),
    `${fmt(row.durationMs, 0)} ms`.padStart(9),
    `${fmt(row.consumedLengthCm, 1)} cm`.padStart(11),
    `${fmt(row.piecesAreaM2, 2)} m²`.padStart(9),
    `${fmt(row.utilizationPct, 1)} %`.padStart(8),
    `${fmt(row.wasteAreaM2, 2)} m²`.padStart(10),
    `${row.placed}/${row.placed + row.unplaced}`.padStart(8),
    `conf:${row.conflicts}`,
    `méthode:${row.method}${row.usedFallback ? ' (repli)' : ''}`,
    row.phaseMs ? `phases ${row.phaseMs.shelfFfd}/${row.phaseMs.nestBlf}/${row.phaseMs.localImprove} ms` : '',
    row.budgetExpired ? 'budget atteint'
      : row.unplaced > 0 ? 'pièces non placées' : 'calcul terminé',
  ];
  console.log(cells.join(' | '));
}

const USABLE_WIDTH_CM = 170;
const MAX_LENGTH_CM = 1200;
const GAP_CM = 1;
const TIME_BUDGET_MS = 3000;

function benchScenario(count: number): BenchRow[] {
  const input: OptimizerInput = {
    usableWidthCm: USABLE_WIDTH_CM,
    maxLengthCm: MAX_LENGTH_CM,
    gapCm: GAP_CM,
    pieces: makeBenchmarkPieces(count),
  };
  const rows: BenchRow[] = [];
  const piecesArea = input.pieces.reduce(
    (sum, piece) => sum + polygonArea(piece.points) / 10000, 0,
  );

  let t0 = performance.now();
  const shelf = optimizePlacement(input);
  rows.push(evaluate(count, 'shelf-ffd', input, shelf, performance.now() - t0));

  t0 = performance.now();
  const nest = nestPlacement(input, { timeBudgetMs: TIME_BUDGET_MS });
  rows.push(evaluate(count, 'nest-blf', input, nest, performance.now() - t0));

  t0 = performance.now();
  const improvedShelf = improvePlacementLocal(shelf.placements, input, {
    timeBudgetMs: TIME_BUDGET_MS,
  });
  const shelfLocalDuration = performance.now() - t0;
  // Métriques RECALCULÉES après amélioration (jamais celles du shelf).
  const shelfLocal: OptimizerResult = {
    ...shelf,
    placements: improvedShelf.placements,
    metrics: computeMetrics(
      improvedShelf.placements.map((placement) => placement.points),
      input.usableWidthCm,
      improvedShelf.placements.length,
      shelf.unplaced.reduce((sum, item) => sum + item.quantity, 0),
    ),
    improve: improvedShelf.stats,
  };
  rows.push(evaluate(count, 'shelf+local', input, shelfLocal, shelfLocalDuration));
  console.log(`  (shelf+local : ${improvedShelf.stats.movesAccepted} déplacement(s) `
    + `accepté(s), ${improvedShelf.stats.passes} passe(s), expired=${improvedShelf.stats.expired})`);

  t0 = performance.now();
  const combined = optimizePlacementBest(input, { timeBudgetMs: TIME_BUDGET_MS });
  rows.push(evaluate(count, 'combiné', input, combined, performance.now() - t0));

  console.log(`\n=== Scénario ${count} pièces — surface totale des pièces `
    + `${fmt(piecesArea)} m², largeur ${USABLE_WIDTH_CM} cm, gap ${GAP_CM} cm, `
    + `budget ${TIME_BUDGET_MS} ms ===`);
  console.log('scén | algorithme | durée | longueur | surface pièces | util. | perte géom. | placées | erreurs | méthode | phases ms | statut');
  for (const row of rows) printRow(row);
  return rows;
}

function main(): void {
  const quick = process.argv.includes('--quick');
  const sizes = quick ? [20, 60] : [20, 60, 100, 200];
  console.log('Benchmark nesting textile — jeux synthétiques déterministes '
    + '(seed 20261023), contours réels.');
  const all: BenchRow[] = [];
  for (const size of sizes) all.push(...benchScenario(size));
  console.log('\n--- Résumé JSON (copiable) ---');
  console.log(JSON.stringify(all, null, 1));
}

main();
