/**
 * Tests de la correction « poids et métrage des rouleaux » (phase 3).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture des 12 scénarios obligatoires de la validation :
 *  1. consommation sur largeur NOMINALE 180 (6,912 kg, 4 m × 6 couches,
 *     160 g/m²) — la largeur utile 170 ne doit plus être utilisée ;
 *  2. rouleau cohérent 20 kg / 78,125 m / 1,60 m / 160 g/m² ;
 *  3. rouleau incohérent 12 kg / 4 m / 180 cm / 160 g/m² → refus ;
 *  4. rouleau suivi uniquement en kg (sans métrage) : gestion légitime ;
 *  5. rouleau en mètres avec conversion fiable : décrément kg ET m
 *     cohérents, même transaction, jamais négatifs ;
 *  6. métrage inconnu/non fiable : jamais inventé au transfert ;
 *  7. longueur restante insuffisante à la création d'un plan ;
 *  8. épuisement par correction du poids quand remaining_qty est NULL ;
 *  9. double validation d'un transfert : un seul débit ;
 * 10. aucun poids ni longueur négatif ;
 * 11. régression T-shirt : 2,42352 → 2,7143424 kg ;
 * 12. non-régression historique : assurée par l'agrégateur complet
 *     (npm run test:cutting) — aucune donnée réelle n'est utilisée ici.
 * Toutes les scénarios mutatifs utilisent une base isolée (createTestDb).
 */

