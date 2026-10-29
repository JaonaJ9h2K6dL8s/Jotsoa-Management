import { check, expect } from './test-tools';
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
  grainPermittedRotations,
  insideRect,
  polygonsConflict,
} from '../src/lib/cutting/geometry';
import { makeBenchmarkPieces } from './nesting-benchmark-fixtures';

function unplacedCount(result: OptimizerResult): number {
  return result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
}

function assertValid(input: OptimizerInput, result: OptimizerResult): void {
  const zone = { x: 0, y: 0, width: input.usableWidthCm, height: input.maxLengthCm };
  for (const placement of result.placements) {
    expect(insideRect(placement.points, zone), `${placement.code} reste dans la table`);
    expect(placement.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      `${placement.code} a des coordonnées finies`);
    const source = input.pieces.find((piece) => piece.id === placement.pieceId);
    expect(source !== undefined, `pièce ${placement.pieceId} existe dans l'entrée`);
    const permitted = grainPermittedRotations(
      source.grainDirection, source.allowedRotations, input.oneWayFabric ?? false,
    );
    expect(permitted.includes(placement.rotation), `${placement.code} respecte rotation et droit-fil`);
  }
  for (let first = 0; first < result.placements.length; first += 1) {
    for (let second = first + 1; second < result.placements.length; second += 1) {
      expect(!polygonsConflict(
        result.placements[first].points,
        result.placements[second].points,
        input.gapCm,
      ), `aucune collision des contours ${first}/${second}`);
    }
  }
  expect(result.placements.length + unplacedCount(result) === input.pieces.reduce(
    (sum, piece) => sum + Math.max(0, Math.floor(piece.qty)), 0,
  ), 'placements + non-placements = quantité totale');
}

function inputFor(count: number, oneWayFabric = false): OptimizerInput {
  return {
    usableWidthCm: 170,
    maxLengthCm: 1200,
    gapCm: 1,
    pieces: makeBenchmarkPieces(count),
    oneWayFabric,
  };
}

