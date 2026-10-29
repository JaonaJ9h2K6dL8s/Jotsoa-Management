import { check, expect, expectClose } from './test-tools';
import type { OptimizerPiece } from '../src/lib/cutting/optimizer';
import {
  computeMetrics,
  optimizePlacement,
  wasteKg,
} from '../src/lib/cutting/optimizer';
import { polygonsConflict, insideRect } from '../src/lib/cutting/geometry';
import type { Point, Rect } from '../src/lib/cutting/types';

/**
 * Tests de l'optimiseur de placement (pur, sans base de données) :
 * pièces multiples, rotations et droit-fil, espacement, tissu
 * insuffisant, pièces non configurées, déterminisme, performances et
 * comparaison à un placement manuel de référence.
 */

function rect(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function piece(overrides: Partial<OptimizerPiece>): OptimizerPiece {
  return {
    id: 1,
    code: 'P1',
    label: 'Pièce 1',
    points: rect(0, 0, 50, 70),
    qty: 1,
    grainDirection: 'any',
    allowedRotations: [0, 90, 180, 270],
    status: 'configuree',
    ...overrides,
  };
}

const ZONE: Rect = { x: 0, y: 0, width: 170, height: 500 };

function assertValidPlacement(
  result: ReturnType<typeof optimizePlacement>,
  gap: number,
): void {
  const contours = result.placements.map((placement) => placement.points);
  for (const contour of contours) {
    expect(insideRect(contour, ZONE), 'chaque pièce reste dans la zone utilisable');
  }
  for (let i = 0; i < contours.length; i += 1) {
    for (let j = i + 1; j < contours.length; j += 1) {
      expect(
        polygonsConflict(contours[i], contours[j], gap) === false,
        `aucun chevauchement (gap ${gap}) entre pièces ${i} et ${j}`,
      );
    }
  }
}

export function runOptimizerTests(checkFn: typeof check): void {
  checkFn('Optimiseur : toutes les pièces d’un T-shirt sont placées sans conflit', () => {
    const pieces: OptimizerPiece[] = [
      piece({ id: 1, code: 'DEV', label: 'Devant', points: rect(0, 0, 54, 72) }),
      piece({ id: 2, code: 'DOS', label: 'Dos', points: rect(0, 0, 54, 72) }),
      piece({ id: 3, code: 'MAG', label: 'Manche gauche', points: rect(0, 0, 20, 24) }),
      piece({ id: 4, code: 'MAD', label: 'Manche droite', points: rect(0, 0, 20, 24) }),
      piece({ id: 5, code: 'COL', label: 'Col', points: rect(0, 0, 40, 5) }),
    ];
    const result = optimizePlacement({ usableWidthCm: 170, maxLengthCm: 500, gapCm: 1, pieces });
    expect(result.placements.length === 5, `5 pièces placées, reçu ${result.placements.length}`);
    expect(result.unplaced.length === 0, 'aucune pièce non placée');
    expect(result.metrics.placedCount === 5, 'compteur placées = 5');
    expect(result.metrics.unplacedCount === 0, 'compteur non placées = 0');
    assertValidPlacement(result, 1);
  });

  checkFn('Optimiseur : longueur consommée inférieure au placement manuel de référence', () => {
    const pieces: OptimizerPiece[] = [
      piece({ id: 1, code: 'DEV', points: rect(0, 0, 54, 72) }),
      piece({ id: 2, code: 'DOS', points: rect(0, 0, 54, 72) }),
      piece({ id: 3, code: 'MAG', points: rect(0, 0, 20, 24) }),
      piece({ id: 4, code: 'MAD', points: rect(0, 0, 20, 24) }),
      piece({ id: 5, code: 'COL', points: rect(0, 0, 40, 5) }),
    ];
    const optimized = optimizePlacement({ usableWidthCm: 170, maxLengthCm: 500, gapCm: 1, pieces });
    // Référence manuelle : pièces posées l'une sous l'autre (placement
    // naïf de référence, 71 cm par pièce).
    const manualLength = pieces.length * (70 + 1);
    expect(
      optimized.metrics.consumedLengthCm <= manualLength,
      `optimisé (${optimized.metrics.consumedLengthCm.toFixed(0)} cm) `
      + `≤ manuel naïf (${manualLength} cm)`,
    );
  });

  checkFn('Optimiseur : quantités multipliées (qty 3 → 3 instances)', () => {
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ code: 'MAG', points: rect(0, 0, 20, 24), qty: 3 })],
    });
    expect(result.placements.length === 3, `3 instances attendues, reçu ${result.placements.length}`);
    expect(result.metrics.placedCount === 3, 'compteur placées = 3');
    assertValidPlacement(result, 1);
  });

  checkFn('Optimiseur : rotation utilisée quand elle est autorisée (pièce plus large que le tissu)', () => {
    const result = optimizePlacement({
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ points: rect(0, 0, 60, 40), allowedRotations: [0, 90] })],
    });
    expect(result.placements.length === 1, 'pièce placée par rotation');
    expect(result.placements[0].rotation === 90, 'rotation choisie = 90°');
  });

  checkFn('Optimiseur : droit-fil respecté (rotation interdite → pièce non placée, motif largeur)', () => {
    const result = optimizePlacement({
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ points: rect(0, 0, 60, 40), grainDirection: 'along', allowedRotations: [0, 180] })],
    });
    expect(result.placements.length === 0, 'pièce refusée plutôt que mal orientée');
    expect(result.unplaced.length === 1, 'un motif de refus');
    expect(result.unplaced[0].reason.includes('Largeur'), 'motif = largeur du tissu insuffisante');
  });

  checkFn('Optimiseur : tissu sens unique (oneWay) restreint les rotations', () => {
    const result = optimizePlacement({
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1, oneWayFabric: true,
      pieces: [piece({ points: rect(0, 0, 60, 40), allowedRotations: [0, 90, 180, 270] })],
    });
    expect(result.placements.length === 0, 'aucun placement hors contrainte oneWay');
    expect(result.unplaced.length === 1, 'motif de refus fourni');
  });

  checkFn('Optimiseur : longueur de tissu insuffisante → pièces restantes motivées', () => {
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 100, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'A', points: rect(0, 0, 54, 72) }),
        piece({ id: 2, code: 'B', points: rect(0, 0, 54, 72) }),
        piece({ id: 3, code: 'C', points: rect(0, 0, 54, 72) }),
      ],
    });
    expect(result.placements.length > 0, 'au moins une pièce placée');
    expect(result.unplaced.length > 0, 'au moins une pièce non placée');
    expect(
      result.unplaced.some((item) => item.reason.includes('Longueur')),
      'motif = longueur insuffisante',
    );
    expect(
      result.metrics.placedCount + result.metrics.unplacedCount === 3,
      'compteurs cohérents (placées + non placées = 3)',
    );
    assertValidPlacement(result, 1);
  });

  checkFn('Optimiseur : pièces non configurées exclues de la coupe', () => {
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'OK', points: rect(0, 0, 50, 70) }),
        piece({ id: 2, code: 'KO', label: 'Col', status: 'incomplete', points: [], qty: 2 }),
      ],
    });
    expect(result.placements.length === 1, 'seule la pièce configurée est placée');
    expect(result.unplaced.length === 1, 'la pièce incomplète est restituée');
    expect(result.unplaced[0].quantity === 2, 'quantité non placée = 2');
    expect(result.unplaced[0].reason.includes('non configurée'), 'motif = non configurée');
    expect(result.metrics.unplacedCount === 2, 'compteur non placées = 2');
  });

  checkFn('Optimiseur : contour complexe (pièce en L) placé sans conflit', () => {
    const lShape: Point[] = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 15 }, { x: 15, y: 15 },
      { x: 15, y: 40 }, { x: 0, y: 40 },
    ];
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ points: lShape }), piece({ id: 2, code: 'L2', points: lShape })],
    });
    expect(result.placements.length === 2, '2 pièces en L placées');
    assertValidPlacement(result, 1);
  });

  checkFn('Optimiseur : espacement (gap) réellement réservé entre les pièces', () => {
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 5,
      pieces: [piece({ id: 1, code: 'A', points: rect(0, 0, 20, 24) }),
        piece({ id: 2, code: 'B', points: rect(0, 0, 20, 24) })],
    });
    assertValidPlacement(result, 5);
    expect(
      Math.abs(result.placements[1].x - (result.placements[0].x + 20)) >= 4.999,
      'distance horizontale ≥ gap (5 cm)',
    );
  });

  checkFn('Optimiseur : indicateurs (aires, chutes, taux) conformes aux formules', () => {
    const result = optimizePlacement({
      usableWidthCm: 100, maxLengthCm: 500, gapCm: 0,
      pieces: [piece({ points: rect(0, 0, 100, 50) })],
    });
    expectClose(result.metrics.piecesAreaM2, 0.5, 1e-9, 'surface pièces 0,5 m²');
    expectClose(result.metrics.consumedAreaM2, 0.5, 1e-9, 'surface consommée 0,5 m²');
    expectClose(result.metrics.wasteAreaM2, 0, 1e-9, 'aucune chute');
    expectClose(result.metrics.utilizationPct, 100, 1e-6, 'utilisation 100 %');
    const empty = computeMetrics([], 170);
    expect(empty.consumedLengthCm === 0, 'plan vide : longueur nulle');
    expect(empty.utilizationPct === 0, 'plan vide : taux nul (pas de division par zéro)');
  });

  checkFn('Optimiseur : pertes en kg seulement avec un grammage valide', () => {
    expectClose(wasteKg(1.2, 180) ?? -1, 0.216, 1e-9, '1,2 m² à 180 g/m² = 216 g');
    expect(wasteKg(1.2, null) === null, 'grammage inconnu → null');
    expect(wasteKg(1.2, 0) === null, 'grammage nul → null');
  });

  checkFn('Optimiseur : déterminisme (deux exécutions identiques)', () => {
    const pieces: OptimizerPiece[] = [
      piece({ id: 1, code: 'DEV', points: rect(0, 0, 54, 72) }),
      piece({ id: 2, code: 'DOS', points: rect(0, 0, 54, 72) }),
      piece({ id: 3, code: 'MAG', points: rect(0, 0, 20, 24), qty: 2 }),
      piece({ id: 4, code: 'COL', points: rect(0, 0, 40, 5) }),
    ];
    const first = optimizePlacement({ usableWidthCm: 170, maxLengthCm: 500, gapCm: 1, pieces });
    const second = optimizePlacement({ usableWidthCm: 170, maxLengthCm: 500, gapCm: 1, pieces });
    expect(
      JSON.stringify(first.placements) === JSON.stringify(second.placements),
      'placements identiques à l’exécution près',
    );
  });

  checkFn('Optimiseur : performance (60 pièces mélangées < 500 ms)', () => {
    const pieces: OptimizerPiece[] = [];
    for (let index = 0; index < 20; index += 1) {
      pieces.push(piece({ id: index + 1, code: `P${index}`, points: rect(0, 0, 40 + index, 60), qty: 3 }));
    }
    const started = Date.now();
    const result = optimizePlacement({ usableWidthCm: 170, maxLengthCm: 3000, gapCm: 1, pieces });
    const elapsed = Date.now() - started;
    expect(elapsed < 500, `calcul en ${elapsed} ms (< 500 ms)`);
    expect(result.metrics.placedCount === 60, '60 pièces placées');
  });
}
