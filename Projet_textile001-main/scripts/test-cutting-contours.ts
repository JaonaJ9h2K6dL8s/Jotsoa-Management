/**
 * Tests étape 14 — validation géométrique serveur des contours
 * (`validateRevision` + import JSON) : contours auto-intersectés,
 * sommets répétés, arêtes dégénérées, boîtes incohérentes, droit-fil
 * et rotations. Les révisions historiques ne sont jamais revalidées.
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import Database from 'better-sqlite3';
import { ServiceError } from '../src/server/api/service-error';
import {
  contourSelfIntersects,
  validateContourDefects,
} from '../src/lib/cutting/contour-validate';
import type { Point } from '../src/lib/cutting/types';
import { buildShapedContour } from '../src/server/cutting/pattern-shapes';
import { PATTERN_FAMILIES } from '../src/server/cutting/pattern-rules';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { importRevision } from '../src/server/cutting/pattern-import';
import { listCatalogueProducts, type CatalogueProduct } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

const BOWTIE: Point[] = [
  { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 },
];

export const L_SHAPE: Point[] = [
  { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 },
  { x: 1, y: 3 }, { x: 0, y: 3 },
];

export const MESURES = {
  'Poitrine à plat': 52, 'Longueur totale': 70, Épaules: 46,
  'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
  Encolure: 18, 'Hauteur col': 3,
};

function expectServiceError(fn: () => void, status: number, contains?: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    if (error.status !== status) {
      throw new Error(`Statut attendu ${status}, reçu ${error.status} : ${error.message}`);
    }
    if (contains && !error.message.includes(contains)) {
      throw new Error(`Message attendu « ${contains} », reçu : ${error.message}`);
    }
    return;
  }
  throw new Error('Erreur attendue non levée.');
}

/** Prépare une base de test avec une fiche validée et une révision R2. */
export function prepareRevision(prefix: string) {
  const { db, admin, chef } = createTestDb(prefix);
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Taille M introuvable.');
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
  }).id);
  const revision = generateRevision(db, chef, fiche.id);
  return { db, admin, chef, fiche, revision };
}

function setPieceGeometry(
  db: Database.Database,
  revisionId: number,
  pieceCode: string,
  points: Point[],
): void {
  const result = db.prepare(
    'UPDATE pattern_pieces SET geometry_json = ? '
    + 'WHERE revision_id = ? AND piece_code = ?',
  ).run(JSON.stringify({ points }), revisionId, pieceCode);
  if (result.changes !== 1) throw new Error(`pièce ${pieceCode} non trouvée`);
}

function setPieceRotations(
  db: Database.Database,
  revisionId: number,
  pieceCode: string,
  rotations: number[],
): void {
  const result = db.prepare(
    'UPDATE pattern_pieces SET allowed_rotations = ? '
    + 'WHERE revision_id = ? AND piece_code = ?',
  ).run(JSON.stringify(rotations), revisionId, pieceCode);
  if (result.changes !== 1) throw new Error(`pièce ${pieceCode} non trouvée`);
}

