/**
 * Tests du calculateur ORDNUR (phase 4).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture :
 *  1. régression C12 : 2,42352 kg nets → 2,7143424 après 12 % ;
 *  2. conversion cm/pouces exacte (× 2,54) ;
 *  3. wastage appliqué UNE seule fois ;
 *  4. Single size / Size ratio (lignes qty 0 ignorées) ;
 *  5. coût prix/kg + devise ;
 *  6. formules par famille : garde anti-abus de la formule T-shirt,
 *     panneaux explicites, non-dérive des libellés vs FAMILY_SPECS ;
 *  7. les 4 sources de consommation (base ISOLÉE) : formule, placement
 *     réel, disponible physique, consommation enregistrée ;
 *  8. non-régression historique : assurée par l'agrégateur complet ;
 *  9. parcours Atelier : estimate.fabric applique la formule de
 *     référence (C12 tshirt, panneaux par famille, repli explicite) ;
 * 10. sémantique poitrine : demi-largeur à plat, facteur 2 une fois ;
 * 11-14. parcours « Valider le plan » : calcul automatique serveur
 *     (référence ORDNUR, idempotence double clic, grammage absent,
 *     wastage 0 % et invalide), stock et mouvements inchangés.
 * Toutes les scénarios mutatifs utilisent une base isolée (createTestDb).
 */

import { ServiceError } from '../src/server/api/service-error';
import {
  ordnurTshirtConsumption,
  estimateTshirtCommand,
  familyFormulaKg,
  FAMILY_FORMULA_NAMES,
  FAMILY_PANELS,
} from '../src/lib/cutting/consumption';
import {
  tshirtTheoreticalKg, estimateFabricForProduct,
} from '../src/server/cutting/fabric-estimate';
import { ruleMeasurementLabels } from '../src/server/cutting/pattern-rules';
import {
  createRoll,
} from '../src/server/cutting/rolls';
import {
  saveFiche, validateFiche,
} from '../src/server/cutting/fiches';
import {
  generateRevision,
} from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import { rollConsumptionSources } from '../src/server/cutting/roll-ops';
import { listTables } from '../src/server/cutting/tables';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';
import { expect, expectClose, throwsService } from './test-tools';

/** Cas de référence ORDNUR : crew neck L, 180 GSM. */
const L_ROW = {
  label: 'L',
  bodyLength: 72,
  halfChest: 52,
  sleeveLength: 20,
  qty: 12,
};

const TSHIRT_MESURES = {
  'Longueur totale': 72,
  'Poitrine à plat': 52,
  'Longueur manche': 20,
};