import { ServiceError } from '../src/server/api/service-error';
import { createRoll, updateRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import { adjustRoll, setRollStatus } from '../src/server/cutting/roll-ops';
import {
  resolveFabricConsumption, tshirtTheoreticalKg,
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

export function runCuttingWeightV2Tests(check: (label: string, fn: () => void) => void): void {
  // ── 1. Largeur nominale 180 contre largeur utile 170 ───────────────
  check('1. Consommation sur largeur NOMINALE : 6,912 kg (matelas 400 cm × 6, 160 g/m²)', () => {
    const engine = resolveFabricConsumption({
      markerLengthCm: 380, matelasLengthCm: 400, layers: 6,
      widthCm: 180, grammageGm2: 160,
    });
    if (engine.fabricKg === null || Math.abs(engine.fabricKg - 6.912) > 1e-9) {
      throw new Error(`Attendu 6,912 kg, obtenu ${engine.fabricKg}`);
    }
    // Sans largeur nominale : AUCUNE déduction, jamais la largeur utile.
    const noWidth = resolveFabricConsumption({
      markerLengthCm: 380, matelasLengthCm: 400, layers: 6,
      widthCm: null, grammageGm2: 160,
    });
    if (noWidth.fabricKg !== null || noWidth.unavailableReason === null) {
      throw new Error('Largeur nominale absente : la déduction doit être refusée avec cause.');
    }
    if (!noWidth.unavailableReason.includes('Largeur nominale')) {
      throw new Error(`Cause inattendue : ${noWidth.unavailableReason}`);
    }
  });

  // ── 11. Régression T-shirt (avant les scénarios mutatifs) ──────────
  check('11. Régression T-shirt : 2,42352 kg nets → 2,7143424 kg après 12 %', () => {
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
  });

  // ── Scénarios mutatifs : base isolée ───────────────────────────────
  const { db, admin, chef, couture, colorId } = createTestDb('cut-weightv2-');
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
  const buildPlan = (rollId: number, matelasLengthCm: number, layers = 2): number => {
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId, tableId: table1,
      layers, gapCm: 1, matelasLengthCm, qty: 1,
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
  const rollState = (rollId: number): {
    remaining_weight_kg: number | null; remaining_qty: number | null; status: string;
  } => db.prepare(
    'SELECT remaining_weight_kg, remaining_qty, status FROM coupe_rolls WHERE id = ?',
  ).get(rollId) as {
    remaining_weight_kg: number | null; remaining_qty: number | null; status: string;
  };
  const consumptionCount = (rollId: number): number => (db.prepare(
    "SELECT COUNT(*) AS n FROM coupe_roll_movements "
    + "WHERE roll_id = ? AND movement_type = 'consommation'",
  ).get(rollId) as { n: number }).n;

  // ── 2. Rouleau cohérent ────────────────────────────────────────────
  check('2. Rouleau cohérent 20 kg / 78,125 m / 1,60 m / 160 g/m² accepté', () => {
    const roll = createRoll(db, chef, {
      code: 'R-W2-COH', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 78.125, widthCm: 160, usableWidthCm: 150,
      grammageGm2: 160,
    });
    const row = db.prepare(
      'SELECT qty_unit, status FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { qty_unit: string; status: string };
    if (row.qty_unit !== 'm' || row.status !== 'disponible') {
      throw new Error(`Rouleau inattendu : ${row.qty_unit} / ${row.status}`);
    }
  });

  // ── 3. Rouleau incohérent refusé (création ET modification) ────────
  check('3. Rouleau incohérent 12 kg / 4 m / 180 cm / 160 g/m² refusé avec explication', () => {
    expectServiceError(() => createRoll(db, chef, {
      code: 'R-W3-INC', fabricRef: 'JERSEY-160', colorId,
      weightKg: 12, lengthM: 4, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    }), 400, 'Incohérence');
    expectServiceError(() => createRoll(db, chef, {
      code: 'R-W3-INC', fabricRef: 'JERSEY-160', colorId,
      weightKg: 12, lengthM: 4, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    }), 400, 'longueur attendue');
    // Modification : même contrôle sur les valeurs combinées.
    const roll = createRoll(db, chef, {
      code: 'R-W3-UPD', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    expectServiceError(() => updateRoll(db, chef, {
      rollId: roll.id, grammageGm2: 260,
    }), 400, 'Incohérence');
  });

  // ── 4. Rouleau suivi uniquement en kg ──────────────────────────────
  check('4. Rouleau en kg seul : création, modification légitime, longueur refusée', () => {
    const roll = createRoll(db, chef, {
      code: 'R-W4-KG', fabricRef: 'JERSEY-KG', colorId, weightKg: 15,
    });
    if (roll.lengthM !== null) {
      throw new Error(`Suivi kg attendu, longueur obtenue : ${String(roll.lengthM)}`);
    }
    const updated = updateRoll(db, chef, {
      rollId: roll.id, fabricRef: 'JERSEY-KG-V2', colorId: null,
    });
    if (updated.fabricRef !== 'JERSEY-KG-V2') {
      throw new Error('Modification légitime d\'un rouleau en kg refusée à tort.');
    }
    expectServiceError(() => updateRoll(db, chef, {
      rollId: roll.id, lengthM: 50,
    }), 400, 'suivi en kilogrammes');
    expectServiceError(() => createRoll(db, chef, {
      code: 'R-W4-KG2', fabricRef: 'JERSEY-KG', colorId, weightKg: 15, lengthM: 0,
    }), 400, 'positive');
  });

  // ── 5 + 9. Transfert : décrément kg ET m, même transaction, doublon ─
  check('5. Transfert fiable : kg et m décrémentés ensemble, cohérents, non négatifs', () => {
    const roll = createRoll(db, chef, {
      code: 'R-W5-TRF', fabricRef: 'JERSEY-160', colorId,
      // 20 kg à 160 g/m² sur 180 cm → 69,444 m.
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    const planId = buildPlan(roll.id, 400, 6);
    const result = createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    });
    if (result.fabricConsumedKg === null
      || Math.abs(result.fabricConsumedKg - 6.912) > 1e-9) {
      throw new Error(`Consommation attendue 6,912 kg, obtenu ${result.fabricConsumedKg}`);
    }
    const after = rollState(roll.id);
    if (Math.abs((after.remaining_weight_kg ?? -1) - (20 - 6.912)) > 1e-9) {
      throw new Error(`Poids restant attendu 13,088 kg, obtenu ${after.remaining_weight_kg}`);
    }
    // Métrage : 6,912 kg → 24 m (160 g/m², 1,80 m). 69,444 − 24 = 45,444.
    if (after.remaining_qty === null
      || Math.abs(after.remaining_qty - (69.444 - 24)) > 1e-6) {
      throw new Error(`Métrage restant attendu 45,444 m, obtenu ${after.remaining_qty}`);
    }
    if (consumptionCount(roll.id) !== 1) {
      throw new Error('Un seul mouvement de consommation attendu.');
    }
    // 9. Double validation : refus, aucun second débit.
    expectServiceError(() => createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    }), 409, 'doublon');
    if (consumptionCount(roll.id) !== 1) {
      throw new Error('Un second débit a été créé (doublon).');
    }
  });

  // ── 6. Métrage inconnu : jamais inventé ────────────────────────────
  check('6. Métrage inconnu : débit kg sans inventer de mètres ; sans grammage, cause explicite', () => {
    // a. Rouleau en kg AVEC grammage et largeur : kg déduits, mètres NULL.
    const kgRoll = createRoll(db, chef, {
      code: 'R-W6-KG', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, widthCm: 180, usableWidthCm: 170, grammageGm2: 160,
    });
    const planA = buildPlan(kgRoll.id, 400, 6);
    const resultA = createCutTransfer(db, chef, {
      planId: planA, cutPieces, confirmCut: true,
    });
    if (resultA.fabricConsumedKg === null
      || Math.abs(resultA.fabricConsumedKg - 6.912) > 1e-9) {
      throw new Error(`Débit kg attendu 6,912, obtenu ${resultA.fabricConsumedKg}`);
    }
    const afterA = rollState(kgRoll.id);
    if (Math.abs((afterA.remaining_weight_kg ?? -1) - 13.088) > 1e-9) {
      throw new Error(`Poids restant attendu 13,088, obtenu ${afterA.remaining_weight_kg}`);
    }
    if (afterA.remaining_qty !== null) {
      throw new Error('Le métrage d\'un rouleau en kg ne doit pas être inventé.');
    }
    // b. Rouleau en m SANS grammage : rien n'est déduit, cause expliquée.
    const noGsmRoll = createRoll(db, chef, {
      code: 'R-W6-NG', fabricRef: 'JERSEY-?', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
    });
    const planB = buildPlan(noGsmRoll.id, 400, 6);
    const resultB = createCutTransfer(db, chef, {
      planId: planB, cutPieces, confirmCut: true,
    });
    if (resultB.fabricConsumedKg !== null
      || (resultB.fabricKgUnavailableReason ?? '').includes('undefined')) {
      throw new Error('Sans grammage : aucune déduction, cause explicite attendue.');
    }
    if (!resultB.fabricKgUnavailableReason?.includes('Grammage')) {
      throw new Error(`Cause attendue « Grammage », obtenu : ${resultB.fabricKgUnavailableReason}`);
    }
    if (rollState(noGsmRoll.id).remaining_qty === null
      || Math.abs((rollState(noGsmRoll.id).remaining_qty ?? 0) - 69.444) > 1e-9) {
      throw new Error('Le métrage ne doit pas bouger sans déduction kg.');
    }
  });

  // ── 7. Longueur restante insuffisante à la création du plan ───────
  check('7. Plan refusé si matelas × couches > métrage RESTANT ; rouleau en kg non bloqué', () => {
    const roll = createRoll(db, chef, {
      code: 'R-W7-SHORT', fabricRef: 'JERSEY-1111', colorId,
      // Cohérent : 20 kg / 10 m / 180 cm → implicite ≈ 1111,1 g/m².
      weightKg: 20, lengthM: 10, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 1111.1,
    });
    expectServiceError(() => buildPlan(roll.id, 550, 2), 400,
      'longueur disponible du rouleau');
    // Dans la limite : OK (800 cm × 2 couches ≤ 10 m).
    buildPlan(roll.id, 400, 2);
    // Rouleau en kg : pas de longueur certaine → seule la table limite.
    const kgRoll = createRoll(db, chef, {
      code: 'R-W7-KG', fabricRef: 'JERSEY-KG', colorId, weightKg: 15,
    });
    buildPlan(kgRoll.id, 550, 2);
  });

  // ── 8 + 10. Épuisement par correction, contradictions, négatifs ────
  check('8. Épuisement par correction du poids (métrage NULL), contradictions refusées', () => {
    // a. Suivi kg seul : poids à zéro → épuisé, même sans métrage.
    const kgRoll = createRoll(db, chef, {
      code: 'R-W8-KG0', fabricRef: 'JERSEY-KG', colorId, weightKg: 15,
    });
    adjustRoll(db, chef, {
      rollId: kgRoll.id, newRemainingKg: 0, reason: 'Relevé physique : rouleau épuisé',
    });
    if (rollState(kgRoll.id).status !== 'epuise') {
      throw new Error('Rouleau en kg à zéro doit passer « epuise ».');
    }
    // b. Métrage restant > 0 avec poids nul : contradiction explicite.
    const mRoll = createRoll(db, chef, {
      code: 'R-W8-CTR', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    db.prepare('UPDATE coupe_rolls SET remaining_qty = 5 WHERE id = ?').run(mRoll.id);
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: mRoll.id, newRemainingKg: 0, reason: 'Test contradiction',
    }), 409, 'contradictoires');
    // c. Poids négatif refusé (10).
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: mRoll.id, newRemainingKg: -1, reason: 'Test négatif',
    }), 400);
    // d. Poids restant > initial refusé.
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: mRoll.id, newRemainingKg: 25, reason: 'Test dépassement',
    }), 400, 'initial');
    // e. Correction poids à zéro avec métrage corrigé dans la même passe.
    const mRoll2 = createRoll(db, chef, {
      code: 'R-W8-M0', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    adjustRoll(db, chef, {
      rollId: mRoll2.id, newRemainingKg: 0, newRemainingM: 0,
      reason: 'Relevé physique : épuisé',
    });
    if (rollState(mRoll2.id).status !== 'epuise') {
      throw new Error('Rouleau épuisé (poids et métrage à zéro) attendu.');
    }
  });

  // ── 10. Aucun poids ni métrage négatif après transfert limite ──────
  check('10. Dépassement de métrage refusé ; clamp à zéro sans négatif', () => {
    // a. Métrage restant insuffisant au transfert (données modifiées
    //    entre la création du plan et le transfert) : refus 409, intact.
    //    30 kg / 24 m / 180 cm → implicite = 30000/43,2 ≈ 694,4 g/m².
    const short = createRoll(db, chef, {
      code: 'R-W10-SHORT', fabricRef: 'JERSEY-694', colorId,
      weightKg: 30, lengthM: 24, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 694.4,
    });
    // Le plan passe à la limite exacte (400 cm × 6 = 24 m).
    const planShortId = buildPlan(short.id, 400, 6);
    // Dérive externe : le restant descend sous le besoin (23,999 m).
    db.prepare('UPDATE coupe_rolls SET remaining_qty = 23.999 WHERE id = ?').run(short.id);
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: planShortId, cutPieces, confirmCut: true,
    }), 409, 'Longueur du rouleau insuffisante');
    if (Math.abs((rollState(short.id).remaining_qty ?? 0) - 23.999) > 1e-9) {
      throw new Error('Le métrage a bougé malgré le refus.');
    }
    // b. Consommation exacte : clamp à zéro, jamais négatif, épuisé.
    //    Cohérent : 9,6 kg / 24 m / 180 cm → implicite ≈ 222,2 g/m².
    const exact = createRoll(db, chef, {
      code: 'R-W10-EXACT', fabricRef: 'JERSEY-222', colorId,
      weightKg: 9.6, lengthM: 24, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 222.2,
    });
    // Restants ajustés exactement au besoin du plan (400 × 6 couches).
    const exactKg = (6 * 400 * 180 / 10000) * 222.2 / 1000;
    db.prepare('UPDATE coupe_rolls SET remaining_weight_kg = ?, remaining_qty = 24 WHERE id = ?')
      .run(exactKg, exact.id);
    const resultExact = createCutTransfer(db, chef, {
      planId: buildPlan(exact.id, 400, 6), cutPieces, confirmCut: true,
    });
    if (resultExact.fabricConsumedKg === null) throw new Error('Débit attendu.');
    const afterExact = rollState(exact.id);
    if ((afterExact.remaining_weight_kg ?? 1) < 0
      || (afterExact.remaining_qty ?? 0) < 0) {
      throw new Error('Valeur négative détectée après consommation exacte.');
    }
    if ((afterExact.remaining_weight_kg ?? 1) > 0.001
      || (afterExact.remaining_qty ?? 1) > 0.001) {
      throw new Error(`Clamp à zéro attendu, obtenu ${afterExact.remaining_weight_kg} kg / ${afterExact.remaining_qty} m`);
    }
    if (afterExact.status !== 'epuise') {
      throw new Error('Consommation exacte : statut « epuise » attendu.');
    }
  });

  // ── 12. Garde-fous de non-régression ───────────────────────────────
  check('12. Non-régression : statuts rouleau, immuabilité plan et anomalie matelas intacts', () => {
    // Le statut du rouleau reste guardien de la création de plan
    // (plusieurs plans peuvent coexister sur un même rouleau).
    const roll = createRoll(db, chef, {
      code: 'R-W12-RES', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    const planId = buildPlan(roll.id, 400, 2);
    setRollStatus(db, chef, {
      rollId: roll.id, status: 'bloque', reason: 'Réserve qualité',
    });
    expectServiceError(() => createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 2, gapCm: 1, matelasLengthCm: 400, qty: 1,
    }), 409);
    setRollStatus(db, chef, {
      rollId: roll.id, status: 'disponible', reason: 'Retour de réserve',
    });
    // Anomalie occupé > matelas : toujours bloquante au transfert.
    db.exec('DROP TRIGGER protect_validated_plan');
    try {
      db.prepare('UPDATE marker_plans SET matelas_length_cm = 50 WHERE id = ?')
        .run(planId);
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
    expectServiceError(() => createCutTransfer(db, chef, {
      planId, cutPieces, confirmCut: true,
    }), 409, 'Anomalie de plan');
  });
}