export function runCuttingContourTests(check: (label: string, fn: () => void) => void): void {
  check('validateContourDefects : tous les contours R2 valides, aucun défaut', () => {
    for (const family of PATTERN_FAMILIES) {
      for (const [w, h] of [[54, 72], [20, 24], [45, 5], [40, 100]]) {
        for (const code of ['devant', 'dos', 'manche_gauche', 'col',
          'devant_gauche', 'poche', 'patte_inconnue']) {
          const points = buildShapedContour(family, code, w, h);
          const defects = validateContourDefects(points, { widthCm: w, heightCm: h });
          if (defects.length > 0) {
            throw new Error(`${family}/${code} : ${JSON.stringify(defects)}`);
          }
        }
      }
    }
  });

  check('validateContourDefects : nœud papillon auto-intersecté rejeté', () => {
    if (!contourSelfIntersects(BOWTIE)) throw new Error('nœud papillon non détecté');
    const defects = validateContourDefects(BOWTIE, { widthCm: 4, heightCm: 4 });
    if (!defects.some((defect) => defect.code === 'auto_intersection')) {
      throw new Error('auto-intersection attendue');
    }
  });

  check('validateContourDefects : sommets répétés et fermeture dupliquée rejetés', () => {
    const repeated: Point[] = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 },
    ];
    if (!validateContourDefects(repeated).some((d) => d.code === 'arrete_degeneree')) {
      throw new Error('sommet consécutif dupliqué non détecté');
    }
    const closedTwice: Point[] = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 },
    ];
    if (!validateContourDefects(closedTwice).some((d) => d.code === 'arrete_degeneree')) {
      throw new Error('fermeture dupliquée non détectée');
    }
  });

  check('validateContourDefects : coordonnées non finies, contour trop court', () => {
    const notFinite: Point[] = [
      { x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 4, y: 3 },
    ];
    if (!validateContourDefects(notFinite).some((d) => d.code === 'coordonnees')) {
      throw new Error('coordonnée NaN non détectée');
    }
    const tooShort: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    if (!validateContourDefects(tooShort).some((d) => d.code === 'trop_court')) {
      throw new Error('contour de 2 points non détecté');
    }
  });

  check('validateContourDefects : aire nulle et boîte incohérente rejetés', () => {
    const flat: Point[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }];
    if (!validateContourDefects(flat).some((d) => d.code === 'aire_nulle')) {
      throw new Error('contour aligné (aire nulle) non détecté');
    }
    const defects = validateContourDefects(L_SHAPE, { widthCm: 10, heightCm: 3 });
    if (defects.filter((d) => d.code === 'boite_incoherente').length !== 1) {
      throw new Error(`largeur incohérente attendue seule : ${JSON.stringify(defects)}`);
    }
    if (validateContourDefects(L_SHAPE, { widthCm: 3, heightCm: 3 }).length > 0) {
      throw new Error('L 3×3 : boîte cohérente ne doit pas être rejetée');
    }
  });

  check('validateContourDefects : contacts autorisés non rejetés à tort', () => {
    // Sommets partagés entre arêtes adjacentes et point aligné sur une
    // arête (découpage d'arête) : polygones simples, aucun défaut.
    const splitEdge: Point[] = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 },
      { x: 4, y: 3 }, { x: 0, y: 3 },
    ];
    if (validateContourDefects(splitEdge).length > 0) {
      throw new Error('arête découpée en deux segments alignés rejetée à tort');
    }
    if (validateContourDefects(L_SHAPE).length > 0) {
      throw new Error('pièce concave valide rejetée à tort');
    }
  });

  check('validateRevision : contour auto-intersecté → refus 409 explicite, données intactes', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr1-');
    setPieceGeometry(db, revision.id, 'devant', BOWTIE);
    const before = db.prepare(
      'SELECT geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY id',
    ).all(revision.id);
    expectServiceError(
      () => validateRevision(db, admin, revision.id),
      409,
      'auto-intersecté',
    );
    const after = db.prepare(
      'SELECT geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY id',
    ).all(revision.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('données modifiées par une validation refusée');
    }
    const status = db.prepare(
      'SELECT status FROM pattern_revisions WHERE id = ?',
    ).get(revision.id) as { status: string };
    if (status.status !== 'brouillon') throw new Error('statut modifié par un refus');
  });

  check('validateRevision : sommet répété (arête dégénérée) → refus 409', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr2-');
    setPieceGeometry(db, revision.id, 'dos', [
      { x: 0, y: 0 }, { x: 56, y: 0 }, { x: 56, y: 0 },
      { x: 56, y: 72 }, { x: 0, y: 72 },
    ]);
    expectServiceError(
      () => validateRevision(db, admin, revision.id),
      409,
      'longueur nulle',
    );
  });

  check('validateRevision : boîte englobante ≠ dimensions de coupe → refus 409', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr3-');
    setPieceGeometry(db, revision.id, 'manche_gauche', [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 12 }, { x: 0, y: 12 },
    ]);
    expectServiceError(
      () => validateRevision(db, admin, revision.id),
      409,
      'dimension de coupe',
    );
  });

  check('validateRevision : droit-fil sans rotation compatible → refus 409', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr4-');
    setPieceRotations(db, revision.id, 'devant', [90, 270]);
    expectServiceError(
      () => validateRevision(db, admin, revision.id),
      409,
      'aucune rotation',
    );
  });

  check('validateRevision : rotations non multiples de 90° → refus 409', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr5-');
    setPieceRotations(db, revision.id, 'manche_droite', [0, 45]);
    expectServiceError(
      () => validateRevision(db, admin, revision.id),
      409,
      'multiples de 90°',
    );
  });

  check('validateRevision : révision R2 valide acceptée par les nouveaux contrôles', () => {
    const { db, admin, revision } = prepareRevision('cut-cntr6-');
    const validated = validateRevision(db, admin, revision.id);
    if (validated.status !== 'valide') throw new Error('validation attendue');
  });

  check('Import JSON : contour auto-intersecté refusé dès l\'import (400)', () => {
    const { db, chef, admin, fiche } = prepareRevision('cut-cntr7-');
    expectServiceError(
      () => importRevision(db, chef, {
        ficheId: fiche.id,
        sourceName: 'DEXIS',
        sourceUnit: 'cm',
        pieces: [{
          code: 'essai', label: 'Essai', component: 'principal',
          qty: 1, grainDirection: 'along', allowedRotations: [0, 180],
          seamAllowanceCm: 1, seamIncluded: false, required: true,
          points: BOWTIE,
        }],
      }),
      400,
      'auto-intersecté',
    );
    const imported = importRevision(db, chef, {
      ficheId: fiche.id,
      sourceName: 'DEXIS',
      sourceUnit: 'cm',
      pieces: [{
        code: 'essai_ok', label: 'Essai valide', component: 'principal',
        qty: 1, grainDirection: 'along', allowedRotations: [0, 180],
        seamAllowanceCm: 1, seamIncluded: false, required: true,
        points: L_SHAPE,
      }],
    });
    if (imported.pieces.length !== 1) throw new Error('import valide attendu');
    const validated = validateRevision(db, admin, imported.id);
    if (validated.status !== 'valide') throw new Error('import valide non validable');
  });
}
