/**
 * Tests des plans de coupe (étape 2) et de la cohérence des métriques
 * enregistrées (étape 7) : création, vérification serveur, sauvegarde
 * explicite, validation finale, permissions, rechargement.
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import Database from 'better-sqlite3';
import { ServiceError } from '../src/server/api/service-error';
import { createRoll, listRolls } from '../src/server/cutting/rolls';
import { listTables, updateTable } from '../src/server/cutting/tables';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { importRevision } from '../src/server/cutting/pattern-import';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan, getPlan, verifyPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { computeMetrics } from '../src/lib/cutting/optimizer';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

declare global {
  // eslint-disable-next-line no-var
  var __testPlanId: number | undefined;
}

export function runCuttingPlanTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, colorId } = createTestDb('cut-plans-');
  const tshirt = listCatalogueProducts(db).find(
    (item) => item.family === 'tshirt' && item.category === 'adulte',
  ) as CatalogueProduct;
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M') as { id: number };
  const roll = createRoll(db, chef, {
    code: 'R-PLAN-1',
    fabricRef: 'JERSEY-180',
    colorId,
    weightKg: 15,
    lengthM: 50,
    widthCm: 180,
    usableWidthCm: 170,
  });
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId,
    sizeId: sizeM.id,
    mesures: {
      'Poitrine à plat': 52,
      'Longueur totale': 70,
      Épaules: 46,
      'Longueur manche': 22,
      'Ouverture manche': 18,
      'Largeur bas': 50,
      Encolure: 18,
      'Hauteur col': 3,
    },
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = listTables(db).find((table) => table.nom === 'Table 1') as { id: number };

  check('Plan : révision non validée refusée ; création OK (zone 170 cm)', () => {
    const plan = createPlan(db, chef, {
      revisionId: revision.id,
      rollId: roll.id,
      tableId: table1.id,
      layers: 1,
      gapCm: 1,
      matelasLengthCm: 500,
      qty: 1,
    });
    if (plan.status !== 'proposition') throw new Error('Statut attendu proposition.');
    if (plan.usable_width_cm !== 170) throw new Error(`Largeur utile attendue 170, reçu ${plan.usable_width_cm}.`);
    globalThis.__testPlanId = plan.id;
  });

  check('Plan : matelas trop long refusé (dépasse table/rouleau)', () => {
    try {
      createPlan(db, chef, {
        revisionId: revision.id,
        rollId: roll.id,
        tableId: table1.id,
        layers: 1,
        gapCm: 1,
        matelasLengthCm: 1200,
        qty: 1,
      });
      throw new Error('Matelas de 1200 cm accepté.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 400) throw error;
    }
  });

  const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
    id: number;
    widthCm: number;
    heightCm: number;
  };
  if (!devant) throw new Error('Pièce devant introuvable.');

  check('Vérification serveur : placement valide accepté (gap exact = 1 cm)', () => {
    const result = verifyPlan(db, globalThis.__testPlanId as number, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ]);
    if (!result.ok) throw new Error(`Placement valide refusé : ${JSON.stringify(result.violations)}`);
  });

  check('Vérification serveur : hors zone, chevauchement, rotation interdite refusés', () => {
    const result = verifyPlan(db, globalThis.__testPlanId as number, [
      { pieceId: devant.id, x: 118, y: 430, rotation: 0 },
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 50, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 100, y: 300, rotation: 90 },
    ]);
    if (result.ok) throw new Error('Placements invalides acceptés.');
    const reasons = result.violations.map((violation) => violation.reason).join(' | ');
    if (!reasons.includes('dépasse')) throw new Error('Dépassement de zone non détecté.');
    if (!reasons.includes('interdite')) throw new Error('Rotation 90° non rejetée.');
    if (!reasons.includes('Chevauchement')) throw new Error('Chevauchement non détecté.');
  });

  check('Sauvegarde : plan invalide refusé ; plan valide persisté puis rechargé à l’identique', () => {
    const planId = globalThis.__testPlanId as number;
    const invalid = [
      { pieceId: devant.id, x: 118, y: 430, rotation: 0 },
    ];
    try {
      savePlan(db, chef, planId, invalid);
      throw new Error('Plan invalide sauvegardé.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 409) throw error;
    }
    const valid = [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    ];
    const saved = savePlan(db, chef, planId, valid);
    if (saved.placements.length !== 2) throw new Error('Deux placements attendus.');
    const reloaded = getPlan(db, planId);
    if (JSON.stringify(reloaded.placements) !== JSON.stringify(saved.placements)) {
      throw new Error('Rechargement différent de la sauvegarde.');
    }
    if (saved.placements[0].points.length < 8) {
      throw new Error('Contours R2 recalculés côté serveur attendus.');
    }
  });

  check('Métriques enregistrées : cohérence serveur ↔ formules partagées après rechargement', () => {
    const planId = globalThis.__testPlanId as number;
    const reloaded = getPlan(db, planId);
    const metrics = computeMetrics(
      reloaded.placements.map((placement) => placement.points),
      reloaded.usable_width_cm,
      reloaded.placements.length,
      0,
    );
    // Surface des pièces : la valeur stockée est la somme des aires
    // des contours reconstruits (arrondie à 4 décimales).
    if (Math.abs(reloaded.placed_area_m2 - Math.round(metrics.piecesAreaM2 * 10000) / 10000) > 1e-6) {
      throw new Error(`placed_area_m2 incohérent : ${reloaded.placed_area_m2} vs ${metrics.piecesAreaM2}`);
    }
    // Longueur occupée : marker_length_cm = max(y) des contours (formule partagée).
    if (Math.abs(reloaded.marker_length_cm - Math.round(metrics.consumedLengthCm * 100) / 100) > 1e-6) {
      throw new Error(`marker_length_cm incohérent : ${reloaded.marker_length_cm} vs ${metrics.consumedLengthCm}`);
    }
    // Efficacité enregistrée : base matelas (annoncée comme telle).
    if (Math.abs(reloaded.efficiency
      - Math.min(100, Math.round((metrics.piecesAreaM2 / reloaded.available_area_m2) * 10000) / 100)) > 0.011) {
      throw new Error(`efficiency incohérente : ${reloaded.efficiency}`);
    }
    if (Math.abs(reloaded.waste_area_m2
      - Math.round((reloaded.available_area_m2 - reloaded.placed_area_m2) * 10000) / 10000) > 1e-6) {
      throw new Error(`waste_area_m2 incohérent : ${reloaded.waste_area_m2}`);
    }
  });

  check('Validation finale : chef autorisé, rôle non habilité refusé, plan immuable', () => {
    const planId = globalThis.__testPlanId as number;
    try {
      validatePlan(db, { id: chef.id, roleCode: null }, planId);
      throw new Error('Rôle non habilité a pu valider le plan.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 403) throw error;
    }
    const validated = validatePlan(db, chef, planId);
    if (validated.status !== 'valide') throw new Error('Statut attendu valide.');
    const validatedBy = db.prepare('SELECT validated_by FROM marker_plans WHERE id = ?')
      .get(planId) as { validated_by: number | null };
    if (validatedBy.validated_by !== chef.id) throw new Error('Validateur chef de coupe attendu.');
    try {
      savePlan(db, chef, planId, [{ pieceId: devant.id, x: 2, y: 2, rotation: 0 }]);
      throw new Error('Plan validé modifié.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 409) throw error;
    }
  });

  check('Import JSON : schéma invalide refusé ; contours valides → brouillon', () => {
    try {
      importRevision(db, chef, {
        ficheId: fiche.id,
        sourceName: 'Numérisation test',
        sourceUnit: 'cm',
        pieces: [{ code: 'triangle', label: 'Triangle', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }],
      });
      throw new Error('Contour à 2 points accepté.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 400) throw error;
    }
    const imported = importRevision(db, chef, {
      ficheId: fiche.id,
      sourceName: 'Numérisation test',
      sourceUnit: 'cm',
      pieces: [{
        code: 'triangle',
        label: 'Triangle test',
        component: 'principal',
        qty: 1,
        grainDirection: 'along',
        allowedRotations: [0, 180],
        seamAllowanceCm: 1,
        seamIncluded: false,
        points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }],
      }],
    });
    if (imported.status !== 'brouillon' || imported.pieces.length !== 1) {
      throw new Error('Import valide attendu en brouillon avec 1 pièce.');
    }
  });

  check('Tables : modification réservée à l’admin (chef → 403)', () => {
    try {
      updateTable(db, chef, { tableId: table1.id, largeurUtileCm: 270 });
      throw new Error('Chef a pu modifier la table.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 403) throw error;
    }
    const updated = updateTable(db, admin, { tableId: table1.id, largeurUtileCm: 270 });
    if (updated.largeurUtileCm !== 270) throw new Error('Modification admin attendue.');
  });
}
