/**
 * Tests géométriques du module Coupe reconstruit (étape 1).
 * Exécution : npm run test:cutting
 * Couverture : enveloppes, rotations exactes 90/180/270, normalisation
 * des contours placés, aires, inclusion de point, conflits entre
 * pièces (contact, chevauchement, contenu, marge entre pièces), limites
 * de zone, rotations permises selon le droit-fil, accrochage.
 * Fonctionne hors ligne, sans base de données.
 */

import { check, expect, expectClose, testPassed } from './test-tools';
import { runCuttingServiceTests } from './test-cutting-services';
import { runCuttingPlanTests } from './test-cutting-plan';
import { runCuttingTransferTests } from './test-cutting-transfer';
import { runCuttingAuditTests } from './test-cutting-audit';
import { runCuttingRemetricsTests } from './test-cutting-remetrics';
import { runCuttingDonneesTests } from './test-cutting-donnees';
import { runCuttingRollOpsTests } from './test-cutting-roll-ops';
import { runCuttingShapesTests } from './test-cutting-shapes';
import { runCuttingContourTests } from './test-cutting-contours';
import { runCuttingCoherenceTests } from './test-cutting-coherence';
import { runOptimizerTests } from './test-cutting-optimizer';
import { runNestingTestSuite } from './test-cutting-nesting';
import { runMetricsTestSuite } from './test-cutting-metrics';
import { runCuttingStep15Tests } from './test-cutting-step15';
import { runCuttingStep16Tests } from './test-cutting-step16';
import { runCuttingStep17Tests } from './test-cutting-step17';
import { runCuttingStep18Tests } from './test-cutting-step18';
import { runCuttingWeightV2Tests } from './test-cutting-weight-v2';
import { runCuttingOrdnurTests } from './test-cutting-ordnur';
import { runCuttingMeasurementTests } from './test-cutting-measurements';
import { runCuttingPatternDemoTests } from './test-cutting-pattern-demo';
import {
  buildFamilyPieces,
  isFamilyReady,
} from '../src/server/cutting/pattern-rules';
import {
  bounds,
  grainPermittedRotations,
  insideRect,
  pointInPolygon,
  polygonArea,
  polygonsConflict,
  polygonsDistance,
  polygonsIntersect,
  rotatePoint,
  snap,
  snapPosition,
  transformContour,
} from '../src/lib/cutting/geometry';
import type { Point, Rotation } from '../src/lib/cutting/types';

