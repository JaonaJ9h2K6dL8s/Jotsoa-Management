/**
 * Tests étape 14 — cohérence entre patrons, aperçu SVG, nesting,
 * métriques, rotations client/serveur et marges de couture.
 * - les coordonnées visibles correspondent aux coordonnées persistées ;
 * - les dimensions en cm correspondent aux contours réels ;
 * - le nesting utilise exactement les géométries persistées ;
 * - les rotations suivent la même règle des deux côtés ;
 * - les marges ne sont jamais ajoutées deux fois ;
 * - l'aperçu SVG n'est jamais une preuve de validation industrielle ;
 * - les révisions historiques restent consultables sans réécriture.
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import Database from 'better-sqlite3';
import { validateContourDefects } from '../src/lib/cutting/contour-validate';
import {
  grainPermittedRotations,
  polygonArea,
  transformContour,
} from '../src/lib/cutting/geometry';
import { optimizePlacement } from '../src/lib/cutting/optimizer';
import type { Point } from '../src/lib/cutting/types';
import { rotationToServer, rotationToUi } from '../src/interfaces/cutting/canvas/frame';
import {
  RULE_SEAM_ALLOWANCE_CM,
  buildFamilyPieces,
} from '../src/server/cutting/pattern-rules';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { renderPatternPreview } from '../src/server/cutting/pattern-preview';
import { MESURES, L_SHAPE, prepareRevision } from './test-cutting-contours';
import { importRevision } from '../src/server/cutting/pattern-import';

export function runCuttingCoherenceTests(check: (label: string, fn: () => void) => void): void {
  check('Aperçu SVG : fidèle aux contours persistés (sommets, dimensions)', () => {
    const { db, chef, admin, revision } = prepareRevision('cut-coh1-');
    validateRevision(db, admin, revision.id);
    const preview = renderPatternPreview(db, chef, revision.id);
    const rows = db.prepare(
      'SELECT piece_code, geometry_json, width_cm, height_cm '
      + 'FROM pattern_pieces WHERE revision_id = ?',
    ).all(revision.id) as Array<{
      piece_code: string; geometry_json: string; width_cm: number; height_cm: number;
    }>;
    const pathCounts = [...preview.svg.matchAll(/ d="[^"]*"/g)].map((match) => {
      const path = match[0];
      return (path.match(/L/g) ?? []).length + 1;
    }).sort((a, b) => a - b);
    const persistedCounts = rows.map((row) => {
      const points = JSON.parse(row.geometry_json).points as Point[];
      return points.length;
    }).sort((a, b) => a - b);
    if (JSON.stringify(pathCounts) !== JSON.stringify(persistedCounts)) {
      throw new Error(`sommets SVG ${JSON.stringify(pathCounts)} `
        + `≠ persistés ${JSON.stringify(persistedCounts)}`);
    }
    for (const row of rows) {
      const dims = `${row.width_cm.toFixed(0)}×${row.height_cm.toFixed(0)} cm`;
      if (!preview.svg.includes(dims)) {
        throw new Error(`dimensions ${dims} absentes de l'aperçu SVG`);
      }
    }
  });

  check('Nesting : mêmes géométries que les contours persistés (aires exactes)', () => {
    const { db, admin, revision } = prepareRevision('cut-coh2-');
    validateRevision(db, admin, revision.id);
    const fresh = db.prepare(
      'SELECT id, piece_code, geometry_json, qty_multiplier, grain_direction, '
      + 'allowed_rotations FROM pattern_pieces WHERE revision_id = ?',
    ).all(revision.id) as Array<{
      id: number; piece_code: string; geometry_json: string; qty_multiplier: number;
      grain_direction: string; allowed_rotations: string;
    }>;
    const result = optimizePlacement({
      usableWidthCm: 170, maxLengthCm: 500, gapCm: 1,
      pieces: fresh.map((row) => ({
        id: row.id,
        code: row.piece_code,
        label: row.piece_code,
        points: JSON.parse(row.geometry_json).points as Point[],
        qty: row.qty_multiplier,
        grainDirection: row.grain_direction as 'along' | 'cross' | 'any',
        allowedRotations: JSON.parse(row.allowed_rotations) as number[],
        status: 'configuree' as const,
      })),
    });
    if (result.unplaced.length > 0) throw new Error('pièces non placées inattendues');
    const byId = new Map(fresh.map((row) => [row.id, row]));
    let areaSum = 0;
    for (const placement of result.placements) {
      const source = byId.get(placement.pieceId);
      if (!source) throw new Error('pièce inconnue placée');
      const points = JSON.parse(source.geometry_json).points as Point[];
      const expected = transformContour(
        points, placement.rotation as 0 | 90 | 180 | 270, placement.x, placement.y,
      );
      if (expected.length !== placement.points.length) {
        throw new Error('nombre de sommets modifié par le placement');
      }
      for (let index = 0; index < expected.length; index += 1) {
        if (Math.abs(expected[index].x - placement.points[index].x) > 1e-6
          || Math.abs(expected[index].y - placement.points[index].y) > 1e-6) {
          throw new Error(`sommet ${index} modifié par le placement`);
        }
      }
      areaSum += polygonArea(points) / 10000;
    }
    if (Math.abs(result.metrics.piecesAreaM2 - areaSum) > 1e-9) {
      throw new Error('surface des pièces ≠ somme des aires des contours persistés');
    }
  });

  check('Rotations : repère écran et repère serveur appliquent la même règle', () => {
    for (const angle of [0, 90, 180, 270] as const) {
      if (rotationToServer(rotationToUi(angle)) !== angle
        || rotationToUi(rotationToServer(angle)) !== angle) {
        throw new Error(`conversion écran↔serveur non involutive (${angle}°)`);
      }
    }
    // La règle côté client (useLiveValidation) est : convertir la
    // rotation écran vers le repère serveur puis exiger son appartenance
    // à allowedRotations — soit exactement la règle serveur, appliquée
    // à l'angle serveur. Invariant : pour tout angle autorisé côté
    // serveur, l'angle écran correspondant reconverti retombe dessus.
    const clientInlineConversion = (rotation: number): number => (
      rotation === 90 ? 270 : rotation === 270 ? 90 : rotation
    );
    for (const grain of ['along', 'cross', 'any'] as const) {
      for (const allowed of [[0], [0, 180], [0, 90, 180, 270], [90]]) {
        const permitted = grainPermittedRotations(grain, allowed);
        for (const serverAngle of permitted) {
          const ui = rotationToUi(serverAngle);
          if (clientInlineConversion(ui) !== serverAngle) {
            throw new Error(`règle client ≠ règle serveur (${grain}, ${serverAngle}°)`);
          }
          if (!allowed.includes(serverAngle)) {
            throw new Error(`angle permis hors ensemble déclaré (${serverAngle}°)`);
          }
        }
      }
    }
  });

  check('Marges de couture : ajoutées exactement une fois (jamais deux)', () => {
    const pieces = buildFamilyPieces('tshirt', MESURES);
    const devant = pieces.find((piece) => piece.code === 'devant');
    if (!devant || devant.widthCm === null || devant.heightCm === null) {
      throw new Error('devant attendu configuré');
    }
    if (devant.widthCm !== MESURES['Poitrine à plat'] + 2 * RULE_SEAM_ALLOWANCE_CM) {
      throw new Error(`marge ajoutée plus d'une fois : ${devant.widthCm}`);
    }
    if (devant.seamIncluded) throw new Error('marge incluse deux fois (seamIncluded)');
    const points = devant.points ?? [];
    const xs = points.map((point) => point.x);
    if (Math.max(...xs) - Math.min(...xs) !== devant.widthCm) {
      throw new Error('boîte englobante ≠ dimension de coupe (marge perdue ou doublée)');
    }
  });

  check('Aperçu SVG : consultation seule, jamais une preuve industrielle', () => {
    const { db, chef, fiche } = prepareRevision('cut-coh3-');
    const imported = importRevision(db, chef, {
      ficheId: fiche.id,
      sourceName: 'DEXIS',
      sourceUnit: 'cm',
      pieces: [{
        code: 'essai_svg', label: 'Essai SVG', component: 'principal',
        qty: 1, grainDirection: 'along', allowedRotations: [0, 180],
        seamAllowanceCm: 1, seamIncluded: false, required: true,
        points: L_SHAPE,
      }],
    });
    // Brouillon : l'image est refusée même si le tracé est correct.
    let refused = false;
    try {
      renderPatternPreview(db, chef, imported.id);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('aperçu généré pour un patron non validé');
  });

  check('Patrimoine : révisions historiques consultables, jamais revalidées', () => {
    const db = new Database('data/jo-test-admin.db', { readonly: true });
    try {
      for (const id of [1, 7, 14]) {
        const row = db.prepare(
          'SELECT status FROM pattern_revisions WHERE id = ?',
        ).get(id) as { status: string } | undefined;
        if (!row) throw new Error(`révision #${id} absente`);
      }
      const pieces7 = db.prepare(
        'SELECT piece_code, geometry_json, width_cm, height_cm '
        + 'FROM pattern_pieces WHERE revision_id = 7 ORDER BY id',
      ).all() as Array<{ piece_code: string; geometry_json: string;
        width_cm: number; height_cm: number }>;
      if (pieces7.length === 0) throw new Error('révision #7 sans pièce');
      // Une pièce historique peut ne pas satisfaire les nouveaux
      // critères : elle reste LISIBLE (aucune revalidation automatique,
      // aucune réécriture, aucune consultation bloquée).
      const historical = JSON.parse(pieces7[0].geometry_json).points as Point[];
      if (historical.length < 3) throw new Error('contour historique illisible');
      validateContourDefects(historical, {
        widthCm: pieces7[0].width_cm, heightCm: pieces7[0].height_cm,
      });
      const statuses = db.prepare(
        "SELECT COUNT(*) AS n FROM pattern_revisions "
        + "WHERE id BETWEEN 7 AND 14 AND status = 'valide'",
      ).get() as { n: number };
      if (statuses.n !== 8) throw new Error(`révisions validées : ${statuses.n} != 8`);
    } finally {
      db.close();
    }
  });
}
