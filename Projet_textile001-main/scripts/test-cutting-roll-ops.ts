/**
 * Tests étape 13 — exploitation professionnelle des rouleaux :
 * vue détaillée avec alertes de cohérence, correction de stock avec
 * motif historisé, blocage/déblocage, refus d'affectation d'un rouleau
 * bloqué, tracé de la consommation au transfert.
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';
import { createRoll } from '../src/server/cutting/rolls';
import {
  adjustRoll, listMovements, listRollsDetailed, setRollStatus,
} from '../src/server/cutting/roll-ops';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import { listCatalogueProducts, type CatalogueProduct } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

const MESURES = {
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

export function runCuttingRollOpsTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-rollops-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;

  const roll = createRoll(db, chef, {
    code: 'R-OPS-1', fabricRef: 'JERSEY-200', colorId,
    // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
    weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
  });
  const blocked = createRoll(db, chef, {
    code: 'R-OPS-2', fabricRef: 'JERSEY-200', colorId,
    // Cohérent : implicite = 18000/(30×1,8) ≈ 333,3 g/m².
    weightKg: 18, lengthM: 30, widthCm: 180, usableWidthCm: 170, grammageGm2: 333.3,
  });
  setRollStatus(db, chef, { rollId: blocked.id, status: 'bloque', reason: 'Réserve qualité' });

  check('Exploitation : vue détaillée — tous les rouleaux, responsable, sans fausse alerte', () => {
    const all = listRollsDetailed(db);
    const first = all.find((item) => item.id === roll.id);
    const second = all.find((item) => item.id === blocked.id);
    if (!first || !second) throw new Error('Rouleau absent de la vue détaillée.');
    if (first.responsable === null) throw new Error('Responsable de création manquant.');
    if (first.alerts.length !== 0 || second.alerts.length !== 0) {
      throw new Error(`Fausses alertes : ${JSON.stringify([first.alerts, second.alerts])}`);
    }
    if (second.status !== 'bloque') throw new Error('État bloqué non restitué.');
  });

  check('Exploitation : alertes de cohérence détectées (jamais de valeur inventée)', () => {
    // Rouleau inséré hors service (sans mouvement) : consommation
    // silencieuse + poids restant > poids initial.
    db.prepare(
      `INSERT INTO coupe_rolls (code, fabric_ref, initial_weight_kg, initial_qty,
         qty_unit, remaining_weight_kg, remaining_qty, status)
       VALUES ('R-OPS-BAD', 'X', 20, 20, 'm', 25, 15, 'disponible')`,
    ).run();
    // Restant > initial (longueur).
    db.prepare(
      `INSERT INTO coupe_rolls (code, fabric_ref, initial_weight_kg, initial_qty,
         qty_unit, remaining_weight_kg, remaining_qty, status)
       VALUES ('R-OPS-BAD2', 'X', 20, 10, 'm', 20, 15, 'disponible')`,
    ).run();
    const bad = listRollsDetailed(db).find((item) => item.code === 'R-OPS-BAD');
    if (!bad) throw new Error('Rouleau de test absent.');
    const codes = bad.alerts.map((alert) => alert.code).sort();
    if (JSON.stringify(codes) !== JSON.stringify(
      ['silent_consumption', 'weight_over_initial'],
    )) {
      throw new Error(`Alertes attendues manquantes : ${JSON.stringify(bad.alerts)}`);
    }
    const bad2 = listRollsDetailed(db).find((item) => item.code === 'R-OPS-BAD2');
    if (!bad2 || bad2.alerts.length !== 1
      || bad2.alerts[0].code !== 'remaining_over_initial') {
      throw new Error(`Alerte restant > initial manquante : ${JSON.stringify(bad2?.alerts)}`);
    }
  });

  check('Correction : motif obligatoire, bornes 0–initial, rouleau épuisé refusé', () => {
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: roll.id, newRemainingM: 45,
    }), 400, 'motif');
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: roll.id, newRemainingM: -1, reason: 'test',
    }), 400);
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: roll.id, newRemainingM: 51, reason: 'test',
    }), 400, 'longueur initiale');
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: roll.id, newRemainingKg: 20.5, reason: 'test',
    }), 400, 'poids initial');
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: roll.id, reason: 'aucune valeur',
    }), 400, 'Aucune correction');
    const epuise = createRoll(db, chef, {
      code: 'R-OPS-EPU', fabricRef: 'X', colorId, weightKg: 10, lengthM: 5,
    });
    db.prepare("UPDATE coupe_rolls SET status = 'epuise' WHERE id = ?").run(epuise.id);
    expectServiceError(() => adjustRoll(db, chef, {
      rollId: epuise.id, newRemainingM: 1, reason: 'test',
    }), 409, 'épuisé');
    expectServiceError(() => adjustRoll(db, couture, {
      rollId: roll.id, newRemainingM: 45, reason: 'rôle refusé',
    }), 403);
  });

  check('Correction valide : mise à jour + mouvements historisés (motif, utilisateur)', () => {
    const updated = adjustRoll(db, chef, {
      rollId: roll.id, newRemainingM: 45, newRemainingKg: 18.5,
      reason: 'Relevé physique fin de journée',
    });
    if (updated.remainingM !== 45 || updated.remainingWeightKg !== 18.5) {
      throw new Error(`Correction non appliquée : ${JSON.stringify(updated)}`);
    }
    const moves = listMovements(db, roll.id).filter(
      (move) => move.movementType === 'correction_poids',
    );
    if (moves.length !== 2) throw new Error(`2 corrections attendues, reçu ${moves.length}.`);
    for (const move of moves) {
      if (move.reason !== 'Relevé physique fin de journée') {
        throw new Error('Motif non historisé.');
      }
      if (!move.username.includes('chef')) throw new Error('Utilisateur non historisé.');
    }
    const units = moves.map((move) => move.unit).sort();
    if (JSON.stringify(units) !== JSON.stringify(['kg', 'm'])) {
      throw new Error(`Unités inattendues : ${units.join(',')}`);
    }
  });

  check('Blocage : rouleau bloqué refusé pour création de plan et modification', () => {
    expectServiceError(() => setRollStatus(db, chef, {
      rollId: blocked.id, status: 'bloque', reason: 'déjà bloqué',
    }), 409, 'déjà');
    expectServiceError(() => setRollStatus(db, chef, {
      rollId: blocked.id, status: 'epuise', reason: 'cible interdite',
    }), 400, 'invalide');
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
      .get() as { id: number }).id;
    expectServiceError(() => createPlan(db, chef, {
      revisionId: revision.id, rollId: blocked.id, tableId: table1,
      layers: 1, gapCm: 1, matelasLengthCm: 100, qty: 1,
    }), 409, 'disponible');
    expectServiceError(() => setRollStatus(db, couture, {
      rollId: roll.id, status: 'bloque', reason: 'rôle refusé',
    }), 403);
  });

  check('Déblocage : retour disponible avec mouvement, puis plan accepté', () => {
    const unblocked = setRollStatus(db, chef, {
      rollId: blocked.id, status: 'disponible', reason: 'Réserve levée',
    });
    if (unblocked.status !== 'disponible') throw new Error('Déblocage non appliqué.');
    const moves = listMovements(db, blocked.id);
    const last = moves[0];
    if (last.movementType !== 'deblocage' || last.reason !== 'Réserve levée') {
      throw new Error(`Mouvement de déblocage manquant : ${JSON.stringify(last)}`);
    }
  });

  check('Rouleau en utilisation : changement d’état refusé (production pilote)', () => {
    db.prepare("UPDATE coupe_rolls SET status = 'en_utilisation' WHERE id = ?").run(roll.id);
    expectServiceError(() => setRollStatus(db, chef, {
      rollId: roll.id, status: 'bloque', reason: 'test',
    }), 409, 'en cours d’utilisation');
    db.prepare("UPDATE coupe_rolls SET status = 'disponible' WHERE id = ?").run(roll.id);
  });

  check('Transfert : consommation physique tracée dans les mouvements', () => {
    const tshirt = listCatalogueProducts(db).find(
      (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
    );
    if (!tshirt) throw new Error('T-shirt adulte introuvable.');
    const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
    if (!sizeM) throw new Error('Taille M introuvable.');
    const fiche = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
    }).id);
    const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
    const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
      .get() as { id: number }).id;
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1,
    });
    const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
      id: number; widthCm: number;
    };
    const dos = revision.pieces.find((piece) => piece.code === 'dos') as { id: number };
    const col = revision.pieces.find((piece) => piece.code === 'col') as { id: number };
    const mancheG = revision.pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
    const mancheD = revision.pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
    // Placement complet d'un vêtement (1 couche).
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
      { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
      { pieceId: dos.id, x: 2 + devant.widthCm + 1, y: 80, rotation: 0 },
      { pieceId: col.id, x: 2, y: 160, rotation: 0 },
      { pieceId: col.id, x: 2 + devant.widthCm + 1, y: 160, rotation: 0 },
      { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
      { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
    ]);
    validatePlan(db, admin, plan.id);
    const before = (db.prepare(
      'SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg;
    createCutTransfer(db, chef, {
      planId: plan.id, confirmCut: true,
      cutPieces: [
        { pieceId: devant.id, qty: 1 }, { pieceId: dos.id, qty: 1 },
        { pieceId: col.id, qty: 1 }, { pieceId: mancheG.id, qty: 1 },
        { pieceId: mancheD.id, qty: 1 },
      ],
    });
    const consumption = listMovements(db, roll.id).find(
      (move) => move.movementType === 'consommation',
    );
    if (!consumption) throw new Error('Mouvement de consommation manquant au transfert.');
    if (consumption.unit !== 'kg') throw new Error('Unité kg attendue.');
    if (consumption.qty === null || consumption.qty <= 0) {
      throw new Error('Quantité consommée incohérente.');
    }
    const after = (db.prepare(
      'SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg;
    if (Math.abs((before - after) - (consumption.qty ?? 0)) > 0.002) {
      throw new Error('Traçabilité incohérente avec le stock restant.');
    }
  });
}
