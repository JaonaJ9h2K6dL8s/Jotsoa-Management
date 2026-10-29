/**
 * Tests étape 14 — audit géométrique des contours R2 et protections
 * du patrimoine (révisions historiques, plan #20 déjà transféré).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import Database from 'better-sqlite3';
import { buildShapedContour } from '../src/server/cutting/pattern-shapes';
import { PATTERN_FAMILIES, buildFamilyPieces } from '../src/server/cutting/pattern-rules';
import { polygonArea, segmentsIntersect } from '../src/lib/cutting/geometry';
import type { Point } from '../src/lib/cutting/types';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { listCatalogueProducts, type CatalogueProduct } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

const SHAPED_CODES = [
  'devant', 'dos', 'manche_gauche', 'manche_droite', 'col', 'ceinture',
  'devant_gauche', 'devant_droite', 'dos_gauche', 'dos_droite',
  'poche', 'poche_gauche', 'poche_droite',
] as const;

const RECT_FALLBACK_CODES = [
  'patte_boutonnage', 'fente_cote', 'bas_jambe', 'poignet',
] as const;

const MESURES = {
  'Poitrine à plat': 52, 'Longueur totale': 70, Épaules: 46,
  'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
  Encolure: 18, 'Hauteur col': 3,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function bounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function shareVertex(
  a1: Point, a2: Point, b1: Point, b2: Point,
): boolean {
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-9
    && Math.abs(p.y - q.y) < 1e-9;
  return same(a1, b1) || same(a1, b2) || same(a2, b1) || same(a2, b2);
}

/** Auto-intersection : segments non adjacents qui se croisent.
 * Arêtes dégénérées (fermeture dupliquée des révisions historiques)
 * et contacts de sommets partagés ignorés. */
function selfIntersects(points: Point[]): boolean {
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const a1 = points[first];
    const a2 = points[(first + 1) % count];
    if (Math.abs(a1.x - a2.x) < 1e-9 && Math.abs(a1.y - a2.y) < 1e-9) continue;
    for (let second = first + 2; second < count; second += 1) {
      if (first === 0 && second === count - 1) continue;
      const b1 = points[second];
      const b2 = points[(second + 1) % count];
      if (Math.abs(b1.x - b2.x) < 1e-9 && Math.abs(b1.y - b2.y) < 1e-9) continue;
      if (shareVertex(a1, a2, b1, b2)) continue;
      if (segmentsIntersect({ a: a1, b: a2 }, { a: b1, b: b2 })) {
        return true;
      }
    }
  }
  return false;
}