function rect(x: number, y: number, width: number, height: number): Point[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

/** Pièce en L (barre 3×1 + pied 1×2, aire 5 cm²). */
const L_SHAPE: Point[] = [
  { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 },
  { x: 1, y: 3 }, { x: 0, y: 3 },
];

function main(): void {
  check('bounds : enveloppe exacte d\'une pièce en L', () => {
    const box = bounds(L_SHAPE);
    expectClose(box.minX, 0, 1e-9, 'minX');
    expectClose(box.minY, 0, 1e-9, 'minY');
    expectClose(box.maxX, 3, 1e-9, 'maxX');
    expectClose(box.maxY, 3, 1e-9, 'maxY');
  });

  check('rotatePoint : rotations 90/180/270 exactes (aucune approximation)', () => {
    const point = { x: 2, y: 5 };
    expectClose(rotatePoint(point, 90).x, -5, 1e-9, '90° x');
    expectClose(rotatePoint(point, 90).y, 2, 1e-9, '90° y');
    expectClose(rotatePoint(point, 180).x, -2, 1e-9, '180° x');
    expectClose(rotatePoint(point, 180).y, -5, 1e-9, '180° y');
    expectClose(rotatePoint(point, 270).x, 5, 1e-9, '270° x');
    expectClose(rotatePoint(point, 270).y, -2, 1e-9, '270° y');
    expectClose(rotatePoint(point, 0).x, 2, 1e-9, '0° x');
  });

  check('transformContour : le coin supérieur gauche tourné tombe sur (x,y)', () => {
    const placed = transformContour(rect(0, 0, 4, 2), 90, 10, 7);
    const box = bounds(placed);
    expectClose(box.minX, 10, 1e-9, 'minX');
    expectClose(box.minY, 7, 1e-9, 'minY');
    expectClose(box.maxX - box.minX, 2, 1e-9, 'largeur tournée');
    expectClose(box.maxY - box.minY, 4, 1e-9, 'hauteur tournée');
    expect(placed.length === 4, '4 sommets conservés : aucune déformation');
  });

  check('polygonArea : rectangle et pièce en L', () => {
    expectClose(polygonArea(rect(0, 0, 4, 3)), 12, 1e-9, 'rectangle 4×3');
    expectClose(polygonArea(L_SHAPE), 5, 1e-9, 'pièce en L 5 cm²');
  });

  check('pointInPolygon : intérieur, extérieur et bord convexe/concave', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, L_SHAPE), 'point dans le pied du L');
    expect(!pointInPolygon({ x: 2, y: 2 }, L_SHAPE), 'creux du L : extérieur');
    expect(pointInPolygon({ x: 2, y: 0.5 }, rect(0, 0, 4, 3)), 'dans le rectangle');
    expect(!pointInPolygon({ x: 4.1, y: 1 }, rect(0, 0, 4, 3)), 'hors du rectangle');
  });

  check('polygonsIntersect : croisement, contact de bord et contenu', () => {
    expect(polygonsIntersect(rect(0, 0, 4, 4), rect(3, 1, 4, 4)), 'chevauchement partiel');
    expect(polygonsIntersect(rect(0, 0, 4, 4), rect(4, 0, 2, 2)), 'contact par un bord');
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(2, 2, 2, 2)), 'pièce contenue');
    expect(!polygonsIntersect(rect(0, 0, 4, 4), rect(5, 5, 2, 2)), 'disjointes');
  });

  check('polygonsDistance : 0 au contact, distance réelle sinon', () => {
    expectClose(polygonsDistance(rect(0, 0, 4, 4), rect(4, 0, 2, 2)), 0, 1e-9, 'contact');
    expectClose(polygonsDistance(rect(0, 0, 4, 4), rect(5.5, 0, 2, 2)), 1.5, 1e-9, 'écart horizontal');
  });

  check('polygonsConflict : marge entre pièces respectée ou violée', () => {
    expect(polygonsConflict(rect(0, 0, 4, 4), rect(3, 1, 4, 4), 0.5), 'chevauchement : conflit');
    expect(!polygonsConflict(rect(0, 0, 4, 4), rect(4.5, 0, 2, 2), 0.5), 'écart 0,5 = gap exact : accepté');
    expect(polygonsConflict(rect(0, 0, 4, 4), rect(4.4, 0, 2, 2), 0.5), 'écart 0,4 < gap : conflit');
    expect(polygonsConflict(rect(0, 0, 4, 4), rect(4, 0, 2, 2), 0), 'contact avec gap 0 : conflit');
    expect(!polygonsConflict(rect(0, 0, 4, 4), rect(5, 5, 2, 2), 0.5), 'suffisamment éloignées');
  });

  check('insideRect : zone utilisable du tissu respectée ou dépassée', () => {
    const zone = { x: 1, y: 1, width: 160, height: 700 };
    expect(insideRect(rect(1, 1, 50, 70), zone), 'collée aux bords : valide');
    expect(!insideRect(rect(0.5, 1, 50, 70), zone), 'déborde à gauche');
    expect(!insideRect(rect(1, 690, 50, 70), zone), 'déborde en bas (longueur)');
    expect(insideRect(rect(1 - 5e-7, 1, 50, 70), zone), 'écart inférieur à la tolérance : accepté');
  });

  check('grainPermittedRotations : droit-fil et tissu sens unique', () => {
    expect(JSON.stringify(grainPermittedRotations('along', [0, 90, 180])) === '[0,180]', 'along → 0/180');
    expect(JSON.stringify(grainPermittedRotations('cross', [0, 90, 270])) === '[90,270]', 'cross → 90/270');
    expect(JSON.stringify(grainPermittedRotations('any', [90])) === '[90]', 'any restreint par le patron');
    expect(JSON.stringify(grainPermittedRotations('along', [0, 180], true)) === '[0]', 'sens unique → 0 seul');
    expect(JSON.stringify(grainPermittedRotations('any', [0, 180], true)) === '[0]', 'any + sens unique → 0');
  });

  check('snap : accrochage sous le seuil uniquement', () => {
    expectClose(snap(2.1, [1, 55], 1.2), 1, 1e-9, 'bord gauche accroché');
    expectClose(snap(30, [1, 55], 1.2), 30, 1e-9, 'aucune cible à portée : inchangé');
    expectClose(snap(54.2, [1, 55], 1.2), 55, 1e-9, 'cible droite accrochée');
  });

  check('snapPosition : accroche X et Y indépendamment', () => {
    const snapped = snapPosition(2.1, 400.05, [1, 100], [1, 400], 1.2);
    expectClose(snapped.x, 1, 1e-9, 'X accroché');
    expectClose(snapped.y, 400, 1e-9, 'Y accroché');
    const libre = snapPosition(50, 50, [1, 100], [1, 400], 1.2);
    expectClose(libre.x, 50, 1e-9, 'X libre');
    expectClose(libre.y, 50, 1e-9, 'Y libre');
  });

  check('Enchaînement réaliste : rotation 180° puis placement normalisé', () => {
    // Pièce en L tournée à 180° : l'enveloppe reste 3×3, le creux change de côté.
    const placed = transformContour(L_SHAPE, 180 as Rotation, 10, 10);
    const box = bounds(placed);
    expectClose(box.minX, 10, 1e-9, 'minX');
    expectClose(box.minY, 10, 1e-9, 'minY');
    expectClose(polygonArea(placed), 5, 1e-9, 'aire conservée');
    expect(pointInPolygon({ x: 10.5, y: 12.5 }, placed), 'creux du L déplacé après rotation');
    expect(!polygonsConflict(placed, transformContour(L_SHAPE, 0, 14, 10), 0.5), 'voisine à 1 cm : acceptable au gap 0,5');
  });

  // Patrons R2 : contours vectoriels réalistes (pur, sans base).
  check('Patrons R2 : devant/dos avec encolure et emmanchures courbes', () => {
    const pieces = buildFamilyPieces('tshirt', {
      'Poitrine à plat': 54, 'Longueur totale': 72, 'Épaules': 46,
      'Longueur manche': 24, 'Ouverture manche': 20, 'Largeur bas': 54,
      'Encolure': 18, 'Hauteur col': 6,
    });
    const devant = pieces.find((piece) => piece.code === 'devant');
    expect(!!devant && devant.points !== null && devant.points.length > 4,
      'devant : contour courbe (plus de 4 sommets)');
    const box = bounds(devant?.points ?? []);
    expectClose(box.maxX - box.minX, devant?.widthCm ?? 0, 1e-9, 'largeur = mesure de coupe');
    expectClose(box.maxY - box.minY, devant?.heightCm ?? 0, 1e-9, 'hauteur = mesure de coupe');
    expect((devant?.points ?? []).some((p) => p.y > 1 && p.y < 10),
      'encolure creusée sous la ligne d’épaule');
    const dos = pieces.find((piece) => piece.code === 'dos');
    // Zone d'encolure uniquement (les emmanchures sont confinées aux bords).
    const neckDip = (pts: Point[]): number => {
      const neck = pts.filter((p) => p.x > 10 && p.x < 46 && p.y > 0.05);
      return neck.length ? Math.max(...neck.map((p) => p.y)) : 0;
    };
    expect(neckDip(dos?.points ?? []) < neckDip(devant?.points ?? []),
      'encolure du dos moins creusée que le devant');
  });

  check('Patrons R2 : calotte de manche, col incurvé, fourche de jambe', () => {
    const tshirt = buildFamilyPieces('tshirt', {
      'Poitrine à plat': 54, 'Longueur totale': 72, 'Épaules': 46,
      'Longueur manche': 24, 'Ouverture manche': 20, 'Largeur bas': 54,
      'Encolure': 18, 'Hauteur col': 6,
    });
    const manche = tshirt.find((piece) => piece.code === 'manche_gauche');
    const manchePts = manche?.points ?? [];
    const capApex = manchePts.filter((p) => p.y === 0);
    expect(capApex.length > 0 && manchePts.some((p) => p.y > 4),
      'manche : calotte courbe au-dessus des aisselles');
    const col = tshirt.find((piece) => piece.code === 'col');
    const colPts = col?.points ?? [];
    expect(colPts.length > 4 && colPts.some((p) => p.y > 0.5),
      'col : bande incurvée (pas un rectangle)');
    const short = buildFamilyPieces('short', {
      'Hanches': 50, 'Longueur extérieure': 40, 'Taille détendue': 40, 'Hauteur ceinture': 4,
    });
    const jambe = short.find((piece) => piece.code === 'devant_gauche');
    const jambePts = jambe?.points ?? [];
    const crotch = jambePts.filter((p) => p.y > 5 && p.y < 20 && p.x > 1 && p.x < 30);
    expect(jambePts.length > 4 && crotch.length > 0,
      'jambe de short : fourche concave présente');
    const jogging = buildFamilyPieces('jogging', {
      'Hanches': 50, 'Longueur extérieure': 100, 'Taille détendue': 40, 'Hauteur ceinture': 4,
    });
    const hem = (pieceCode: string, family: ReturnType<typeof buildFamilyPieces>): number => {
      const pts = family.find((piece) => piece.code === pieceCode)?.points ?? [];
      const bottom = Math.max(...pts.map((p) => p.y));
      const bottomPts = pts.filter((p) => p.y === bottom);
      return Math.max(...bottomPts.map((p) => p.x)) - Math.min(...bottomPts.map((p) => p.x));
    };
    expect(hem('devant_gauche', jogging) < hem('devant_gauche', short),
      'jogging : bas de jambe plus resserré que le short');
  });

  check('Patrons R2 : pièces optionnelles « à configurer » sans blocage', () => {
    const short = buildFamilyPieces('short', {
      'Hanches': 50, 'Longueur extérieure': 40, 'Taille détendue': 40, 'Hauteur ceinture': 4,
    });
    const poche = short.find((piece) => piece.code === 'poche_gauche');
    expect(poche?.status === 'incomplete', 'poche sans mesure : à configurer');
    expect(poche?.required === false, 'poche optionnelle : ne bloque pas la validation');
    expect(
      JSON.stringify(poche?.missingLabels) === '["Longueur poche","Hauteur poche"]',
      'champs manquants explicitement listés',
    );
    expect(isFamilyReady(short), 'famille prête malgré la poche optionnelle non configurée');
    const polo = buildFamilyPieces('polo', {
      'Poitrine à plat': 56, 'Longueur totale': 74, 'Épaules': 46,
      'Longueur manche': 24, 'Ouverture manche': 20, 'Largeur bas': 56,
      'Encolure': 18, 'Col': 6, 'Largeur patte': 3, 'Longueur patte': 20, 'Hauteur col': 6,
    });
    const fente = polo.find((piece) => piece.code === 'fente_cote');
    expect(fente?.qty === 2 && fente?.status === 'incomplete',
      'fente côté polo : quantité 2, à configurer');
    expect(isFamilyReady(polo), 'polo prêt pour la coupe (fente optionnelle)');
  });

  // Étape 2 : services serveur sur base SQLite temporaire.
  runCuttingServiceTests(check);
  runCuttingPlanTests(check);
  runCuttingTransferTests(check);

  // Étape 9 : audit métier complet (flux, quantités, sécurité transfert).
  runCuttingAuditTests(check);

  // Étape 10 : cohérence des métriques enregistrées + recalcul explicite.
  runCuttingRemetricsTests(check);

  // Étape 12 : gestion rouleaux/produits + image de patron générée.
  runCuttingDonneesTests(check);
  runCuttingPatternDemoTests(check);
  runCuttingRollOpsTests(check);
  runCuttingShapesTests(check);

  // Étape 14 : validation géométrique serveur des contours + cohérence
  // patrons ↔ SVG ↔ nesting ↔ rotations ↔ marges.
  runCuttingContourTests(check);
  runCuttingCoherenceTests(check);

  // Étape 4 : optimiseur de placement (pur, sans base de données).
  runOptimizerTests(check);

  // Étape 5 : nesting BLF sur contours réels (pur, sans base de données).
  runNestingTestSuite(check);

  // Étape 7 : métriques et quantités automatiques (pur, sans base de données).
  runMetricsTestSuite();

  // Étape 15 : benchmark reproductible et contrôles de validité du best-of.
  runCuttingStep15Tests(check);

  // Étape 16 : multi-stratégies — candidates identifiées, validation
  // géométrique indépendante de chaque proposition.
  runCuttingStep16Tests(check);

  // Étape 17 : tickets de transfert Coupe → Couture (numéro lisible,
  // émetteur/réceptionnaire, réception partielle, lecture sans effet).
  runCuttingStep17Tests(check);

  // Étape 18 : moteur de calcul des kg de tissu (conversion rouleau,
  // formule T-shirt de référence, consommation sur matelas déclaré,
  // protections rouleau, prévisionnel).
  runCuttingStep18Tests(check);

  // Phase 3 : correction cohérente du poids et du métrage des rouleaux
  // (largeur nominale, validation kg/m/GSM, source de vérité unique,
  // disponibilité restante, épuisement, 12 scénarios obligatoires).
  runCuttingWeightV2Tests(check);

  // Phase 4 : calculateur ORDNUR (formule C12, unités, wastage, taille
  // ratio, coût, formules par famille, 4 sources de consommation).
  runCuttingOrdnurTests(check);

  // Phase 5.1 : relevés de mesure atelier (sessions, bilan matière,
  // corrections par version — base isolée, jamais le stock réel).
  runCuttingMeasurementTests(check);

  console.log(`\n${testPassed()}`);
}

main();
