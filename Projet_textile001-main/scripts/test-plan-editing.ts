/**
 * Tests des helpers purs d'édition interactive du plan (étape 8).
 * Exécution : npm run test:coupe-plan-editing
 * Couvre : rotations autorisées (droit-fil + sens unique), points
 * candidats (rotation + retrait), détection des positions invalides
 * (limites, marge, chevauchement, zone interdite, rotation interdite),
 * accrochage aux bords et aux pièces, empreinte automatique/manual.
 * Fonctionne hors ligne, sans base de données.
 */

import { check, expect, testPassed } from './workflow-test-tools';
import { candidatePoints, layoutSignature, placementIssue, rotationChoices, snapPosition, type PlacementContext } from '../src/lib/plan-editing';
import type { NestingPlacement } from '../src/server/coupe/nesting';
import type { PatternPiece } from '../src/server/coupe/patterns';

const CTX: PlacementContext = { widthCm: 160, lengthCm: 700, marginCm: 1, gapCm: 0.5, oneWay: false, scaleX: 1, scaleY: 1, defects: [] };

function pattern(overrides: Partial<PatternPiece> = {}): PatternPiece {
  return { id: 1, productId: 10, category: 'adulte', pieceCode: 'DEVANT', pieceLabel: 'Devant', sizeId: 3, sizeNom: 'M',
    version: '1', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 70 }, { x: 0, y: 70 }], widthCm: 50, heightCm: 70,
    qtyMultiplier: 1, grainDirection: 'along', allowedRotations: [0, 180], seamAllowanceCm: 1, isValidated: true, notes: null,
    revisionId: 5, component: 'principal', seamIncluded: true, marks: [], ...overrides };
}

function placement(overrides: Partial<NestingPlacement> = {}): NestingPlacement {
  const base = { patternId: 1, pieceCode: 'DEVANT', pieceLabel: 'Devant', sizeId: 3, sizeNom: 'M',
    x: 1, y: 1, widthCm: 50, heightCm: 70, rotation: 0,
    points: [{ x: 1, y: 1 }, { x: 51, y: 1 }, { x: 51, y: 71 }, { x: 1, y: 71 }], ...overrides };
  return base as NestingPlacement;
}

