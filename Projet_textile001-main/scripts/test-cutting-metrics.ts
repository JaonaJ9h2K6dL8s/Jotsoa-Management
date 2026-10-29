/**
 * Tests des métriques et quantités automatiques (étape 7).
 * Exécution : npm run test:cutting (suite agrégée) ou
 * npx tsx scripts/test-cutting-metrics.ts
 * Couverture : formules et conversions d'unités (cm, cm², m²), taux
 * d'utilisation et taux de perte, recalcul après déplacement et
 * rotation, placement vide, pertes en kg selon le grammage,
 * quantités attendues/placées/valides/manquantes par pièce, pièces
 * incomplètes non coupables. Hors ligne, sans base de données.
 */

import { check, expect, expectClose, testPassed } from './test-tools';
import { computeMetrics, wasteKg } from '../src/lib/cutting/optimizer';
import {
  placedAreaM2, summarizePlacement, wastePctOf,
  type ExpectedPiece,
} from '../src/lib/cutting/metrics';
import { transformContour } from '../src/lib/cutting/geometry';
import type { Point } from '../src/lib/cutting/types';

function rect(x: number, y: number, width: number, height: number): Point[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

/** Cas de référence : deux rectangles 50×70 posés à y=0 et y=71 (gap 1). */
const BASE_CONTOURS: Point[][] = [
  rect(0, 0, 50, 70),
  rect(0, 71, 50, 70),
];

export function runMetricsTestSuite(): void {
  console.log('--- Métriques et quantités automatiques (étape 7) ---');

  check('Formules : longueur, surfaces et taux sur le cas de référence', () => {
    const metrics = computeMetrics(BASE_CONTOURS, 170);
    expectClose(metrics.consumedLengthCm, 141, 1e-9, 'longueur occupée');
    expectClose(metrics.consumedAreaM2, (170 * 141) / 10000, 1e-9, 'surface consommée');
    expectClose(metrics.piecesAreaM2, 0.7, 1e-9, 'surface pièces');
    expectClose(metrics.wasteAreaM2, (170 * 141) / 10000 - 0.7, 1e-9, 'chutes');
    const expectedUtilization = (0.7 / ((170 * 141) / 10000)) * 100;
    expectClose(metrics.utilizationPct, expectedUtilization, 1e-9, 'taux d’utilisation');
    expectClose(wastePctOf(metrics), 100 - expectedUtilization, 1e-9, 'taux de perte');
  });

  check('Conversions : cm² → m² exacts (pas de mélange d’unités)', () => {
    const metrics = computeMetrics([rect(0, 0, 100, 100)], 100);
    expectClose(metrics.consumedLengthCm, 100, 1e-9, 'longueur');
    expectClose(metrics.consumedAreaM2, 1, 1e-9, '1 m² consommé');
    expectClose(metrics.piecesAreaM2, 1, 1e-9, '1 m² de pièces');
    expectClose(metrics.utilizationPct, 100, 1e-9, '100 % utilisé');
    expectClose(wastePctOf(metrics), 0, 1e-9, '0 % de perte');
  });

  check('Placement vide : indicateurs nuls, aucune division par zéro', () => {
    const metrics = computeMetrics([], 170);
    expectClose(metrics.consumedLengthCm, 0, 1e-9, 'longueur');
    expectClose(metrics.consumedAreaM2, 0, 1e-9, 'surface');
    expectClose(metrics.utilizationPct, 0, 1e-9, 'taux');
    expectClose(wastePctOf(metrics), 0, 1e-9, 'perte');
    expect(metrics.placedCount === 0, 'aucune pièce placée');
  });

  check('Recalcul après déplacement : la longueur suit les coordonnées réelles', () => {
    const before = computeMetrics(BASE_CONTOURS, 170);
    const moved = BASE_CONTOURS.map((contour, index) => (index === 1
      ? contour.map((point) => ({ x: point.x + 20, y: point.y + 30 }))
      : contour));
    const after = computeMetrics(moved, 170);
    expectClose(after.consumedLengthCm, 141 + 30, 1e-9, 'longueur après translation');
    expectClose(after.piecesAreaM2, before.piecesAreaM2, 1e-9, 'surface des pièces inchangée');
    expectClose(after.utilizationPct,
      (before.piecesAreaM2 / ((170 * 171) / 10000)) * 100, 1e-9, 'taux recalculé');
  });

  check('Recalcul après rotation : aire invariante, emprise modifiée', () => {
    const wide = rect(0, 0, 50, 70);
    const rotated = transformContour(wide, 90, 0, 0);
    const metrics = computeMetrics([rotated], 170);
    expectClose(metrics.piecesAreaM2, 0.35, 1e-9, 'aire invariante par rotation');
    expectClose(metrics.consumedLengthCm, 50, 1e-9, 'emprise verticale après 90°');
  });

  check('Pertes en kg : chutes (m²) × grammage ÷ 1000, indisponible sinon', () => {
    expectClose(wasteKg(1.697, 180) as number, (1.697 * 180) / 1000, 1e-9, 'kg estimés');
    expect(wasteKg(1.697, null) === null, 'grammage absent → indisponible');
    expect(wasteKg(1.697, 0) === null, 'grammage invalide → indisponible');
    expect(wasteKg(1.697, -5) === null, 'grammage négatif → indisponible');
  });

  check('placedAreaM2 : somme des aires exactes des contours placés', () => {
    expectClose(placedAreaM2(BASE_CONTOURS), 0.7, 1e-9, 'somme m²');
    expectClose(placedAreaM2([[{ x: 0, y: 0 }, { x: 5, y: 0 }]]), 0, 1e-9, 'contour dégénéré ignoré');
  });

  check('Quantités : attendues / placées / valides / manquantes par pièce', () => {
    const expected: ExpectedPiece[] = [
      { pieceId: 1, code: 'devant', label: 'Devant', component: 'devant', qty: 2, status: 'configuree' },
      { pieceId: 2, code: 'manche', label: 'Manche gauche', component: 'manche', qty: 1, status: 'configuree' },
      { pieceId: 3, code: 'col', label: 'Col', component: 'col', qty: 1, status: 'incomplete' },
    ];
    const placedCounts = new Map([[1, 2], [2, 1], [3, 1]]);
    const summary = summarizePlacement(expected, placedCounts, new Map());
    expect(summary.rows.length === 3, 'une ligne par pièce');
    expectClose(summary.model.expected, 3, 0, 'attendues (incomplète exclue)');
    expectClose(summary.model.placed, 4, 0, 'placées (tout le canvas)');
    expectClose(summary.model.valid, 4, 0, 'valides sans violation');
    expectClose(summary.model.missing, 0, 0, 'manquantes');
    expect(summary.readyForTransfer, 'complète et valide → prête pour le transfert');
    const col = summary.rows.find((row) => row.pieceId === 3);
    expect(col?.expected === 0 && col?.placed === 1,
      'pièce à configurer : attendues 0, placée comptée séparément');
  });

  check('Quantités : pièces manquantes, invalides et surplus identifiables', () => {
    const expected: ExpectedPiece[] = [
      { pieceId: 1, code: 'devant', label: 'Devant', component: 'devant', qty: 3, status: 'configuree' },
      { pieceId: 2, code: 'dos', label: 'Dos', component: 'dos', qty: 2, status: 'configuree' },
    ];
    const placedCounts = new Map([[1, 2], [2, 3]]);
    const summary = summarizePlacement(expected, placedCounts, new Map([[2, 1]]));
    const devant = summary.rows.find((row) => row.pieceId === 1);
    const dos = summary.rows.find((row) => row.pieceId === 2);
    expect(devant?.missing === 1 && devant?.placed === 2 && devant?.valid === 2,
      'devant : 2 placées, 1 manquante');
    expect(dos?.placed === 3 && dos?.missing === 0 && dos?.valid === 2 && dos?.invalid === 1,
      'dos : surplus placé, 1 invalide détectée');
    expect(!summary.readyForTransfer, 'manquante + invalide → transfert bloqué');
    expectClose(summary.model.missing, 1, 0, 'total manquantes');
    expectClose(summary.model.invalid, 1, 0, 'total invalides');
  });

  check('Aucun champ de saisie : les métriques dérivent du placement seul', () => {
    // Deux appels avec les mêmes contours et largeurs donnent
    // strictement le même résultat (aucune donnée saisie en entrée).
    const first = computeMetrics(BASE_CONTOURS, 170, 2, 1);
    const second = computeMetrics(BASE_CONTOURS, 170, 2, 1);
    expect(JSON.stringify(first) === JSON.stringify(second), 'déterministe, sans entrée manuelle');
  });
}

function main(): void {
  runMetricsTestSuite();
  console.log(testPassed());
}

if (process.argv[1]?.endsWith('test-cutting-metrics.ts')) {
  main();
}
