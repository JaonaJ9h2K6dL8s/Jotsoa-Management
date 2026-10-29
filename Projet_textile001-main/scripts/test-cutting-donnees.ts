/**
 * Tests étape 12 — gestion des rouleaux et produits + image de patron.
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import { ServiceError } from '../src/server/api/service-error';
import { createRoll, updateRoll } from '../src/server/cutting/rolls';
import {
  createCatalogueProduct, updateCatalogueProduct, listCatalogueProducts,
  listCatalogueSizes,
} from '../src/server/cutting/catalogue';
import { renderPatternPreview } from '../src/server/cutting/pattern-preview';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createTestDb } from './test-cutting-services';

const MESURES = {
  'Poitrine à plat': 52, 'Longueur totale': 70, 'Ouverture manche': 18,
  'Longueur manche': 22, Encolure: 18, 'Hauteur col': 3,
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

export function runCuttingDonneesTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-donnees-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;

  check('Données : tailles actives listées (source des listes déroulantes)', () => {
    const sizes = listCatalogueSizes(db);
    if (!sizes.some((size) => size.nom === 'M') || !sizes.some((size) => size.nom === '4 ans')) {
      throw new Error(`Tailles adulte/enfant absentes : ${sizes.map((size) => size.nom).join(',')}`);
    }
  });

  check('Données : modification de rouleau (chef) et refus rôle non autorisé', () => {
    const roll = createRoll(db, chef, {
      code: 'R-DON-1', fabricRef: 'JERSEY-200', colorId,
      // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
      weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
    });
    const updated = updateRoll(db, chef, {
      rollId: roll.id, fabricRef: 'JERSEY-240', colorId: null,
      // Cohérent après modification : implicite = 20000/(41,7×2) ≈ 240 g/m².
      lengthM: 41.7, widthCm: 200, usableWidthCm: 190, grammageGm2: 240,
    });
    if (updated.fabricRef !== 'JERSEY-240' || updated.colorNom !== null
      || updated.lengthM !== 41.7 || updated.usableWidthCm !== 190) {
      throw new Error(`Mise à jour incomplète : ${JSON.stringify(updated)}`);
    }
    if (updated.weightKg !== 20) throw new Error('Poids modifié (interdit).');
    expectServiceError(() => updateRoll(db, couture, { rollId: roll.id, lengthM: 41 }), 403);
  });

  check('Données : règles rouleau — largeur utile > largeur refusée, longueur < consommé refusée', () => {
    const roll = createRoll(db, chef, {
      code: 'R-DON-2', fabricRef: 'JERSEY', colorId,
      // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
      weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
    });
    expectServiceError(() => updateRoll(db, chef, {
      rollId: roll.id, widthCm: 180, usableWidthCm: 181,
    }), 400, 'largeur utile');
    // Simule 10 m consommés puis tente de raccourcir sous le consommé.
    db.prepare('UPDATE coupe_rolls SET remaining_qty = initial_qty - 10 WHERE id = ?').run(roll.id);
    expectServiceError(() => updateRoll(db, chef, { rollId: roll.id, lengthM: 5 }), 400, 'déjà consommée');
    // Raccourcissement cohérent : le grammage suit la nouvelle longueur.
    const kept = updateRoll(db, chef, {
      rollId: roll.id, lengthM: 30, grammageGm2: 370.4,
    });
    if (kept.lengthM !== 30) throw new Error('Longueur au-dessus du consommé refusée à tort.');
    // Rouleau non disponible : refus.
    db.prepare("UPDATE coupe_rolls SET status = 'en_utilisation' WHERE id = ?").run(roll.id);
    expectServiceError(() => updateRoll(db, chef, { rollId: roll.id, lengthM: 31 }), 409, 'disponible');
  });

  check('Données : création produit — famille sans règles refusée, tailles inconnues refusées', () => {
    expectServiceError(() => createCatalogueProduct(db, chef, {
      nom: 'Veste', family: 'veste', category: 'adulte', sizeNames: ['M'],
    }), 400, 'sans règles de patronage');
    expectServiceError(() => createCatalogueProduct(db, chef, {
      nom: 'Veste', family: 'tshirt', category: 'adulte', sizeNames: ['XXX'],
    }), 400, 'inconnues');
    expectServiceError(() => createCatalogueProduct(db, chef, {
      nom: 'Veste', family: 'tshirt', category: 'adulte', sizeNames: [],
    }), 400, 'Au moins une taille');
    expectServiceError(() => createCatalogueProduct(db, couture, {
      nom: 'Veste', family: 'tshirt', category: 'adulte', sizeNames: ['M'],
    }), 403);
  });

  check('Données : création produit OK, liste catalogue et anti-doublon', () => {
    const created = createCatalogueProduct(db, chef, {
      nom: 'Débardeur', family: 'tshirt', category: 'enfant', sizeNames: ['2 ans', '4 ans'],
    });
    if (created.family !== 'tshirt' || created.category !== 'enfant'
      || created.sizeNames.join(',') !== '2 ans,4 ans') {
      throw new Error(`Produit incohérent : ${JSON.stringify(created)}`);
    }
    const listed = listCatalogueProducts(db)
      .find((item) => item.productId === created.productId);
    if (!listed) throw new Error('Produit absent de la liste catalogue.');
    expectServiceError(() => createCatalogueProduct(db, chef, {
      nom: 'Débardeur', family: 'tshirt', category: 'enfant', sizeNames: ['M'],
    }), 409, 'existe déjà');
  });

  check('Données : modification produit — les révisions validées restent inchangées', () => {
    const tshirt = listCatalogueProducts(db)
      .find((item) => item.family === 'tshirt' && item.category === 'adulte');
    if (!tshirt) throw new Error('T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const before = db.prepare(
      'SELECT piece_code, width_cm, height_cm, geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY piece_code',
    ).all(revision.id);
    const updated = updateCatalogueProduct(db, chef, {
      productId: tshirt.productId, nom: 'T-shirt Premium',
      sizeNames: ['S', 'M', 'L'], isActive: true,
    });
    if (updated.nom !== 'T-shirt Premium' || updated.sizeNames.join(',') !== 'S,M,L') {
      throw new Error(`Mise à jour produit incomplète : ${JSON.stringify(updated)}`);
    }
    const after = db.prepare(
      'SELECT piece_code, width_cm, height_cm, geometry_json FROM pattern_pieces WHERE revision_id = ? ORDER BY piece_code',
    ).all(revision.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Révision validée modifiée par l’édition du produit.');
    }
  });

  check('Image patron : refus brouillon, refus rôle, SVG depuis contours validés', () => {
    const tshirt = listCatalogueProducts(db)
      .find((item) => item.family === 'tshirt' && item.category === 'adulte');
    if (!tshirt) throw new Error('T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
    }).id);
    const draft = generateRevision(db, chef, fiche.id);
    expectServiceError(() => renderPatternPreview(db, chef, draft.id), 409, 'patron validé');
    expectServiceError(() => renderPatternPreview(db, couture, draft.id), 403);
    expectServiceError(() => renderPatternPreview(db, chef, 999999), 404);
    const validated = validateRevision(db, admin, draft.id);
    const preview = renderPatternPreview(db, chef, validated.id);
    if (!preview.svg.startsWith('<svg') || !preview.svg.endsWith('</svg>')) {
      throw new Error('SVG mal formé.');
    }
    if (preview.pieceCount < 5 || preview.svg.includes('NaN')) {
      throw new Error(`Rendu incohérent : ${preview.pieceCount} pièces.`);
    }
    if (!preview.svg.includes('devant')) {
      throw new Error('Code de pièce absent du rendu.');
    }
  });
}
