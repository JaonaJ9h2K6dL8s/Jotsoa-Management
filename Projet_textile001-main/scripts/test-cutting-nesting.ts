import { check, expect, expectClose } from './test-tools';
import type { OptimizerInput, OptimizerPiece, OptimizerResult } from '../src/lib/cutting/optimizer';
import { optimizePlacement } from '../src/lib/cutting/optimizer';
import { nestPlacement } from '../src/lib/cutting/nesting';
import { optimizePlacementBest } from '../src/lib/cutting/best-placement';
import { improvePlacementLocal } from '../src/lib/cutting/local-improve';
import { insideRect, polygonsConflict, polygonsDistance } from '../src/lib/cutting/geometry';
import { buildFamilyPieces } from '../src/server/cutting/pattern-rules';
import type { Point, Rect } from '../src/lib/cutting/types';

/**
 * Tests du nesting BLF sur contours réels (étape 5) :
 * imbrication des espaces libres des pièces concaves, validité
 * géométrique exacte (chevauchements, gap, limites), droit-fil,
 * rotations, quantités, contours invalides, comparaison systématique
 * avec la référence shelf-ffd et performances (20/60/100 pièces).
 */

function rect(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
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

/** Pièce en L : barre 30×10 + pied 10×40 (creux exploitable 20×30). */
const L_SHAPE: Point[] = [
  { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 },
  { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 },
];

function assertLayoutValid(
  result: OptimizerResult,
  input: OptimizerInput,
  zone: Rect,
): void {
  for (const placement of result.placements) {
    expect(insideRect(placement.points, zone), `pièce ${placement.code} dans la zone`);
  }
  for (let i = 0; i < result.placements.length; i += 1) {
    for (let j = i + 1; j < result.placements.length; j += 1) {
      expect(
        !polygonsConflict(result.placements[i].points, result.placements[j].points, input.gapCm),
        `aucun conflit (gap ${input.gapCm}) entre placements ${i} et ${j}`,
      );
    }
  }
  const placedQty = result.placements.length;
  const unplacedQty = result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
  expect(placedQty + unplacedQty > 0, 'bilan placées + non placées cohérent');
}

function runNestingTests(checkFn: typeof check): void {
  const ZONE: Rect = { x: 0, y: 0, width: 170, height: 3000 };

  checkFn('Nesting BLF : imbrique une petite pièce dans le creux d’une pièce en L', () => {
    const input: OptimizerInput = {
      usableWidthCm: 31, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'L', label: 'Pièce L', points: L_SHAPE }),
        piece({ id: 2, code: 'S', label: 'Petite pièce', points: rect(0, 0, 18, 25) }),
      ],
    };
    const shelf = optimizePlacement(input);
    expect(shelf.metrics.consumedLengthCm > 45,
      `référence shelf : petite pièce hors du creux (${shelf.metrics.consumedLengthCm} cm)`);
    const nested = nestPlacement(input);
    expect(nested.method === 'nest-blf', 'méthode nest-blf annoncée');
    expect(nested.placements.length === 2, 'les deux pièces sont placées');
    expect(nested.metrics.consumedLengthCm <= 40 + 1e-6,
      `le creux du L est exploité (${nested.metrics.consumedLengthCm} cm ≤ 40 cm)`);
    const small = nested.placements.find((p) => p.code === 'S');
    expect(!!small && small.x > 10 && small.x < 30 && small.y > 0 && small.y < 20,
      'petite pièce positionnée dans le creux (x≈11, y≈11)');
    assertLayoutValid(nested, input, ZONE);
    const best = optimizePlacementBest(input);
    expect(best.method === 'nest-blf', 'la meilleure solution est le nesting');
    expect(best.metrics.consumedLengthCm <= 40 + 1e-6, 'meilleure solution = 40 cm');
  });

  checkFn('Nesting BLF : deux pièces en L imbriquées sans chevauchement', () => {
    const input: OptimizerInput = {
      usableWidthCm: 45, maxLengthCm: 200, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'L1', points: L_SHAPE }),
        piece({ id: 2, code: 'L2', points: L_SHAPE }),
      ],
    };
    const nested = nestPlacement(input);
    expect(nested.placements.length === 2, 'deux pièces L placées');
    assertLayoutValid(nested, input, { x: 0, y: 0, width: 45, height: 200 });
  });

  checkFn('Nesting BLF : léger chevauchement interdit, gap exact accepté', () => {
    // Deux rectangles dont l'un, décalé, chevaucherait de 0,5 cm si le
    // gap n'était pas respecté : la validation exacte doit l'empêcher.
    const input: OptimizerInput = {
      usableWidthCm: 60, maxLengthCm: 300, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'A', points: rect(0, 0, 30, 20) }),
        piece({ id: 2, code: 'B', points: rect(0, 0, 30, 20) }),
      ],
    };
    const nested = nestPlacement(input);
    assertLayoutValid(nested, input, { x: 0, y: 0, width: 60, height: 300 });
    if (nested.placements.length === 2) {
      const distance = polygonsDistance(
        nested.placements[0].points, nested.placements[1].points,
      );
      expect(distance >= input.gapCm - 1e-9, `distance ${distance.toFixed(3)} ≥ gap 1 cm`);
    }
  });

  checkFn('Nesting BLF : contours invalides ou dégénérés signalés', () => {
    const input: OptimizerInput = {
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'OK', points: rect(0, 0, 20, 20) }),
        piece({ id: 2, code: 'DEGEN', label: 'Dégénérée', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }] }),
        piece({ id: 3, code: 'NAN', label: 'Non numérique', points: [{ x: 0, y: 0 }, { x: NaN, y: 5 }, { x: 5, y: 5 }] }),
      ],
    };
    const nested = nestPlacement(input);
    expect(nested.placements.length === 1, 'seule la pièce valide est placée');
    const degenerated = nested.unplaced.filter((item) => item.code !== 'OK');
    expect(degenerated.length === 2, 'deux pièces refusées avec motif');
    expect(degenerated.every((item) => item.reason.includes('invalide')),
      'motif explicite : contour invalide ou dégénéré');
  });

  checkFn('Nesting BLF : droit-fil, rotation interdite et tissu sens unique', () => {
    const along: OptimizerInput = {
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ points: rect(0, 0, 60, 40), grainDirection: 'along', allowedRotations: [0, 180] })],
    };
    const nested = nestPlacement(along);
    expect(nested.placements.length === 0, 'pièce refusée plutôt que mal orientée');
    expect(nested.unplaced[0].reason.includes('Largeur'), 'motif = largeur insuffisante');
    const rotated: OptimizerInput = {
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1,
      pieces: [piece({ points: rect(0, 0, 60, 40), allowedRotations: [0, 90] })],
    };
    const rotatedResult = nestPlacement(rotated);
    expect(rotatedResult.placements[0]?.rotation === 90, 'rotation 90° utilisée');
    const oneWay: OptimizerInput = {
      usableWidthCm: 50, maxLengthCm: 500, gapCm: 1, oneWayFabric: true,
      pieces: [piece({ points: rect(0, 0, 60, 40), allowedRotations: [0, 90, 180, 270] })],
    };
    expect(nestPlacement(oneWay).placements.length === 0,
      'tissu sens unique : aucun placement hors contrainte');
  });

  checkFn('Nesting BLF : quantités, identité et pièces non configurées', () => {
    const input: OptimizerInput = {
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 7, code: 'MAG', label: 'Manche', points: rect(0, 0, 20, 24), qty: 3 }),
        piece({ id: 8, code: 'KO', label: 'Col', status: 'incomplete', points: [], qty: 2 }),
      ],
    };
    const nested = nestPlacement(input);
    expect(nested.placements.length === 3, '3 instances de la manche');
    expect(nested.placements.every((p) => p.pieceId === 7 && p.code === 'MAG'),
      'identité préservée sur chaque instance');
    expect(nested.unplaced.length === 1 && nested.unplaced[0].quantity === 2,
      'pièce non configurée restituée avec sa quantité');
    expect(nested.unplaced[0].reason.includes('non configurée'), 'motif explicite');
  });

  checkFn('Nesting BLF : meilleure solution jamais pire que la référence shelf', () => {
    const fixtures: OptimizerInput[] = [
      {
        usableWidthCm: 120, maxLengthCm: 400, gapCm: 1,
        pieces: Array.from({ length: 12 }, (_, index) => piece({
          id: index + 1,
          code: `R${index}`,
          points: rect(0, 0, 12 + ((index * 7) % 28), 15 + ((index * 11) % 45)),
        })),
      },
      {
        usableWidthCm: 60, maxLengthCm: 300, gapCm: 1,
        pieces: Array.from({ length: 6 }, (_, index) => piece({
          id: index + 1, code: `L${index}`, points: L_SHAPE,
        })),
      },
      {
        usableWidthCm: 100, maxLengthCm: 100, gapCm: 1,
        pieces: [piece({ code: 'BIG', points: rect(0, 0, 90, 120) })],
      },
    ];
    for (const input of fixtures) {
      const shelf = optimizePlacement(input);
      const best = optimizePlacementBest(input);
      const shelfUnplaced = shelf.unplaced.reduce((s, item) => s + item.quantity, 0);
      const bestUnplaced = best.unplaced.reduce((s, item) => s + item.quantity, 0);
      expect(bestUnplaced <= shelfUnplaced, 'jamais plus de pièces non placées que la référence');
      if (bestUnplaced === shelfUnplaced) {
        expect(best.metrics.consumedLengthCm <= shelf.metrics.consumedLengthCm + 1e-6,
          'longueur consommée ≤ référence à pièces placées égales');
      }
      assertLayoutValid(best, input, { x: 0, y: 0, width: input.usableWidthCm, height: input.maxLengthCm });
    }
  });

  checkFn('Nesting BLF : cas extrêmes (coordonnées négatives, très grandes)', () => {
    const offset: Point[] = L_SHAPE.map((point) => ({ x: point.x - 15, y: point.y - 20 }));
    const nested = nestPlacement({
      usableWidthCm: 40, maxLengthCm: 100, gapCm: 1,
      pieces: [piece({ code: 'OFF', points: offset })],
    });
    expect(nested.placements.length === 1, 'contour décalé normalisé puis placé');
    expectClose(nested.placements[0].x, 0, 1e-6, 'normalisé au bord gauche');
    const huge = nestPlacement({
      usableWidthCm: 100000, maxLengthCm: 1000000, gapCm: 1,
      pieces: [piece({ code: 'HUGE', points: rect(0, 0, 90000, 500000) })],
    });
    expect(huge.placements.length === 1, 'grandes coordonnées gérées sans débordement');
  });

  checkFn('Nesting BLF : performances et validité (20 / 60 / 100 / 200 pièces réelles)', () => {
    const tshirtMesures = {
      'Poitrine à plat': 54, 'Longueur totale': 72, 'Épaules': 46,
      'Longueur manche': 24, 'Ouverture manche': 20, 'Largeur bas': 54,
      'Encolure': 18, 'Hauteur col': 6,
    };
    const tshirt = buildFamilyPieces('tshirt', tshirtMesures)
      .filter((p) => p.points !== null)
      .map((p, index) => ({ id: index + 1, code: p.code, points: p.points as Point[] }));
    const scenarios = [4, 12, 20, 40];
    const timings: number[] = [];
    for (const sets of scenarios) {
      const pieces: OptimizerPiece[] = [];
      for (let copy = 0; copy < sets; copy += 1) {
        for (const base of tshirt) {
          pieces.push(piece({
            id: copy * 10 + base.id,
            code: `${base.code}-${copy}`,
            label: `${base.code} #${copy}`,
            points: base.points,
          }));
        }
      }
      const input: OptimizerInput = {
        usableWidthCm: 170, maxLengthCm: 3000, gapCm: 1, pieces,
      };
      const started = Date.now();
      const best = optimizePlacementBest(input);
      const elapsed = Date.now() - started;
      timings.push(elapsed);
      const totalQty = pieces.length;
      const placed = best.placements.length;
      expect(placed === totalQty,
        `${pieces.length} pièces placées (${placed} placées, `
        + `${best.unplaced.reduce((s, i) => s + i.quantity, 0)} non placées)`);
      assertLayoutValid(best, input, { x: 0, y: 0, width: 170, height: 3000 });
      expect(elapsed < 15000, `calcul en ${elapsed} ms (< 15 s, budget large)`);
    }
    expect(timings.length === 4, `temps mesurés : ${timings.join(' / ')} ms`);
  });

  checkFn('Amélioration locale : réinsère la petite pièce dans le creux du L', () => {
    const input: OptimizerInput = {
      usableWidthCm: 31, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'L', points: L_SHAPE }),
        piece({ id: 2, code: 'S', label: 'Petite pièce', points: rect(0, 0, 18, 25) }),
      ],
    };
    const shelf = optimizePlacement(input);
    expect(shelf.metrics.consumedLengthCm > 45,
      `référence shelf : petite pièce hors du creux (${shelf.metrics.consumedLengthCm} cm)`);
    const before = JSON.stringify(shelf.placements.map((p) => [p.pieceId, p.x, p.y, p.rotation]));
    const improved = improvePlacementLocal(shelf.placements, input, { timeBudgetMs: 1500 });
    const length = Math.max(0, ...improved.placements.map((p) => Math.max(...p.points.map((q) => q.y))));
    expect(length <= 40 + 1e-6, `creux du L exploité (${length} cm ≤ 40 cm)`);
    expect(improved.stats.movesAccepted >= 1, 'au moins un mouvement accepté');
    expect(improved.placements.length === shelf.placements.length
      && improved.placements.every((p, i) => p.pieceId === shelf.placements[i].pieceId),
    'identités et quantités préservées');
    expect(before === JSON.stringify(shelf.placements.map((p) => [p.pieceId, p.x, p.y, p.rotation])),
      'l’entrée n’est jamais mutée (copie défensive)');
    assertLayoutValid(
      { ...shelf, placements: improved.placements }, input,
      { x: 0, y: 0, width: 31, height: 500 },
    );
  });

  checkFn('Amélioration locale : ne dégrade jamais une solution valide', () => {
    const input: OptimizerInput = {
      usableWidthCm: 45, maxLengthCm: 200, gapCm: 1,
      pieces: Array.from({ length: 6 }, (_, index) => piece({
        id: index + 1, code: `L${index}`, points: L_SHAPE,
      })),
    };
    const nested = nestPlacement(input);
    const before = nested.metrics.consumedLengthCm;
    const improved = improvePlacementLocal(nested.placements, input, { timeBudgetMs: 1500 });
    const length = Math.max(0, ...improved.placements.map((p) => Math.max(...p.points.map((q) => q.y))));
    expect(length <= before + 1e-6,
      `longueur après amélioration ${length.toFixed(1)} ≤ avant ${before.toFixed(1)}`);
    assertLayoutValid(
      { ...nested, placements: improved.placements }, input,
      { x: 0, y: 0, width: 45, height: 200 },
    );
  });

  checkFn('Amélioration locale : budget épuisé → solution initiale intacte', () => {
    const input: OptimizerInput = {
      usableWidthCm: 170, maxLengthCm: 3000, gapCm: 1,
      pieces: Array.from({ length: 10 }, (_, index) => piece({
        id: index + 1, code: `R${index}`,
        points: rect(0, 0, 20 + ((index * 17) % 50), 30 + ((index * 23) % 40)),
      })),
    };
    const shelf = optimizePlacement(input);
    const snapshot = JSON.stringify(shelf.placements);
    const improved = improvePlacementLocal(shelf.placements, input, { timeBudgetMs: 0 });
    expect(improved.stats.expired, 'amélioration interrompue par le budget');
    expect(JSON.stringify(improved.placements) === snapshot,
      'aucun mouvement publié après interruption immédiate');
    assertLayoutValid(
      { ...shelf, placements: improved.placements }, input,
      { x: 0, y: 0, width: 170, height: 3000 },
    );
  });

  checkFn('Amélioration locale : passes bornées, aucun cycle infini', () => {
    const input: OptimizerInput = {
      usableWidthCm: 170, maxLengthCm: 3000, gapCm: 1,
      pieces: Array.from({ length: 12 }, (_, index) => piece({
        id: index + 1, code: `M${index}`,
        points: index % 2 === 0 ? L_SHAPE : rect(0, 0, 18 + ((index * 7) % 30), 25 + ((index * 11) % 35)),
      })),
    };
    const shelf = optimizePlacement(input);
    const started = Date.now();
    const improved = improvePlacementLocal(shelf.placements, input, {
      timeBudgetMs: 2000, maxMoves: 30, maxPasses: 2,
    });
    expect(Date.now() - started < 5000, 'la phase d’amélioration se termine');
    expect(improved.stats.movesAccepted <= 30, 'limite de mouvements respectée');
    expect(improved.stats.passes <= 2, 'limite de passes respectée');
    assertLayoutValid(
      { ...shelf, placements: improved.placements }, input,
      { x: 0, y: 0, width: 170, height: 3000 },
    );
  });

  checkFn('Best-of étape 6 : méthode, temps, compteurs et budget exposés', () => {
    const input: OptimizerInput = {
      usableWidthCm: 31, maxLengthCm: 500, gapCm: 1,
      pieces: [
        piece({ id: 1, code: 'L', points: L_SHAPE }),
        piece({ id: 2, code: 'S', points: rect(0, 0, 18, 25) }),
      ],
    };
    const best = optimizePlacementBest(input);
    expect(best.computeMs !== undefined && best.computeMs >= 0, 'temps de calcul mesuré');
    expect(best.stats !== undefined, 'compteurs de recherche exposés');
    expect(best.improve !== undefined, 'statistiques d’amélioration exposées');
    expect(typeof best.improve?.movesAccepted === 'number', 'nombre de mouvements disponible');
    expect(best.metrics.consumedLengthCm <= 40 + 1e-6, 'meilleure solution = 40 cm');
    assertLayoutValid(best, input, { x: 0, y: 0, width: 31, height: 500 });
  });
}

const alreadyRun = { done: false };
export function runNestingTestSuite(checkFn: typeof check): void {
  if (alreadyRun.done) return;
  alreadyRun.done = true;
  runNestingTests(checkFn);
}