export function runCuttingStep15Tests(checkFn: typeof check): void {
  checkFn('Étape 15 : benchmarks 20/60/100/200 reproductibles et mêmes entrées', () => {
    for (const count of [20, 60, 100, 200]) {
      const first = inputFor(count);
      const second = inputFor(count);
      expect(JSON.stringify(first) === JSON.stringify(second), `${count} pièces déterministes`);
      expect(first.pieces.length === count, `jeu de ${count} pièces`);
      expect(first.usableWidthCm === second.usableWidthCm
        && first.maxLengthCm === second.maxLengthCm
        && first.gapCm === second.gapCm, 'dimensions et gap identiques');
    }
  });

  checkFn('Étape 15 : shelf, BLF, local et combiné prennent la même entrée', () => {
    const input = inputFor(20);
    const sourceSnapshot = JSON.stringify(input.pieces);
    const shelf = optimizePlacement(input);
    const nest = nestPlacement(input, { timeBudgetMs: 1000 });
    const local = improvePlacementLocal(shelf.placements, input, { timeBudgetMs: 1000 });
    const combined = optimizePlacementBest(input, { timeBudgetMs: 1500 });
    for (const result of [shelf, nest, { ...shelf, placements: local.placements }, combined]) {
      assertValid(input, result);
    }
    expect(local.placements.length === shelf.placements.length, 'local garde toutes les instances placées');
    expect(JSON.stringify(input.pieces) === sourceSnapshot, 'entrée partagée non mutée par les algorithmes');
  });

  for (const count of [20, 60, 100, 200]) {
    checkFn(`Étape 15 : solution combinée valide et métriques cohérentes (${count})`, () => {
      const input = inputFor(count);
      const started = performance.now();
      const result = optimizePlacementBest(input, { timeBudgetMs: 1500 });
      const durationMs = performance.now() - started;
      assertValid(input, result);
      expect(Number.isFinite(durationMs) && durationMs >= 0, 'durée réelle mesurée');
      expect(result.phaseMs !== undefined
        && Number.isFinite(result.phaseMs.shelfFfd)
        && Number.isFinite(result.phaseMs.nestBlf)
        && Number.isFinite(result.phaseMs.localImprove), 'durées des phases exposées');
      const metrics = computeMetrics(
        result.placements.map((placement) => placement.points),
        input.usableWidthCm,
        result.placements.length,
        unplacedCount(result),
      );
      expect(Math.abs(metrics.consumedLengthCm - result.metrics.consumedLengthCm) < 1e-6,
        'longueur recalculée depuis les contours placés');
      expect(Math.abs(metrics.piecesAreaM2 - result.metrics.piecesAreaM2) < 1e-8,
        'surface des pièces recalculée depuis les contours placés');
      expect(Math.abs(metrics.utilizationPct - result.metrics.utilizationPct) < 1e-6,
        'taux géométrique recalculé');
      expect(Math.abs(metrics.wasteAreaM2 + metrics.piecesAreaM2 - metrics.consumedAreaM2) < 1e-8,
        'perte géométrique = surface consommée − surface des pièces');
    });
  }

  checkFn('Étape 15 : 200 pièces ne publient jamais un chevauchement au budget atteint', () => {
    const input = inputFor(200);
    const result = optimizePlacementBest(input, { timeBudgetMs: 1 });
    assertValid(input, result);
    expect(result.budgetExpired === true, 'budget atteint explicitement signalé');
    expect(result.fallbackUsed === true, 'repli shelf-ffd explicitement signalé');
    expect(result.method === 'shelf-ffd', 'le candidat shelf valide est conservé');
  });

  checkFn('Étape 15 : nesting à zéro budget liste clairement les pièces restantes', () => {
    const input = inputFor(20);
    const result = nestPlacement(input, { timeBudgetMs: 1000, maxExactTests: 0 });
    assertValid(input, result);
    expect(result.stats?.expired === true, 'interruption de budget remontée');
    expect(unplacedCount(result) > 0, 'pièces restantes signalées, pas de complétude simulée');
    expect(result.placements.length + unplacedCount(result) === 20, 'bilan intégral des 20 pièces');
    expect(result.unplaced.every((item) => item.reason.toLowerCase().includes('budget')),
      'motif budget explicite pour chaque pièce');
  });

  checkFn('Étape 15 : couverture complète prioritaire, longueur comparée ensuite', () => {
    const input = inputFor(60);
    const shelf = optimizePlacement(input);
    const nested = nestPlacement(input, { timeBudgetMs: 1500 });
    const combined = optimizePlacementBest(input, { timeBudgetMs: 2000 });
    expect(unplacedCount(combined) <= unplacedCount(shelf), 'aucune dégradation de couverture vs shelf');
    expect(unplacedCount(combined) <= unplacedCount(nested), 'aucune dégradation de couverture vs BLF');
    if (unplacedCount(combined) === unplacedCount(shelf)) {
      expect(combined.metrics.consumedLengthCm <= shelf.metrics.consumedLengthCm + 1e-6,
        'à couverture égale, combiné pas plus long que shelf');
    }
    if (unplacedCount(combined) === unplacedCount(nested)) {
      expect(combined.metrics.consumedLengthCm <= nested.metrics.consumedLengthCm + 1e-6,
        'à couverture égale, combiné pas plus long que BLF');
    }
  });

  checkFn('Étape 15 : rotations permises et droit-fil à sens unique conservés', () => {
    for (const oneWayFabric of [false, true]) {
      const input = inputFor(60, oneWayFabric);
      const result = optimizePlacementBest(input, { timeBudgetMs: 1500 });
      assertValid(input, result);
    }
  });

  checkFn('Étape 15 : dimensions non finies refusées comme pièces non placées', () => {
    const input = inputFor(2);
    input.pieces[1].points = [
      { x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 4, y: 2 },
    ];
    const result = nestPlacement(input, { timeBudgetMs: 500 });
    expect(result.unplaced.some((item) => item.code === input.pieces[1].code),
      'contour invalide apparaît dans les non placées');
    expect(!result.placements.some((item) => item.pieceId === input.pieces[1].id),
      'contour invalide jamais accepté');
  });

  checkFn('Étape 15 : les propositions restent distinctes du placement source', () => {
    const input = inputFor(20);
    const shelf = optimizePlacement(input);
    const before = JSON.stringify(shelf.placements);
    const proposal = optimizePlacementBest(input, { timeBudgetMs: 1000 });
    expect(JSON.stringify(shelf.placements) === before, 'lancement sans écrasement de la solution courante');
    assertValid(input, proposal);
  });
}