export function runCuttingOrdnurTests(check: (label: string, fn: () => void) => void): void {
  // ── 1. Régression C12 ──────────────────────────────────────────────
  check('ORDNUR 1. C12 : 2,42352 kg nets/douzaine → 2,7143424 après 12 % de wastage', () => {
    const net = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    });
    expectClose(net.netKgPerDozen, 2.42352, 1e-9, 'net/douzaine');
    expectClose(net.netKgTotal, 2.42352, 1e-9, 'net total 12 pièces');
    const wasted = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expectClose(wasted.kgWithWastage, 2.7143424, 1e-9, 'avec wastage 12 %');
    expectClose(wasted.netKgTotal, 2.42352, 1e-9, 'le net ne change pas');
    // Parité avec la fonction de référence historique.
    const legacy = tshirtTheoreticalKg({
      bodyLengthCm: 72, chestHalfCm: 52, sleeveLengthCm: 20,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, grammageGm2: 180,
    });
    expectClose(net.netKgPerDozen, legacy.netKgPerDozen, 1e-12, 'parité C12');
  });

  // ── 2. Conversion d'unités ─────────────────────────────────────────
  check('ORDNUR 2. Saisie en pouces : résultats identiques au cm (× 2,54 exact)', () => {
    const inches = ordnurTshirtConsumption({
      unit: 'in',
      rows: [{
        label: 'L (in)',
        bodyLength: 72 / 2.54,
        halfChest: 52 / 2.54,
        sleeveLength: 20 / 2.54,
        qty: 12,
      }],
      grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    const cm = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expectClose(inches.kgWithWastage, cm.kgWithWastage, 1e-9, 'pouces ≡ cm');
    expectClose(inches.netKgPerDozen, cm.netKgPerDozen, 1e-9, 'par douzaine');
    // Unité inconnue : refus explicite, jamais de conversion implicite.
    throwsService(() => ordnurTshirtConsumption({
      unit: 'yards' as never, rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    }), 400);
  });

  // ── 3. Wastage une seule fois ──────────────────────────────────────
  check('ORDNUR 3. Wastage appliqué UNE fois (jamais composé), bornes 0–100', () => {
    const base = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    });
    const once = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 15,
    });
    expectClose(once.kgWithWastage, base.kgWithWastage * 1.15, 1e-12, '× 1,15 exact');
    expectClose(once.netKgTotal * 1.15, once.kgWithWastage, 1e-12, 'une application');
    // Le wastage des lignes et du total sont le même facteur (pas 1,15²).
    const sizeOnce = once.sizes[0];
    expectClose(sizeOnce.kgWithWastage, sizeOnce.netKgPerPiece * 12 * 1.15, 1e-12, 'ligne');
    throwsService(() => ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 101,
    }), 400);
    throwsService(() => ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: -1,
    }), 400);
  });

  // ── 4. Single size / Size ratio ────────────────────────────────────
  check('ORDNUR 4. Size ratio : total = somme des tailles, lignes qty 0 ignorées', () => {
    const ratio = ordnurTshirtConsumption({
      unit: 'cm',
      rows: [
        { label: 'S', bodyLength: 68, halfChest: 50, sleeveLength: 19, qty: 0 },
        { label: 'M', bodyLength: 70, halfChest: 51, sleeveLength: 19.5, qty: 100 },
        { label: 'L', bodyLength: 72, halfChest: 52, sleeveLength: 20, qty: 200 },
      ],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expect(ratio.totalPieces === 300, `total 300 attendu, obtenu ${ratio.totalPieces}`);
    expect(ratio.sizes.length === 2, 'la ligne qty 0 est ignorée');
    const sumSizes = ratio.sizes.reduce((sum, size) => sum + size.kgWithWastage, 0);
    expectClose(ratio.kgWithWastage, sumSizes, 1e-9, 'total = somme des lignes');
    const m = ratio.sizes.find((size) => size.label === 'M');
    const l = ratio.sizes.find((size) => size.label === 'L');
    expect(!!m && !!l, 'contributions M et L présentes');
    // Chaque ligne isolée recalcule exactement la même contribution.
    const lAlone = ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ label: 'L', bodyLength: 72, halfChest: 52, sleeveLength: 20, qty: 200 }],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expectClose(l?.kgWithWastage ?? -1, lAlone.kgWithWastage, 1e-9, 'ligne L isolée');
    expect(ratio.netKgPerDozen === (m?.netKgPerDozen ?? -1),
      'référence = première taille active (M)');
    // Aucune pièce exploitable → refus.
    throwsService(() => ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ label: 'S', bodyLength: 68, halfChest: 50, sleeveLength: 19, qty: 0 }],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    }), 400);
    throwsService(() => ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ label: 'M', bodyLength: 70, halfChest: 51, sleeveLength: 19.5, qty: -5 }],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    }), 400);
  });

  // ── 5. Coût prix/kg + devise ───────────────────────────────────────
  check('ORDNUR 5. Coût = prix/kg × kg (pièce, douzaine, commande) ; devise transmise', () => {
    const costed = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
      pricePerKg: 5.5, currency: 'USD',
    });
    expect(costed.currency === 'USD', 'devise transmise telle quelle');
    expect(costed.pricePerKg === 5.5, 'prix/kg conservé');
    const costTotal = costed.costTotal;
    const costPerPiece = costed.costPerPiece;
    const costPerDozen = costed.costPerDozen;
    expect(costTotal !== null && costPerPiece !== null && costPerDozen !== null,
      'prix fourni : coûts calculés');
    expectClose(costTotal, 2.7143424 * 5.5, 1e-9, 'coût total');
    expectClose(costPerPiece, costTotal / 12, 1e-9, 'coût par pièce');
    expectClose(costPerDozen, costTotal, 1e-9, 'coût/douzaine (12 pièces)');
    // Sans prix : coûts null, poids toujours calculés.
    const unpriced = ordnurTshirtConsumption({
      unit: 'cm', rows: [L_ROW], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expect(unpriced.costTotal === null && unpriced.costPerPiece === null
      && unpriced.costPerDozen === null, 'sans prix : coûts indisponibles');
    expectClose(unpriced.kgWithWastage, 2.7143424, 1e-9, 'poids inchangé');
  });

  // ── 6. Formules par famille (garde anti-abus) ──────────────────────
  check('ORDNUR 6a. tshirt → C12 ; autres familles → leurs propres panneaux', () => {
    const tshirt = familyFormulaKg('tshirt', TSHIRT_MESURES, 180);
    expect(tshirt.formula === 'C12', 'tshirt utilise C12');
    expectClose(tshirt.kgPerDozen, 2.42352, 1e-9, 'C12 inchangé');
    // Polo : panneaux explicites ≠ C12 à mesures égales.
    const polo = familyFormulaKg('polo', {
      'Poitrine à plat': 52, 'Longueur totale': 72, 'Ouverture manche': 18,
      'Longueur manche': 20, 'Encolure': 18, 'Col': 6,
      'Largeur patte': 3, 'Longueur patte': 20,
    }, 180);
    expect(polo.formula === 'panneaux', 'polo : formule panneaux dédiée');
    expectClose(
      polo.kgPerPiece,
      polo.panels.reduce((sum, panel) => sum + panel.kg, 0),
      1e-12, 'polo = somme des panneaux',
    );
    // Vérification manuelle d'un panneau : devant+dos = 2×52×72 cm².
    const corps = polo.panels[0];
    expectClose(corps.areaM2, (2 * 52 * 72) / 10000, 1e-12, 'aire devant+dos');
    expectClose(corps.kg, ((2 * 52 * 72) / 10000) * 0.180, 1e-12, 'kg devant+dos');
    expect(Math.abs(polo.kgPerDozen - 2.42352) > 0.01,
      'polo ≠ tshirt : la formule C12 n\'est pas recyclée');
    // Short / jogging : 4 jambes + ceinture, mesures identiques → même résultat.
    const shortMesures = {
      'Hanches': 50, 'Longueur extérieure': 40, 'Taille détendue': 40, 'Hauteur ceinture': 4,
    };
    const short = familyFormulaKg('short', shortMesures, 200);
    const jogging = familyFormulaKg('jogging', shortMesures, 200);
    expectClose(short.kgPerPiece, jogging.kgPerPiece, 1e-12, 'short ≡ jogging (mêmes libellés)');
    expectClose(
      short.kgPerPiece,
      ((4 * 50 * 40 + 40 * 4) / 10000) * 0.2,
      1e-9, 'short : 4 jambes + ceinture à la main',
    );
    // Ensemble : haut + short, panneaux dédiés (libellés préfixés).
    const ensemble = familyFormulaKg('ensemble', {
      'Haut : poitrine': 52, 'Haut : longueur': 70, 'Haut : ouverture manche': 18,
      'Haut : manche': 20, 'Haut : encolure': 18, 'Hauteur col': 6,
      'Short : hanches': 48, 'Short : longueur': 38, 'Short : taille': 40,
      'Short : ceinture': 4,
    }, 160);
    expect(ensemble.panels.length === 5, 'ensemble : 5 panneaux (haut + short)');
    expectClose(
      ensemble.kgPerPiece,
      ensemble.panels.reduce((sum, panel) => sum + panel.kg, 0),
      1e-12, 'ensemble = somme des panneaux',
    );
  });

  check('ORDNUR 6b. Garde : C12 refusée hors tshirt, mesures manquantes listées, libellés alignés', () => {
    // Famille inconnue : refus explicite (jamais la formule T-shirt).
    throwsService(() => familyFormulaKg('robe', TSHIRT_MESURES, 180), 400);
    // Famille sans formule dédiée = jamais de valeur inventée.
    throwsService(() => familyFormulaKg('', TSHIRT_MESURES, 180), 400);
    // Mesures manquantes : liste complète, jamais de défaut caché.
    try {
      familyFormulaKg('short', { 'Hanches': 50 }, 200);
      throw new Error('Erreur attendue non levée.');
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      expect(error.message.includes('Longueur extérieure')
        && error.message.includes('Taille détendue')
        && error.message.includes('Hauteur ceinture'),
      `liste des mesures manquantes incomplète : ${error.message}`);
    }
    // Non-dérive : les libellés des panneaux sont ceux des règles R2.
    for (const family of FAMILY_FORMULA_NAMES) {
      const required = ruleMeasurementLabels(family);
      if (family === 'tshirt') {
        for (const label of ['Longueur totale', 'Poitrine à plat', 'Longueur manche']) {
          expect(required.includes(label), `tshirt : ${label} absent des règles R2`);
        }
        continue;
      }
      for (const panel of FAMILY_PANELS[family as Exclude<typeof family, 'tshirt'>]) {
        expect(required.includes(panel.widthLabel),
          `${family} : ${panel.widthLabel} absent des règles R2`);
        expect(required.includes(panel.heightLabel),
          `${family} : ${panel.heightLabel} absent des règles R2`);
      }
    }
    // Grammage invalide : refus.
    throwsService(() => familyFormulaKg('tshirt', TSHIRT_MESURES, 0), 400);
  });

  // ── 7. Les 4 sources de consommation (base isolée) ─────────────────
  check('ORDNUR 7. Quatre sources étiquetées sur rouleau : formule ≠ placement ≠ physique ≠ enregistrée', () => {
    const { db, admin, chef, colorId } = createTestDb('cut-ordnur-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 70, 'Épaules': 46,
        'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
      .get() as { id: number }).id;
    const pieces = revision.pieces;
    const devant = pieces.find((piece) => piece.code === 'devant') as {
      id: number; widthCm: number;
    };
    const roll = createRoll(db, chef, {
      code: 'R-ORD-SRC', fabricRef: 'JERSEY-160', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    // Avant transfert : placement = 0 kg (aucun plan transféré, somme
    // vraie et calculable), enregistrée absente avec cause, physique intact.
    const before = rollConsumptionSources(db, roll.id);
    expect(before.placement.kg === 0 && before.placement.plans === 0,
      'aucun plan transféré : placement à 0 kg (somme vraie), plans = 0');
    expect(before.recorded.kg === null && before.recorded.movements === 0,
      'avant transfert : consommation enregistrée absente avec cause');
    expect(before.recorded.reason !== null, 'cause explicite requise');
    expectClose(before.physical.remainingWeightKg ?? -1, 20, 1e-9, 'physique avant');
    expect(before.physical.alerts.length === 0, 'rouleau cohérent : aucune alerte');
    // Plan 400 cm × 6 couches, placement enregistré, transfert.
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 6, gapCm: 1, matelasLengthCm: 400, qty: 1,
    });
    const dos = pieces.find((piece) => piece.code === 'dos') as { id: number };
    const col = pieces.find((piece) => piece.code === 'col') as { id: number };
    const mancheG = pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
    const mancheD = pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
      { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
      { pieceId: col.id, x: 2, y: 160, rotation: 0 },
      { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
      { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
    ]);
    validatePlan(db, admin, plan.id);
    const transfer = createCutTransfer(db, chef, {
      planId: plan.id,
      cutPieces: [
        { pieceId: devant.id, qty: 2 }, { pieceId: dos.id, qty: 1 },
        { pieceId: mancheG.id, qty: 1 }, { pieceId: mancheD.id, qty: 1 },
        { pieceId: col.id, qty: 1 },
      ],
      confirmCut: true,
    });
    // Après transfert : les sources coexistent, distinctes et cohérentes.
    const after = rollConsumptionSources(db, roll.id);
    expectClose(after.placement.kg ?? -1, 6.912, 1e-9, 'placement réel (matelas déclaré)');
    expect(after.placement.plans === 1, 'un plan transféré compté');
    expectClose(after.recorded.kg ?? -1, transfer.fabricConsumedKg ?? -1, 1e-9,
      'enregistrée = consommation du transfert');
    expectClose(after.physical.remainingWeightKg ?? -1, 20 - 6.912, 1e-9,
      'physique décrémenté');
    expectClose(after.physical.remainingQtyM ?? -1, 69.444 - 24, 1e-6,
      'métrage décrémenté (24 m = 6,912 kg à 160 g/m² sur 180 cm)');
    // L'estimation formule (commande) vit dans le calculateur, hors rouleau :
    const formula = ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ label: 'M', bodyLength: 70, halfChest: 51, sleeveLength: 22, qty: 120 }],
      grammageGm2: 160, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    });
    expect(formula.netKgTotal > 0 && formula.netKgTotal !== after.placement.kg,
      'formule (commande) ≠ placement (matelas) : sources distinctes');
    // Aucune valeur négative dans les sources.
    expect((after.physical.remainingWeightKg ?? 0) >= 0
      && (after.physical.remainingQtyM ?? 0) >= 0
      && (after.placement.kg ?? 0) >= 0
      && (after.recorded.kg ?? 0) >= 0, 'aucune source négative');
    // Rouleau sans grammage : placement non calculable avec cause.
    const noGsm = createRoll(db, chef, {
      code: 'R-ORD-NG', fabricRef: 'JERSEY-?', colorId,
      weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
    });
    const ngSources = rollConsumptionSources(db, noGsm.id);
    expect(ngSources.placement.kg === null
      && (ngSources.placement.reason ?? '').includes('Grammage'),
    'sans grammage : cause explicite');
  });

  // ── 8. Contrat API Size ratio (phase 4.1) ──────────────────────────
  // Valeurs déterministes : toutes les tailles 70/51/20 cm, 180 g/m²,
  // marges 10/3 → net/douzaine 2,3328 kg, net/pièce 0,1944 kg.
  //   (70+20+10) × (51+3) × 2 × 180 × 12 / 1e7 = 2,3328
  check('ORDNUR 8. API estimate.tshirt-theoretical : rows multi-tailles, rétrocompatibilité, cohérence moteur', () => {
    const ROW = { bodyLength: 70, halfChest: 51, sleeveLength: 20 };
    // 1. Commande multi-tailles, quantités différentes + 2. ligne unique
    // avec quantité donnée + 7. total depuis les lignes + 8. coût depuis
    // le total + 9. pertes une seule fois.
    const multi = estimateTshirtCommand({
      unit: 'cm',
      rows: [
        { label: 'S', ...ROW, qty: 100 },
        { label: 'M', ...ROW, qty: 200 },
        { label: 'L', ...ROW, qty: 100 },
      ],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3,
      wastagePct: 12, pricePerKg: 5,
    });
    expect(multi.totalPieces === 400, `total 400 attendu, obtenu ${multi.totalPieces}`);
    expectClose(multi.netKgPerDozen, 2.3328, 1e-12, 'net/douzaine de référence');
    expectClose(multi.netKgTotal, 0.1944 * 400, 1e-12, 'total net = Σ lignes');
    expectClose(multi.kgWithWastage, 0.1944 * 400 * 1.12, 1e-12, 'pertes UNE fois');
    expectClose(multi.kgWithWastage, multi.netKgTotal * 1.12, 1e-12, 'cohérence wastage');
    expectClose(multi.costTotal ?? -1, 0.1944 * 400 * 1.12 * 5, 1e-9, 'coût = total × prix');
    expectClose(multi.costPerPiece ?? -1, (multi.costTotal ?? 0) / 400, 1e-12, 'coût/pièce');
    expect(multi.sizes?.length === 3, 'trois tailles restituées');
    const m = multi.sizes?.find((size) => size.label === 'M');
    expectClose(m?.kgWithWastage ?? -1, 0.1944 * 200 * 1.12, 1e-12, 'ligne M isolée');
    const sumSizes = multi.sizes?.reduce((sum, size) => sum + size.kgWithWastage, 0) ?? -1;
    expectClose(multi.kgWithWastage, sumSizes, 1e-9, 'Σ tailles = commande');
    // 3. Lignes à quantité zéro ignorées, 4. mesure manquante refusée,
    // 5. quantité négative refusée, 6. tableau vide refusé.
    const withZero = estimateTshirtCommand({
      unit: 'cm',
      rows: [{ label: 'S', ...ROW, qty: 0 }, { label: 'M', ...ROW, qty: 100 }],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    });
    expect(withZero.totalPieces === 100 && withZero.sizes?.length === 1,
      'ligne qty 0 ignorée, les autres calculées');
    try {
      estimateTshirtCommand({
        unit: 'cm',
        rows: [{ label: 'M', halfChest: 51, sleeveLength: 20, qty: 100 }],
        grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
      });
      throw new Error('Erreur attendue non levée.');
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      expect(error.message.includes('M') && error.message.includes('longueur du corps'),
        `mesure manquante non signalée avec le libellé : ${error.message}`);
    }
    throwsService(() => estimateTshirtCommand({
      unit: 'cm',
      rows: [{ label: 'S', ...ROW, qty: -10 }],
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    }), 400);
    throwsService(() => estimateTshirtCommand({
      unit: 'cm', rows: [], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    }), 400);
    throwsService(() => estimateTshirtCommand({
      unit: 'yards', rows: [{ label: 'S', ...ROW, qty: 100 }], grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 0,
    }), 400);
    // 10. Ancien format à ligne unique toujours fonctionnel (défauts
    // historiques : 12 pièces, marges 10/3) + cas de référence C12.
    const legacy = estimateTshirtCommand({
      bodyLengthCm: 72, chestHalfCm: 52, sleeveLengthCm: 20,
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expect(legacy.totalPieces === 12, 'défaut historique : 12 pièces');
    expectClose(legacy.netKgPerDozen, 2.42352, 1e-12, 'C12 net inchangé');
    expectClose(legacy.kgWithWastage, 2.7143424, 1e-12, 'C12 final inchangé');
    expectClose(legacy.kgWithWastage / 12, 0.2261952, 1e-12, 'par pièce inchangé');
    expect(legacy.sizes?.length === 1, 'ligne unique : une taille restituée');
    // Quantité donnée sur une seule taille (ancien format, qty explicite).
    const legacyQty = estimateTshirtCommand({
      bodyLengthCm: 72, chestHalfCm: 52, sleeveLengthCm: 20, totalPieces: 24,
      grammageGm2: 180, lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12,
    });
    expect(legacyQty.totalPieces === 24, 'quantité explicite respectée');
    expectClose(legacyQty.kgWithWastage, 2 * 2.7143424, 1e-12, 'total double avec 24 pièces');
    // Chaînes numériques acceptées (parité avec l'ancien parseNumberInput).
    const stringly = estimateTshirtCommand({
      bodyLengthCm: '72', chestHalfCm: '52', sleeveLengthCm: '20', totalPieces: '12',
      grammageGm2: '180', lengthAllowanceCm: '10', chestAllowanceCm: '3', wastagePct: '12',
    });
    expectClose(stringly.kgWithWastage, 2.7143424, 1e-12, 'chaînes numériques acceptées');
    // 11. Cohérence moteur ↔ contrat API : mêmes entrées → mêmes sorties.
    const engineRows = [
      { label: 'S', ...ROW, qty: 100 },
      { label: 'M', ...ROW, qty: 200 },
      { label: 'L', ...ROW, qty: 100 },
    ];
    const engine = ordnurTshirtConsumption({
      unit: 'cm', rows: engineRows, grammageGm2: 180,
      lengthAllowanceCm: 10, chestAllowanceCm: 3, wastagePct: 12, pricePerKg: 5,
    });
    expectClose(multi.netKgTotal, engine.netKgTotal, 1e-12, 'API ≡ moteur (net)');
    expectClose(multi.kgWithWastage, engine.kgWithWastage, 1e-12, 'API ≡ moteur (wastage)');
    expectClose(multi.costTotal ?? -1, engine.costTotal ?? -1, 1e-12, 'API ≡ moteur (coût)');
    expect(multi.sizes?.every((size, index) => size.label === engine.sizes[index].label
      && Math.abs(size.kgWithWastage - engine.sizes[index].kgWithWastage) < 1e-12) ?? false,
    'API ≡ moteur (détail par taille)');
  });

  // ── 9. Parcours Atelier : estimate.fabric applique la formule de référence ──
  check('ORDNUR 9. Parcours Atelier : estimate.fabric produit les valeurs ORDNUR de référence', () => {
    const { db, admin, chef } = createTestDb('cut-ordnur-fab-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    // Fiche validée avec les mesures EXACTES du cas de référence ORDNUR.
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 72, 'Épaules': 46,
        'Longueur manche': 20, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    // Sans historique de placement : la formule de référence C12 s'applique.
    const est = estimateFabricForProduct(db, tshirt.productId, sizeM.id, {
      qty: 12, grammageGm2: 180, wastagePct: 12,
    });
    expect(est.method === 'theorique_tshirt',
      `méthode attendue theorique_tshirt, obtenu ${est.method}`);
    expect(est.theoretical !== null && est.theoretical.formula === 'C12',
      'détail formule C12 exposé');
    expectClose(est.theoretical?.netKgPerDozen ?? -1, 2.42352, 1e-9,
      'parcours : 2,42352 kg nets/douzaine');
    expectClose(est.estimatedKg ?? -1, 2.7143424, 1e-9,
      'parcours : 2,7143424 kg avec 12 % de wastage appliqué UNE fois');
    // Quantité 1 pièce = consommation par pièce ; 24 pièces = 2 douzaines.
    const est1 = estimateFabricForProduct(db, tshirt.productId, sizeM.id, {
      qty: 1, grammageGm2: 180, wastagePct: 12,
    });
    expectClose(est1.estimatedKg ?? -1, 0.2261952, 1e-9,
      '1 pièce = 0,2261952 kg');
    const est24 = estimateFabricForProduct(db, tshirt.productId, sizeM.id, {
      qty: 24, grammageGm2: 180, wastagePct: 12,
    });
    expectClose(est24.estimatedKg ?? -1, 2 * 2.7143424, 1e-9,
      '24 pièces = deux douzaines');
    // Wastage 0 % : la consommation finale ÉGALE la consommation nette.
    const estNet = estimateFabricForProduct(db, tshirt.productId, sizeM.id, {
      qty: 12, grammageGm2: 180,
    });
    expect(estNet.theoretical?.wastagePct === 0, 'wastage absent = 0 % explicite');
    expectClose(estNet.estimatedKg ?? -1, 2.42352, 1e-9,
      'wastage 0 % : final = net');
    // Grammage absent : repli surfaces_nettes avec cause explicite,
    // aucun kg inventé.
    const noGsm = estimateFabricForProduct(db, tshirt.productId, sizeM.id, { qty: 12 });
    expect(noGsm.method === 'surfaces_nettes',
      'sans grammage : repli surfaces_nettes explicite');
    expect(noGsm.estimatedKg === null, 'sans grammage : aucun kg inventé');
    expect(noGsm.missingData.some((item) => item.includes('Grammage')),
      'cause explicite : grammage manquant signalé');
    // Autre famille : la formule T-shirt n'est PAS recyclée — le polo
    // reçoit sa formule « panneaux » dédiée.
    const polo = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'polo' && item.category === 'adulte',
    );
    if (!polo) throw new Error('Catalogue : Polo adulte introuvable.');
    const sizePolo = polo.sizes[0];
    const fichePolo = validateFiche(db, admin, saveFiche(db, chef, {
      productId: polo.productId, sizeId: sizePolo.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 70, 'Épaules': 46,
        'Longueur manche': 22, 'Ouverture manche': 18, 'Encolure': 18, 'Col': 3,
        'Largeur patte': 3, 'Longueur patte': 12,
      },
    }).id);
    validateRevision(db, admin, generateRevision(db, chef, fichePolo.id).id);
    const estPolo = estimateFabricForProduct(db, polo.productId, sizePolo.id, {
      qty: 12, grammageGm2: 180, wastagePct: 12,
    });
    expect(estPolo.method === 'theorique_famille',
      `polo : méthode theorique_famille, obtenu ${estPolo.method}`);
    expect(estPolo.theoretical?.formula === 'panneaux',
      'polo : formule panneaux dédiée, pas C12');
    // Valeur invalide au niveau parcours : wastage hors bornes refusé
    // (jamais masqué par un résultat à zéro).
    throwsService(() => estimateFabricForProduct(
      db, tshirt.productId, sizeM.id, { qty: 12, grammageGm2: 180, wastagePct: 150 },
    ), 400);
    throwsService(() => estimateFabricForProduct(
      db, tshirt.productId, sizeM.id, { qty: 12, grammageGm2: 180, wastagePct: -5 },
    ), 400);
    // L'estimation est en LECTURE SEULE : aucun mouvement de rouleau.
    const movements = (db.prepare(
      'SELECT COUNT(*) AS n FROM coupe_roll_movements',
    ).get() as { n: number }).n;
    expect(movements === 0, 'aucune écriture dans les rouleaux (estimation pure)');
  });

  // ── 10. Sémantique poitrine : demi-poitrine à plat, jamais le tour ────
  check('ORDNUR 10. La poitrine saisie est une demi-largeur à plat (×2 panneaux, une seule fois)', () => {
    const half = ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ ...L_ROW, halfChest: 52 }],
      grammageGm2: 180, lengthAllowanceCm: 0, chestAllowanceCm: 0, wastagePct: 0,
    });
    const full = ordnurTshirtConsumption({
      unit: 'cm',
      rows: [{ ...L_ROW, halfChest: 104 }],
      grammageGm2: 180, lengthAllowanceCm: 0, chestAllowanceCm: 0, wastagePct: 0,
    });
    expectClose(full.netKgPerDozen, 2 * half.netKgPerDozen, 1e-12,
      'tour complet (104) = 2 × demi-poitrine (52) : facteur 2 appliqué une seule fois');
    // Sans marge, le résultat est exactement (L×P×2×12×GSM)/10⁷ par douzaine.
    expectClose(half.netKgPerDozen, (72 + 20) * 52 * 2 * 12 * 180 / 10_000_000, 1e-9,
      'formule C12 brute sans marges');
  });

  // ── 11-14. Parcours « Valider le plan » : calcul automatique serveur ──
  check('ORDNUR 11. validatePlan calcule et enregistre la consommation ORDNUR de référence', () => {
    const { db, admin, chef, colorId } = createTestDb('cut-ordnur-val-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    const roll = createRoll(db, chef, {
      code: 'R-VAL-1', fabricRef: 'JERSEY-180', colorId,
      weightKg: 15, lengthM: 50, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 72, 'Épaules': 46,
        'Longueur manche': 20, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (listTables(db) as Array<{ nom: string; id: number }>)
      .find((table) => table.nom === 'Table 1');
    if (!table1) throw new Error('Table 1 introuvable.');
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 12, wastagePct: 12,
    });
    const devant = revision.pieces.find((piece) => piece.code === 'devant');
    if (!devant) throw new Error('Pièce devant introuvable.');
    const saved = savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ]);
    if (!saved || saved.status !== 'proposition') {
      throw new Error('Sauvegarde du placement refusée.');
    }
    const movementsBefore = (db.prepare(
      'SELECT COUNT(*) AS n FROM coupe_roll_movements',
    ).get() as { n: number }).n;
    const rollsBefore = (db.prepare(
      'SELECT remaining_weight_kg, remaining_qty FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number; remaining_qty: number });
    const validated = validatePlan(db, admin, plan.id);
    expect(validated.status === 'valide', 'plan validé');
    const t = validated.theoretical;
    expect(t !== null, 'estimation théorique enregistrée avec le plan');
    if (!t) return;
    expect(t.formula === 'C12', `formule C12 attendue, obtenu ${t.formula}`);
    expect(t.family === 'tshirt', 'famille tshirt');
    expect(t.grammageGm2 === 180, 'grammage du rouleau utilisé');
    expect(t.wastagePct === 12, 'wastage du plan utilisé');
    expectClose(t.netKgPerPiece, 0.20196, 1e-9, 'net : 0,20196 kg/pièce');
    expectClose(t.netKgPerPiece * 12, 2.42352, 1e-9,
      'net : 2,42352 kg/douzaine');
    expectClose(t.netKgTotal, 12 * 0.20196, 1e-9,
      'total net = 12 × consommation par pièce');
    expectClose(t.kgWithWastage, 2.7143424, 1e-9,
      'final : 2,7143424 kg après UNE application du wastage');
    expectClose(t.kgWithWastage / 12, 0.2261952, 1e-9,
      'final par pièce : 0,2261952 kg');
    expectClose(t.kgWithWastage, t.netKgTotal * 1.12, 1e-12,
      'wastage appliqué exactement une fois');
    expect(t.sizes.length === 1 && t.sizes[0].garments === 12,
      '12 vêtements pour la taille M (qty 12 × 1 couche)');
    // Aucune écriture de stock, aucun mouvement : l'estimation est pure.
    const movementsAfter = (db.prepare(
      'SELECT COUNT(*) AS n FROM coupe_roll_movements',
    ).get() as { n: number }).n;
    expect(movementsAfter === movementsBefore, 'aucun mouvement créé');
    const rollsAfter = (db.prepare(
      'SELECT remaining_weight_kg, remaining_qty FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number; remaining_qty: number });
    expect(rollsAfter.remaining_weight_kg === rollsBefore.remaining_weight_kg
      && rollsAfter.remaining_qty === rollsBefore.remaining_qty,
    'stock du rouleau inchangé');
  });

  check('ORDNUR 12. Double validation : idempotence, aucun recalcul', () => {
    const { db, admin, chef, colorId } = createTestDb('cut-ordnur-dbl-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    const roll = createRoll(db, chef, {
      code: 'R-DBL-1', fabricRef: 'JERSEY-180', colorId,
      weightKg: 15, lengthM: 50, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 72, 'Épaules': 46,
        'Longueur manche': 20, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (listTables(db) as Array<{ nom: string; id: number }>)
      .find((table) => table.nom === 'Table 1');
    if (!table1) throw new Error('Table 1 introuvable.');
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1, wastagePct: 12,
    });
    const devant = revision.pieces.find((piece) => piece.code === 'devant');
    if (!devant) throw new Error('Pièce devant introuvable.');
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ]);
    const first = validatePlan(db, admin, plan.id);
    const firstAt = first.theoretical?.computedAt ?? '';
    // Double clic / nouvelle tentative de requête : même plan, même
    // estimation, aucun recalcul (computedAt inchangé).
    const second = validatePlan(db, admin, plan.id);
    expect(second.status === 'valide', 'plan toujours validé');
    expect(second.theoretical?.computedAt === firstAt,
      'aucun recalcul : computedAt identique');
    expectClose(second.theoretical?.kgWithWastage ?? -1,
      first.theoretical?.kgWithWastage ?? -2, 0,
      'même valeur théorique');
  });

  check('ORDNUR 13. Grammage absent : validation géométrique OK, estimation refusée avec cause explicite', () => {
    const { db, admin, chef, colorId } = createTestDb('cut-ordnur-nog-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    // Rouleau sans grammage (suivi kg seul) : jamais de kg inventé.
    const roll = createRoll(db, chef, {
      code: 'R-NOG-1', fabricRef: 'JERSEY-?', colorId,
      weightKg: 12, lengthM: 4, widthCm: 180, usableWidthCm: 170,
    });
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 72, 'Épaules': 46,
        'Longueur manche': 20, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (listTables(db) as Array<{ nom: string; id: number }>)
      .find((table) => table.nom === 'Table 1');
    if (!table1) throw new Error('Table 1 introuvable.');
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 300, qty: 12,
    });
    const devant = revision.pieces.find((piece) => piece.code === 'devant');
    if (!devant) throw new Error('Pièce devant introuvable.');
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ]);
    const validated = validatePlan(db, admin, plan.id);
    expect(validated.status === 'valide',
      'le plan reste validable (gestion légitime sans grammage)');
    expect(validated.theoretical === null, 'aucune estimation inventée');
    expect((validated.theoreticalUnavailable ?? '').includes('Grammage'),
      `cause explicite : ${validated.theoreticalUnavailable}`);
  });

  check('ORDNUR 14. Wastage 0 % au parcours : la consommation finale égale la consommation nette', () => {
    const { db, admin, chef, colorId } = createTestDb('cut-ordnur-w0-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
    const roll = createRoll(db, chef, {
      code: 'R-W0-1', fabricRef: 'JERSEY-180', colorId,
      weightKg: 15, lengthM: 50, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 180,
    });
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id,
      mesures: {
        'Poitrine à plat': 52, 'Longueur totale': 72, 'Épaules': 46,
        'Longueur manche': 20, 'Ouverture manche': 18, 'Largeur bas': 50,
        'Encolure': 18, 'Hauteur col': 3,
      },
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (listTables(db) as Array<{ nom: string; id: number }>)
      .find((table) => table.nom === 'Table 1');
    if (!table1) throw new Error('Table 1 introuvable.');
    // wastagePct absent → 0.
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 12,
    });
    const devant = revision.pieces.find((piece) => piece.code === 'devant');
    if (!devant) throw new Error('Pièce devant introuvable.');
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ]);
    const validated = validatePlan(db, admin, plan.id);
    const t = validated.theoretical;
    expect(t !== null, 'estimation calculée');
    if (!t) return;
    expect(t.wastagePct === 0, 'wastage absent = 0 %');
    expectClose(t.kgWithWastage, t.netKgTotal, 1e-12,
      'final = net (aucun wastage)');
    expectClose(t.netKgTotal, 2.42352, 1e-9,
      '12 pièces nettes = 1 douzaine de référence : 2,42352 kg');
    // Wastage invalide refusé dès la création du plan.
    throwsService(() => createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1, wastagePct: 150,
    }), 400);
    throwsService(() => createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1.id,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1, wastagePct: -5,
    }), 400);
  });
}
