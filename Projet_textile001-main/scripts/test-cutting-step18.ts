/**
 * Tests du moteur de calcul des kilogrammes de tissu (étape 18).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture des tests obligatoires :
 * - A : conversion poids → longueur d'un rouleau (20 kg, 1,60 m,
 *   160 g/m² → 78,125 m) et cohérence poids/longueur ;
 * - B : formule théorique de référence T-shirt du cahier des charges
 *   (2,42352 kg/douzaine net → 2,7143424 après 12 % → 0,2261952/pièce) ;
 * - D : mouvement de rouleau sur base isolée — consommation enregistrée
 *   UNE seule fois, précision interne sans arrondi prématuré, matelas
 *   différent de la longueur occupée, anomalie occupé > matelas,
 *   longueur non fiable (déduction bloquée), grammage manquant,
 *   poids négatif refusé, double validation refusée ;
 * - estimation prévisionnelle : surfaces réelles des contours,
 *   bascule vers l'historique de placement, données manquantes
 *   signalées (jamais de résultat inventé).
 * Base de test isolée (createTestDb) — le plan historique #20 de la
 * base réelle n'est jamais utilisé.
 */

import { ServiceError } from '../src/server/api/service-error';
import { createRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import {
  checkRollCoherence, estimateFabricForProduct,
  estimateRollLengthM, estimateRollWeightKg, tshirtTheoreticalKg,
} from '../src/server/cutting/fabric-estimate';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

const TSHIRT_MESURES = {
  'Poitrine à plat': 52,
  'Longueur totale': 70,
  Épaules: 46,
  'Longueur manche': 22,
  'Ouverture manche': 18,
  'Largeur bas': 50,
  Encolure: 18,
  'Hauteur col': 3,
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

export function runCuttingStep18Tests(check: (label: string, fn: () => void) => void): void {
  // ── Test A : conversion d'un rouleau ───────────────────────────────
  check('A. Conversion 20 kg / 1,60 m / 160 g/m² → 78,125 m', () => {
    const lengthM = estimateRollLengthM(20, 160, 160);
    if (Math.abs(lengthM - 78.125) > 1e-9) {
      throw new Error(`Attendu 78,125 m, obtenu ${lengthM}`);
    }
    const weightKg = estimateRollWeightKg(78.125, 160, 160);
    if (Math.abs(weightKg - 20) > 1e-9) {
      throw new Error(`Aller-retour attendu 20 kg, obtenu ${weightKg}`);
    }
    expectServiceError(() => estimateRollLengthM(0, 160, 160), 400);
    expectServiceError(() => estimateRollLengthM(20, 0, 160), 400);
    expectServiceError(() => estimateRollLengthM(20, 160, -1), 400);
  });

  check('A. Cohérence poids/longueur : anomalie au-delà de la tolérance', () => {
    const ok = checkRollCoherence(20, 78.125, 160, 160);
    if (ok.anomaly || Math.abs(ok.implicitGrammage - 160) > 1e-9) {
      throw new Error('Tissu cohérent signalé comme anormal.');
    }
    const deviant = checkRollCoherence(20, 60, 160, 160);
    if (!deviant.anomaly) throw new Error('Anomalie attendue (grammage implicite 200).');
    if (deviant.deviationPct <= 10) throw new Error('Écart relatif incohérent.');
  });

  // ── Test B : formule théorique T-shirt de référence ────────────────
  check('B. Référence T-shirt : 2,42352 → 2,7143424 → 0,2261952 kg', () => {
    const net = tshirtTheoreticalKg({
      bodyLengthCm: 72, chestHalfCm: 52, sleeveLengthCm: 20,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, grammageGm2: 180,
    });
    if (Math.abs(net.netKgPerDozen - 2.42352) > 1e-9) {
      throw new Error(`Net/douzaine attendu 2,42352, obtenu ${net.netKgPerDozen}`);
    }
    const afterLosses = net.netKgPerDozen * 1.12;
    if (Math.abs(afterLosses - 2.7143424) > 1e-9) {
      throw new Error(`Après 12 % attendu 2,7143424, obtenu ${afterLosses}`);
    }
    const perPiece = afterLosses / 12;
    if (Math.abs(perPiece - 0.2261952) > 1e-9) {
      throw new Error(`Par pièce attendu 0,2261952, obtenu ${perPiece}`);
    }
  });

  // ── Test D : mouvement du rouleau sur base isolée ──────────────────
  const { db, admin, chef, colorId } = createTestDb('cut-step18-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: TSHIRT_MESURES,
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
    .get() as { id: number }).id;
  const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
    id: number; widthCm: number;
  };
  const dos = revision.pieces.find((piece) => piece.code === 'dos') as { id: number };
  const col = revision.pieces.find((piece) => piece.code === 'col') as { id: number };
  const mancheG = revision.pieces.find(
    (piece) => piece.code === 'manche_gauche',
  ) as { id: number };
  const mancheD = revision.pieces.find(
    (piece) => piece.code === 'manche_droite',
  ) as { id: number };
  const cutPieces = [
    { pieceId: devant.id, qty: 2 }, { pieceId: dos.id, qty: 1 },
    { pieceId: mancheG.id, qty: 1 }, { pieceId: mancheD.id, qty: 1 },
    { pieceId: col.id, qty: 1 },
  ];
  const buildPlan = (rollId: number, matelasLengthCm: number): number => {
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId, tableId: table1,
      layers: 2, gapCm: 1, matelasLengthCm, qty: 1,
    });
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
      { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
      { pieceId: col.id, x: 2, y: 160, rotation: 0 },
      { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
      { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
    ]);
    validatePlan(db, admin, plan.id);
    return plan.id;
  };
  // Simule une dérive de données EXTERNE (édition erronée) sur un plan
  // validé : trigger d'immuabilité levé le temps de l'UPDATE, puis
  // restauré à l'identique (migration 0015).
  const simulateExternalEdit = (
    planId: number, sql: string, ...params: unknown[]
  ): void => {
    db.exec('DROP TRIGGER protect_validated_plan');
    try {
      db.prepare(sql).run(...params);
    } finally {
      db.exec(
        `CREATE TRIGGER protect_validated_plan BEFORE UPDATE OF `
        + `pieces_json, sizes_json, input_json, product_id, category, `
        + `usable_width_cm, matelas_length_cm, layers, gap_cm, `
        + `marker_length_cm, coupe_table_id, roll_id, planned_start, `
        + `planned_end, status ON marker_plans WHEN OLD.status = 'valide' `
        + `BEGIN SELECT RAISE(ABORT, 'Plan validé immuable : créer une `
        + `nouvelle version.'); END;`,
      );
    }
  };

  // Test C (1) SANS historique : exécuté AVANT les tests D (qui créent
  // des plans validés) → aucune efficacité historique = surfaces_nettes.
  check('C. Prévisionnel : surfaces nettes sans historique, données manquantes listées', () => {
    const estimate = estimateFabricForProduct(
      db, tshirt.productId, sizeM.id, { qty: 12 },
    );
    if (estimate.method !== 'surfaces_nettes') {
      throw new Error(`Méthode attendue surfaces_nettes, obtenu ${estimate.method}`);
    }
    if (estimate.reliable) throw new Error('Sans historique, estimation non fiable.');
    if (estimate.estimatedKg !== null) {
      throw new Error('Sans grammage, aucun kg ne doit être produit.');
    }
    if (estimate.missingData.length === 0) {
      throw new Error('Les données manquantes doivent être signalées.');
    }
    if (estimate.estimatedAreaM2 === null || estimate.estimatedAreaM2 <= 0) {
      throw new Error('La surface nette des contours doit être positive.');
    }
  });

  check('D. Consommation sur matelas DÉCLARÉ, précision interne, un seul mouvement', () => {
    // Grammage à 1 décimale : le kg consommé a 4 décimales — l'ancien
    // code l'arrondissait prématurément à 3.
    const roll = createRoll(db, chef, {
      code: 'R-E18-1', fabricRef: 'JERSEY-179.5', colorId,
      // Cohérent : implicite = 20000/(62×1,8) ≈ 179,2 g/m² (≤ 10 %).
      weightKg: 20, lengthM: 62, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 179.5,
    });
    const planId = buildPlan(roll.id, 500);
    const occupied = (db.prepare(
      'SELECT marker_length_cm, matelas_length_cm FROM marker_plans WHERE id = ?',
    ).get(planId) as { marker_length_cm: number; matelas_length_cm: number });
    if (occupied.matelas_length_cm <= occupied.marker_length_cm) {
      throw new Error('Scénario invalide : le matelas doit dépasser la longueur occupée.');
    }
    const result = createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    });
    const expectedKg = (2 * 500 * 180 / 10000) * 179.5 / 1000;
    if (result.fabricConsumedKg === null
      || Math.abs(result.fabricConsumedKg - expectedKg) > 1e-9) {
      throw new Error(`Consommation attendue ${expectedKg}, obtenu ${result.fabricConsumedKg}`);
    }
    if (result.fabricKgBasis !== 'matelas_declare') {
      throw new Error(`Statut attendu « matelas_declare », obtenu ${String(result.fabricKgBasis)}`);
    }
    const rollRow = db.prepare(
      'SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number };
    if (Math.abs(rollRow.remaining_weight_kg - (20 - expectedKg)) > 1e-9) {
      throw new Error(`Restant attendu ${20 - expectedKg}, obtenu ${rollRow.remaining_weight_kg}`);
    }
    const movements = db.prepare(
      "SELECT qty FROM coupe_roll_movements WHERE roll_id = ? AND movement_type = 'consommation'",
    ).all(roll.id) as Array<{ qty: number }>;
    if (movements.length !== 1) {
      throw new Error(`1 mouvement attendu, obtenu ${movements.length}`);
    }
    if (Math.abs(movements[0].qty - expectedKg) > 1e-9) {
      throw new Error('Mouvement : précision interne non conservée (arrondi prématuré ?).');
    }
    const afterOldFormula = (2 * occupied.marker_length_cm * 170 / 10000) * 180 / 1000;
    console.log(
      `      avant/après (même plan) : ancienne formule occupé `
      + `${afterOldFormula.toFixed(3)} kg → matelas déclaré ${expectedKg.toFixed(3)} kg`,
    );
  });

  check('D. Double validation de la même coupe refusée, aucun second débit', () => {
    const rollRow = db.prepare(
      'SELECT remaining_weight_kg FROM coupe_rolls WHERE id = 1',
    ).get() as { remaining_weight_kg: number } | undefined;
    void rollRow;
    const planId = db.prepare(
      'SELECT id FROM marker_plans ORDER BY id DESC LIMIT 1',
    ).get() as { id: number };
    const before = (db.prepare('SELECT COUNT(*) AS n FROM coupe_roll_movements')
      .get() as { n: number }).n;
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: planId.id, cutPieces, confirmCut: true,
    }), 409, 'doublon');
    const after = (db.prepare('SELECT COUNT(*) AS n FROM coupe_roll_movements')
      .get() as { n: number }).n;
    if (before !== after) throw new Error('Un second mouvement a été créé.');
  });

  check('D. Anomalie bloquante : longueur occupée > matelas déclaré', () => {
    const roll = createRoll(db, chef, {
      code: 'R-E18-2', fabricRef: 'JERSEY-180', colorId,
      weightKg: 20, lengthM: 62, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    const planId = buildPlan(roll.id, 500);
    // Dérive de données simulée (édition externe erronée du matelas).
    simulateExternalEdit(planId,
      'UPDATE marker_plans SET matelas_length_cm = 100 WHERE id = ?', planId);
    const before = (db.prepare('SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?')
      .get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg;
    expectServiceError(() => createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    }), 409, 'Anomalie de plan');
    const after = (db.prepare('SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?')
      .get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg;
    if (before !== after) {
      throw new Error('La consommation a été déduite malgré l’anomalie.');
    }
  });

  check('D. Matelas non fiable : interdit par le schéma (CHECK > 0)', () => {
    const roll = createRoll(db, chef, {
      code: 'R-E18-3', fabricRef: 'JERSEY-180', colorId,
      weightKg: 20, lengthM: 62, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    const planId = buildPlan(roll.id, 500);
    // Le schéma (migration 0012 : matelas REAL NOT NULL CHECK > 0)
    // empêche toute donnée de longueur non fiable d'exister : la dérive
    // vers 0 doit être rejetée par la base elle-même.
    let schemaProtected = false;
    try {
      simulateExternalEdit(planId,
        'UPDATE marker_plans SET matelas_length_cm = 0 WHERE id = ?', planId);
    } catch (error) {
      if (error instanceof Error
        && error.message.includes('CHECK constraint failed')) {
        schemaProtected = true;
      } else {
        throw error;
      }
    }
    if (!schemaProtected) {
      throw new Error('Le schéma doit refuser un matelas ≤ 0 (CHECK).');
    }
    // Le plan intact reste transférable : consommation normale.
    const result = createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    });
    if (result.fabricConsumedKg === null
      || result.fabricKgBasis !== 'matelas_declare') {
      throw new Error('Plan intact : consommation attendue sur matelas déclaré.');
    }
    const movements = db.prepare(
      "SELECT COUNT(*) AS n FROM coupe_roll_movements WHERE roll_id = ? "
      + "AND movement_type = 'consommation'",
    ).get(roll.id) as { n: number };
    if (movements.n !== 1) {
      throw new Error('Exactement un mouvement de consommation attendu.');
    }
  });

  check('D. Grammage manquant : transfert sans déduction, message dédié', () => {
    const roll = createRoll(db, chef, {
      code: 'R-E18-4', fabricRef: 'JERSEY-?', colorId,
      weightKg: 20, lengthM: 62, widthCm: 180, usableWidthCm: 170,
    });
    const planId = buildPlan(roll.id, 500);
    const result = createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    });
    if (result.fabricConsumedKg !== null || result.fabricKgBasis !== null) {
      throw new Error('Sans grammage, aucune estimation ne doit être déduite.');
    }
    const movements = db.prepare(
      "SELECT COUNT(*) AS n FROM coupe_roll_movements WHERE roll_id = ? "
      + "AND movement_type = 'consommation'",
    ).get(roll.id) as { n: number };
    if (movements.n !== 0) throw new Error('Débit sans grammage interdit.');
  });

  check('D. Poids restant insuffisant : refus 409, rouleau intact', () => {
    const roll = createRoll(db, chef, {
      code: 'R-E18-5', fabricRef: 'JERSEY-180', colorId,
      weightKg: 9, lengthM: 27.8, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    db.prepare('UPDATE coupe_rolls SET remaining_weight_kg = 0.5 WHERE id = ?')
      .run(roll.id);
    const planId = buildPlan(roll.id, 500);
    expectServiceError(() => createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    }), 409, 'insuffisant');
    const after = (db.prepare('SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?')
      .get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg;
    if (after !== 0.5) throw new Error('Le rouleau a été modifié malgré le refus.');
  });

  // ── Test C (2) : bascule vers l'historique de placement validé ─────
  check('C. Prévisionnel : bascule vers l’historique de placement validé', () => {
    for (let index = 0; index < 3; index += 1) {
      const roll = createRoll(db, chef, {
        code: `R-E18-H${index}`, fabricRef: 'JERSEY-180', colorId,
        weightKg: 20, lengthM: 62, widthCm: 180, usableWidthCm: 170,
        grammageGm2: 180,
      });
      buildPlan(roll.id, 500);
    }
    const estimate = estimateFabricForProduct(db, tshirt.productId, sizeM.id, {
      qty: 12, grammageGm2: 180, usableWidthCm: 170,
    });
    if (estimate.method !== 'historique_placement') {
      throw new Error(`Méthode attendue historique_placement, obtenu ${estimate.method}`);
    }
    if (!estimate.reliable || estimate.historySample < 3) {
      throw new Error('Échantillon historique attendu ≥ 3.');
    }
    if (estimate.estimatedAreaM2 === null
      || estimate.estimatedAreaM2 <= estimate.sizes[0].netAreaM2 * 12 * 0.9) {
      throw new Error('Surface estimée incohérente avec l’efficacité.');
    }
    if (estimate.estimatedKg === null || estimate.estimatedKg <= 0
      || estimate.estimatedLengthM === null || estimate.estimatedLengthM <= 0) {
      throw new Error('Kg et mètres attendus avec grammage et largeur fournis.');
    }
  });

  check('C. Prévisionnel : produit ou taille sans pièces → erreur explicite', () => {
    expectServiceError(() => estimateFabricForProduct(
      db, 999999, sizeM.id, { qty: 1 },
    ), 404, 'Produit introuvable');
  });
}