function main(): void {
  check('Rotations autorisées : droit-fil longitudinal + sens unique → 0° seul', () => {
    expect(JSON.stringify(rotationChoices(pattern(), CTX)) === '[0,180]', 'droit-fil along');
    expect(JSON.stringify(rotationChoices(pattern(), { ...CTX, oneWay: true })) === '[0]', 'sens unique');
    expect(JSON.stringify(rotationChoices(pattern({ grainDirection: 'cross', allowedRotations: [0, 90, 270] }), CTX)) === '[90,270]', 'cross');
  });
  check('Points candidats : rotation 180° normalisée à l’origine du contour', () => {
    const rotated = candidatePoints(pattern(), 0, 0, 180, CTX);
    const minX = Math.min(...rotated.map((point) => point.x));
    expect(minX === 0, 'contour normalisé : minX = 0');
    expect(rotated.length === 4, '4 sommets conservés (aucune déformation)');
  });
  check('Position valide : aucun problème détecté', () => {
    expect(placementIssue(placement(), [], pattern(), 0, CTX) === null, 'placement seul');
    const far = placement({ x: 60, y: 1, points: [{ x: 60, y: 1 }, { x: 110, y: 1 }, { x: 110, y: 71 }, { x: 60, y: 71 }] });
    expect(placementIssue(placement(), [far], pattern(), 0, CTX) === null, 'pièce voisine distincte');
  });
  check('Chevauchement détecté en temps réel', () => {
    const overlap = placement({ x: 10, y: 10, points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 80 }, { x: 10, y: 80 }] });
    const issue = placementIssue(overlap, [placement()], pattern(), 0, CTX);
    expect(issue?.includes('chevauchement') === true, `message reçu : ${issue}`);
  });
  check('Espacement inférieur au gap détecté', () => {
    const close = placement({ x: 51.2, y: 1, points: [{ x: 51.2, y: 1 }, { x: 101.2, y: 1 }, { x: 101.2, y: 71 }, { x: 51.2, y: 71 }] });
    const issue = placementIssue(close, [placement()], pattern(), 0, CTX);
    expect(issue?.includes('chevauchement') === true, `message reçu : ${issue}`);
    const exact = placement({ x: 51.5, y: 1, points: [{ x: 51.5, y: 1 }, { x: 101.5, y: 1 }, { x: 101.5, y: 71 }, { x: 51.5, y: 71 }] });
    expect(placementIssue(exact, [placement()], pattern(), 0, CTX) === null, 'égal au gap : valide');
  });
  check('Dépassement de la zone utilisable et de la marge détectés', () => {
    const out = placement({ x: 120, y: 660, points: [{ x: 120, y: 660 }, { x: 170, y: 660 }, { x: 170, y: 730 }, { x: 120, y: 730 }] });
    const issue = placementIssue(out, [], pattern(), 0, CTX);
    expect(issue?.includes('hors du tissu') === true, `message reçu : ${issue}`);
    const margin = placement({ x: 0.5, y: 1, points: [{ x: 0.5, y: 1 }, { x: 50.5, y: 1 }, { x: 50.5, y: 71 }, { x: 0.5, y: 71 }] });
    expect(placementIssue(margin, [], pattern(), 0, CTX)?.includes('marge') === true, 'marge de sécurité');
  });
  check('Rotation non autorisée refusée (90° sur droit-fil along)', () => {
    const rotated = placement({ rotation: 90, points: [{ x: 1, y: 1 }, { x: 71, y: 1 }, { x: 71, y: 51 }, { x: 1, y: 51 }] });
    const issue = placementIssue(rotated, [], pattern(), 90, CTX);
    expect(issue?.includes('non autorisée') === true, `message reçu : ${issue}`);
  });
  check('Zone interdite (défaut tissu) détectée', () => {
    const ctx = { ...CTX, defects: [{ x: 10, y: 10, widthCm: 20, heightCm: 20, label: 'Trou' }] };
    const issue = placementIssue(placement(), [], pattern(), 0, ctx);
    expect(issue?.includes('zone interdite') === true, `message reçu : ${issue}`);
  });
  check('Accrochage : bord gauche, pièce voisine, et hors portée', () => {
    const snappedEdge = snapPosition(2.1, 5, 50, 70, [], CTX);
    expect(Math.abs(snappedEdge.x - 1) < 1e-9, `bord gauche attendu, reçu ${snappedEdge.x}`);
    expect(snappedEdge.y === 5, 'Y non accroché reste libre');
    const neighbor = placement({ x: 40, y: 100, points: [{ x: 40, y: 100 }, { x: 90, y: 100 }, { x: 90, y: 170 }, { x: 40, y: 170 }] });
    const snappedNeighbor = snapPosition(91, 5, 50, 70, [neighbor], CTX);
    expect(Math.abs(snappedNeighbor.x - (90 + 0.5)) < 1e-9, `côté droit du voisin attendu, reçu ${snappedNeighbor.x}`);
    const notSnapped = snapPosition(60, 5, 50, 70, [neighbor], CTX);
    expect(notSnapped.x === 60, 'voisin trop loin : aucun accrochage forcé');
    const free = snapPosition(30, 300, 50, 70, [], CTX);
    expect(free.x === 30 && free.y === 300, 'loin de tout repère : position inchangée');
  });
  check('Empreinte : distingue placement automatique et ajusté manuellement', () => {
    const auto = [placement()];
    expect(layoutSignature(auto) === layoutSignature([placement()]), 'même placement : même empreinte');
    expect(layoutSignature(auto) !== layoutSignature([placement({ x: 12.5 })]), 'déplacement : empreinte différente');
    expect(layoutSignature(auto) !== layoutSignature([placement({ rotation: 180 })]), 'rotation : empreinte différente');
  });
  console.log(`\n${testPassed()} test(s) d’édition du plan réussi(s).`);
}

main();
