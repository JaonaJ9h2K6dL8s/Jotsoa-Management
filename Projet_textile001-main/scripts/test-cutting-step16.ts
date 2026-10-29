import { check, expect } from './test-tools';
import { optimizePlacement, type OptimizerInput, type OptimizerResult } from '../src/lib/cutting/optimizer';
import { nestPlacement } from '../src/lib/cutting/nesting';
import { optimizePlacementBest } from '../src/lib/cutting/best-placement';
import { validateCandidate } from '../src/lib/cutting/nesting-validate';
import { makeBenchmarkPieces } from './nesting-benchmark-fixtures';

function inputFor(count: number): OptimizerInput {
  return {
    usableWidthCm: 170,
    maxLengthCm: 1200,
    gapCm: 1,
    pieces: makeBenchmarkPieces(count),
  };
}

/** Placement synthétique d'aide aux cas invalides. */
function placementOf(
  pieceId: number, label: string, rotation: number,
  points: Array<{ x: number; y: number }>,
): OptimizerResult['placements'][number] {
  return {
    pieceId, code: `P${pieceId}`, label,
    x: points[0].x, y: points[0].y,
    rotation: rotation as OptimizerResult['placements'][number]['rotation'],
    points,
  };
}

export function runCuttingStep16Tests(checkFn: typeof check): void {
  checkFn('Étape 16 : chaque candidate comparée est identifiable, une seule retenue', () => {
    const input = inputFor(20);
    const result = optimizePlacementBest(input, { timeBudgetMs: 1500 });
    expect(result.candidates !== undefined && result.candidates.length >= 2,
      'au moins deux stratégies comparées');
    const retained = result.candidates!.filter((candidate) => candidate.retained);
    expect(retained.length === 1, 'exactement une candidate retenue');
    expect(retained[0].strategy === result.method
      || (retained[0].strategy === `${result.method}+local` && result.improveApplied === true),
    'la candidate retenue correspond à la méthode publiée');
    const unplacedTotal = result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
    expect(retained[0].unplaced === unplacedTotal, 'non placées cohérentes avec la retenue');
    expect(Math.abs(retained[0].consumedLengthCm - result.metrics.consumedLengthCm) <= 0.1,
      'longueur de la retenue cohérente avec les métriques finales');
    const names = new Set(result.candidates!.map((candidate) => candidate.strategy));
    expect(names.size === result.candidates!.length, 'noms de stratégies distincts');
  });

  checkFn('Étape 16 : la proposition finale passe la validation géométrique indépendante', () => {
    const input = inputFor(20);
    for (const result of [
      optimizePlacement(input),
      nestPlacement(input, { timeBudgetMs: 1000 }),
      optimizePlacementBest(input, { timeBudgetMs: 1500 }),
    ]) {
      const defects = validateCandidate(input, result);
      expect(defects.length === 0,
        `aucun défaut : ${defects.map((defect) => defect.message).join(' ; ')}`);
    }
  });

  checkFn('Étape 16 : validateCandidate signale chevauchement, hors-zone, rotation, bilan', () => {
    const input = inputFor(2);
    input.pieces = [
      { ...input.pieces[0], points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] },
      { ...input.pieces[1], points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] },
    ];
    // Chevauchement : deux placements valides en rotation, superposés.
    const overlap: OptimizerResult = {
      placements: [
        placementOf(1, 'A', 0, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]),
        placementOf(2, 'B', 0, [{ x: 5, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 10 }, { x: 5, y: 10 }]),
      ],
      unplaced: [], metrics: {} as OptimizerResult['metrics'], method: 'shelf-ffd',
    };
    expect(validateCandidate(input, overlap).some((defect) => defect.code === 'chevauchement'),
      'chevauchement détecté');
    // Rotation interdite : droit-fil 'along', rotations [0], 90° refusé.
    const rotated: OptimizerResult = {
      placements: [
        placementOf(1, 'A', 90, [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0 }]),
      ],
      unplaced: [{ code: 'P002', label: 'B', quantity: 1, reason: 'test' }],
      metrics: {} as OptimizerResult['metrics'], method: 'shelf-ffd',
    };
    expect(validateCandidate(input, rotated).some((defect) => defect.code === 'rotation'),
      'rotation interdite détectée');
    // Hors zone : pièce dépassant la longueur de matelas.
    const outside: OptimizerResult = {
      placements: [
        placementOf(1, 'A', 0, [{ x: 0, y: 1195 }, { x: 20, y: 1195 }, { x: 20, y: 1205 }, { x: 0, y: 1205 }]),
      ],
      unplaced: [{ code: 'P002', label: 'B', quantity: 1, reason: 'test' }],
      metrics: {} as OptimizerResult['metrics'], method: 'shelf-ffd',
    };
    expect(validateCandidate(input, outside).some((defect) => defect.code === 'hors_zone'),
      'dépassement de zone détecté');
    // Bilan : 1 placée + 0 non placée ≠ 2 attendues.
    const bilan: OptimizerResult = {
      placements: [
        placementOf(1, 'A', 0, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]),
      ],
      unplaced: [], metrics: {} as OptimizerResult['metrics'], method: 'shelf-ffd',
    };
    expect(validateCandidate(input, bilan).some((defect) => defect.code === 'bilan'),
      'bilan incohérent détecté');
    // Solution complète valide : aucun défaut.
    const valid: OptimizerResult = {
      placements: [
        placementOf(1, 'A', 0, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]),
        placementOf(2, 'B', 0, [{ x: 21, y: 0 }, { x: 41, y: 0 }, { x: 41, y: 10 }, { x: 21, y: 10 }]),
      ],
      unplaced: [], metrics: {} as OptimizerResult['metrics'], method: 'shelf-ffd',
    };
    expect(validateCandidate(input, valid).length === 0, 'solution valide acceptée sans défaut');
  });

  checkFn('Étape 16 : ordre par complexité de contour — BLF valide et déterministe', () => {
    const input = inputFor(20);
    const first = nestPlacement(input, { timeBudgetMs: 1000 });
    const second = nestPlacement(input, { timeBudgetMs: 1000 });
    // `computeMs` est une durée mesurée : hors comparaison de
    // déterminisme (le placement lui-même doit être identique).
    const snapshot = (result: OptimizerResult): string => {
      const { computeMs: _computeMs, ...rest } = result;
      return JSON.stringify(rest);
    };
    expect(snapshot(first) === snapshot(second), 'deux exécutions identiques');
    expect(validateCandidate(input, first).length === 0, 'solution BLF valide');
    expect(first.method === 'nest-blf', 'méthode publiée');
  });

  checkFn('Étape 16 : au budget épuisé, la candidate shelf validée reste publiée', () => {
    const input = inputFor(200);
    const result = optimizePlacementBest(input, { timeBudgetMs: 1 });
    expect(validateCandidate(input, result).length === 0, 'repli shelf-ffd valide');
    expect(result.candidates !== undefined && result.candidates.length >= 1,
      'rapport des candidates présent même en repli');
    expect(result.candidates!.filter((candidate) => candidate.retained).length === 1,
      'une seule retenue en repli');
  });
}