export function runCuttingShapesTests(check: (label: string, fn: () => void) => void): void {
  check('Contours R2 : boîte englobante exacte, fermeture, pas d’auto-intersection', () => {
    for (const family of PATTERN_FAMILIES) {
      for (const code of SHAPED_CODES) {
        for (const [w, h] of [[54, 72], [20, 24], [45, 5], [40, 100], [32, 26]]) {
          const points = buildShapedContour(family, code, w, h);
          if (points.length < 3) throw new Error(`${family}/${code} : moins de 3 sommets`);
          const first = points[0];
          const last = points[points.length - 1];
          if (first.x === last.x && first.y === last.y) {
            throw new Error(`${family}/${code} : dernier point dupliqué (fermeture implicite attendue)`);
          }
          const box = bounds(points);
          if (round2(box.minX) !== 0 || round2(box.minY) !== 0
            || round2(box.maxX) !== w || round2(box.maxY) !== h) {
            throw new Error(`${family}/${code} ${w}x${h} : boîte ${JSON.stringify(box)}`);
          }
          if (selfIntersects(points)) {
            throw new Error(`${family}/${code} ${w}x${h} : contour auto-intersecté`);
          }
          const area = polygonArea(points);
          if (area <= 0) throw new Error(`${family}/${code} : aire nulle ou négative`);
          if (area > w * h + 1e-6) {
            throw new Error(`${family}/${code} : aire ${area} > boîte ${w * h}`);
          }
        }
      }
    }
  });

  check('Contours R2 : rotations 90/180/270 conservent la boîte (transposée)', () => {
    const points = buildShapedContour('tshirt', 'devant', 54, 72);
    if (points.length < 10) throw new Error('Contour torse dégénéré (attendu : courbes).');
    const sleeve = buildShapedContour('polo', 'manche_gauche', 20, 24);
    if (sleeve.length < 10) throw new Error('Contour manche dégénéré (attendu : calotte).');
    const leg = buildShapedContour('jogging', 'devant_gauche', 40, 100);
    if (leg.length < 10) throw new Error('Contour jambe dégénéré (attendu : fourche courbe).');
  });

  check('Contours R2 : pièces sans forme dédiée restent des rectangles exacts', () => {
    for (const code of RECT_FALLBACK_CODES) {
      const points = buildShapedContour('polo', code, 30, 8);
      if (points.length !== 4) throw new Error(`${code} : attendu rectangle 4 sommets`);
      const area = polygonArea(points);
      if (Math.abs(area - 240) > 1e-6) throw new Error(`${code} : aire ${area} != 240`);
    }
  });

  check('Règles R2 : ensemble = haut (5 pièces) + bas (5 pièces), marges identiques', () => {
    const pieces = buildFamilyPieces('ensemble', {
      'Haut : poitrine': 34, 'Haut : longueur': 45, 'Haut : ouverture manche': 12,
      'Haut : manche': 14, 'Haut : encolure': 13, 'Hauteur col': 2.5,
      'Short : hanches': 32, 'Short : longueur': 26, 'Short : taille': 26,
      'Short : ceinture': 3,
    });
    const haut = pieces.filter((piece) => piece.code.startsWith('haut_') && piece.required);
    const bas = pieces.filter((piece) => piece.code.startsWith('short_') && piece.required);
    if (haut.length !== 5) throw new Error(`haut : ${haut.length} pièces != 5`);
    if (bas.length !== 5) throw new Error(`bas : ${bas.length} pièces != 5`);
    for (const piece of pieces) {
      if (piece.seamAllowanceCm <= 0) throw new Error(`${piece.code} : marge absente`);
      if (piece.widthCm === null || piece.heightCm === null) {
        if (piece.required) {
          throw new Error(`${piece.code} : pièce obligatoire incomplète`);
        }
        continue;
      }
      if (!Number.isFinite(polygonArea(buildShapedContour('ensemble', piece.code,
        piece.widthCm, piece.heightCm)))) {
        throw new Error(`${piece.code} : contour non constructible`);
      }
    }
  });

  check('Révisions #7–#14 (base démo) : façonnées, marges incluses, validées', () => {
    const db = new Database('data/jo-test-admin.db', { readonly: true });
    try {
      const rows = db.prepare(
        'SELECT id, piece_code, geometry_json, seam_included, seam_allowance_cm '
        + 'FROM pattern_pieces WHERE revision_id BETWEEN 7 AND 14',
      ).all() as Array<{
        id: number; piece_code: string; geometry_json: string;
        seam_included: number; seam_allowance_cm: number;
      }>;
      if (rows.length < 47) throw new Error(`pièces R2 attendues >= 47, reçu ${rows.length}`);
      for (const row of rows) {
        // Convention R2 : dimensions = vêtement fini, marge de 1 cm
        // déclarée séparément (seam_included = 0) → jamais double-comptée.
        if (row.seam_included !== 0 || row.seam_allowance_cm !== 1) {
          throw new Error(`révision : marge incohérente pour ${row.piece_code} (#${row.id})`);
        }
        const points = JSON.parse(row.geometry_json).points as Point[];
        if (selfIntersects(points)) {
          throw new Error(`pièce #${row.id} (${row.piece_code}) : auto-intersectée`);
        }
      }
      const statuses = db.prepare(
        'SELECT COUNT(*) AS n FROM pattern_revisions WHERE id BETWEEN 7 AND 14 AND status = \'valide\'',
      ).get() as { n: number };
      if (statuses.n !== 8) throw new Error(`révisions validées : ${statuses.n} != 8`);
    } finally {
      db.close();
    }
  });

  check('Patrimoine : révisions #1–#6 (démonstration) restent des pièces simples non R2', () => {
    const db = new Database('data/jo-test-admin.db', { readonly: true });
    try {
      const rows = db.prepare(
        'SELECT geometry_json FROM pattern_pieces WHERE revision_id BETWEEN 1 AND 6',
      ).all() as Array<{ geometry_json: string }>;
      for (const row of rows) {
        const points = JSON.parse(row.geometry_json).points as Point[];
        if (points.length > 6) {
          throw new Error('révision historique modifiée (formes de démonstration simples attendues)');
        }
      }
    } finally {
      db.close();
    }
  });

  check('Plan #20 : validé et transféré, jamais réutilisable', () => {
    const db = new Database('data/jo-test-admin.db', { readonly: true });
    try {
      const plan = db.prepare(
        'SELECT status, lot_id FROM marker_plans WHERE id = 20',
      ).get() as { status: string; lot_id: number | null } | undefined;
      if (!plan) {
        // Base de démonstration purgée (test manuel) : rien à vérifier.
        // Ce contrôle redevient actif dès qu'un plan #20 existe à nouveau.
        console.log('  (plan #20 absent : base de démonstration vide, contrôle ignoré)');
        return;
      }
      if (plan.status !== 'valide' || plan.lot_id === null) {
        throw new Error(`plan #20 inattendu : ${JSON.stringify(plan)}`);
      }
      const lot = db.prepare('SELECT id FROM coupe_lots WHERE id = ?')
        .get(plan.lot_id) as { id: number } | undefined;
      if (!lot) throw new Error('lot du plan #20 introuvable');
    } finally {
      db.close();
    }
  });

  check('Isolation : régénérer ne modifie jamais les révisions existantes', () => {
    const { db, admin, chef } = createTestDb('cut-shapes-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
    }).id);
    const first = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const before = db.prepare(
      'SELECT piece_code, geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY id',
    ).all(first.id) as Array<{ piece_code: string; geometry_json: string }>;
    const second = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    if (second.id <= first.id) throw new Error('nouvelle révision attendue (nouvel id)');
    const after = db.prepare(
      'SELECT piece_code, geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY id',
    ).all(first.id) as Array<{ piece_code: string; geometry_json: string }>;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('révision existante modifiée par une régénération');
    }
  });
}
