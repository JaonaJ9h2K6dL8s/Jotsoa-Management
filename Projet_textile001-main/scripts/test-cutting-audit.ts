/**
 * Audit métier complet du module Coupe (étape 9).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture :
 * - flux complet avec cohérence après rechargement (contours recalculés
 *   serveur, métriques live = métriques persistées) ;
 * - pièces obligatoires : rattachement à la révision (réfus des pièces
 *   d'un autre modèle/taille), quantités attendues / placées / coupées /
 *   transférées jamais confondues, surplus et manquants explicites ;
 * - sécurité du transfert : double déclenchement, fenêtre de course
 *   (lot concurrent préexistant), rollback transactionnel sur échec
 *   interne, rechargement et réception Couture.
 */

import Database from 'better-sqlite3';
import { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';
import { createRoll } from '../src/server/cutting/rolls';
import { listCatalogueProducts, type CatalogueProduct } from '../src/server/cutting/catalogue';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision, type RevisionItem, type RevisionPiece } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan, getPlan, verifyPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import { listPendingTransfers } from '../src/server/couture/balances';
import { computeMetrics } from '../src/lib/cutting/optimizer';
import { summarizePlacement, type ExpectedPiece } from '../src/lib/cutting/metrics';
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

/** Placement vertical d'une instance de pièce (une par ligne de matelas). */
function at(pieceId: number, y: number): { pieceId: number; x: number; y: number; rotation: 0 } {
  return { pieceId, x: 2, y, rotation: 0 };
}

function expectedPieces(revision: RevisionItem): ExpectedPiece[] {
  return revision.pieces.map((piece: RevisionPiece) => ({
    pieceId: piece.id,
    code: piece.code,
    label: piece.label,
    component: piece.component,
    qty: piece.qty,
    status: piece.status,
  }));
}

function countLots(db: Database.Database, code: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM coupe_lots WHERE code = ?').get(code) as { n: number }).n;
}

function planTickets(db: Database.Database, planId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM production_tickets WHERE plan_id = ?').get(planId) as { n: number }).n;
}

function planHistory(db: Database.Database, planId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM coupe_history WHERE action = 'PLAN_TRANSFERE' AND entity_id = ?").get(planId) as { n: number }).n;
}

function rollRemaining(db: Database.Database, rollId: number): number {
  return (db.prepare('SELECT remaining_weight_kg AS r FROM coupe_rolls WHERE id = ?').get(rollId) as { r: number }).r;
}

export function runCuttingAuditTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-audit-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  const sizeL = tshirt.sizes.find((size) => size.nom === 'L');
  if (!sizeM || !sizeL) throw new Error('Catalogue : tailles M et L requises.');
  const roll1 = createRoll(db, chef, {
    code: 'R-AUDIT-1', fabricRef: 'JERSEY-200', colorId,
    // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
    weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
  });
  const roll2 = createRoll(db, chef, {
    code: 'R-AUDIT-2', fabricRef: 'JERSEY-200', colorId,
    // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
    weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
  });
  const ficheM = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: TSHIRT_MESURES,
  }).id);
  const ficheL = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeL.id, mesures: TSHIRT_MESURES,
  }).id);
  const revisionM = validateRevision(db, admin, generateRevision(db, chef, ficheM.id).id);
  const revisionL = validateRevision(db, admin, generateRevision(db, chef, ficheL.id).id);
  const piece = (revision: RevisionItem, code: string): RevisionPiece =>
    revision.pieces.find((candidate) => candidate.code === code) as RevisionPiece;
  const devant = piece(revisionM, 'devant');
  const dos = piece(revisionM, 'dos');
  const col = piece(revisionM, 'col');
  const mancheG = piece(revisionM, 'manche_gauche');
  const mancheD = piece(revisionM, 'manche_droite');
  const devantL = piece(revisionL, 'devant');
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'").get() as { id: number }).id;
  const planA = createPlan(db, chef, {
    revisionId: revisionM.id, rollId: roll1.id, tableId: table1,
    layers: 2, gapCm: 1, matelasLengthCm: 500, qty: 1,
  });
  // 3 devant (surplus volontaire), 1 dos, 1 col, 2 manches : 7 placements.
  const placements = [
    at(devant.id, 2), at(devant.id, 90), at(devant.id, 178),
    at(dos.id, 266), at(col.id, 354),
    at(mancheG.id, 430), at(mancheD.id, 470),
  ];
  // Déclaration de coupe : 2 des 3 devant (le surplus reste sur table).
  const fullCut = (): Array<{ pieceId: number; qty: number }> => [
    { pieceId: devant.id, qty: 2 }, { pieceId: dos.id, qty: 1 },
    { pieceId: col.id, qty: 1 }, { pieceId: mancheG.id, qty: 1 },
    { pieceId: mancheD.id, qty: 1 },
  ];
  savePlan(db, chef, planA.id, placements);
  const expectedTotal = revisionM.pieces
    .filter((candidate) => candidate.required && candidate.status === 'configuree')
    .reduce((sum, candidate) => sum + Math.floor(candidate.qty), 0);

  check('Audit : sauvegarde → rechargement à l’identique (contours recalculés serveur)', () => {
    const reloaded = getPlan(db, planA.id);
    if (reloaded.placements.length !== placements.length) {
      throw new Error(`${placements.length} placements attendus, rechargé : ${reloaded.placements.length}.`);
    }
    reloaded.placements.forEach((placement, index) => {
      const source = placements[index];
      if (placement.pieceId !== source.pieceId || placement.x !== source.x
        || placement.y !== source.y || placement.rotation !== source.rotation) {
        throw new Error(`Placement ${index} modifié après rechargement.`);
      }
      if (placement.points.length < 3) {
        throw new Error(`Contours recalculés serveur absents (placement ${index}).`);
      }
    });
  });

  check('Audit : métriques live (computeMetrics) = métriques persistées', () => {
    const reloaded = getPlan(db, planA.id);
    const contours = reloaded.placements.map((placement) => placement.points);
    const live = computeMetrics(contours, reloaded.usable_width_cm);
    const persistedLength = (db.prepare('SELECT marker_length_cm AS l FROM marker_plans WHERE id = ?')
      .get(planA.id) as { l: number }).l;
    const persistedArea = (db.prepare('SELECT placed_area_m2 AS a FROM marker_plans WHERE id = ?')
      .get(planA.id) as { a: number }).a;
    if (Math.abs(live.consumedLengthCm - persistedLength) > 0.01) {
      throw new Error(`Longueur : live ${live.consumedLengthCm} vs persistée ${persistedLength}.`);
    }
    if (Math.abs(live.piecesAreaM2 - persistedArea) > 0.0001) {
      throw new Error(`Surface pièces : live ${live.piecesAreaM2} vs persistée ${persistedArea}.`);
    }
  });

  check('Audit : efficiency persistée documentée = pièces / surface matelas déclarée', () => {
    const reloaded = getPlan(db, planA.id);
    const persistedArea = (db.prepare('SELECT placed_area_m2 AS a, efficiency AS e, available_area_m2 AS av FROM marker_plans WHERE id = ?')
      .get(planA.id) as { a: number; e: number; av: number });
    const expected = Math.min(100, Math.round((persistedArea.a / persistedArea.av) * 10000) / 100);
    if (Math.abs(expected - persistedArea.e) > 0.01) {
      throw new Error(`Efficiency attendue ${expected}, persistée ${persistedArea.e}.`);
    }
  });

  check('Audit : pièce d’une autre taille/révision refusée au placement (409)', () => {
    const foreign = [{ pieceId: devantL.id, x: 2, y: 2, rotation: 0 as const }];
    const verify = verifyPlan(db, planA.id, foreign);
    if (verify.ok || verify.violations[0]?.reason !== 'Pièce inconnue pour ce plan.') {
      throw new Error(`Pièce étrangère acceptée : ${JSON.stringify(verify)}`);
    }
    expectServiceError(() => savePlan(db, chef, planA.id, [
      ...placements, at(devantL.id, 300),
    ]), 409, 'sauvegarde refusée');
  });

  check('Audit : quantités — pièce étrangère ignorée, surplus et manquants explicites', () => {
    const summary = summarizePlacement(
      expectedPieces(revisionM),
      new Map([[devant.id, 5], [dos.id, 1], [devantL.id, 2]]),
      new Map([[dos.id, 1]]),
    );
    if (summary.model.placed !== 6) {
      throw new Error(`Pièce étrangère comptée : placé ${summary.model.placed} au lieu de 6.`);
    }
    const devantRow = summary.rows.find((row) => row.pieceId === devant.id) as {
      expected: number; placed: number; missing: number; valid: number;
    };
    if (devantRow.placed !== 5 || devantRow.missing !== 0 || devantRow.placed <= devantRow.expected) {
      throw new Error(`Surplus non visible : ${JSON.stringify(devantRow)}`);
    }
    const dosRow = summary.rows.find((row) => row.pieceId === dos.id) as {
      valid: number; invalid: number; missing: number;
    };
    if (dosRow.valid !== 0 || dosRow.invalid !== 1) {
      throw new Error(`Invalides mal décomptées : ${JSON.stringify(dosRow)}`);
    }
    if (summary.readyForTransfer) {
      throw new Error('Un plan avec une pièce invalide ne peut pas être prêt au transfert.');
    }
  });

  check('Audit : validation chef, immuabilité, quantités déclarées bornées', () => {
    validatePlan(db, chef, planA.id);
    expectServiceError(() => savePlan(db, chef, planA.id, placements), 409, 'immuable');
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: planA.id,
      cutPieces: [...fullCut(), { pieceId: devantL.id, qty: 1 }],
      confirmCut: true,
    }), 409, 'ne peut pas être coupée');
  });

  let transferResult: ReturnType<typeof createCutTransfer> | null = null;
  check('Audit : transfert réel — 4 quantités distinctes (attendu/placé/coupé/transféré)', () => {
    transferResult = createCutTransfer(db, chef, {
      planId: planA.id, cutPieces: fullCut(), confirmCut: true,
    });
    // attendu (révision) = expectedTotal ; placé = 7 ; coupé déclaré = 6 ;
    // transféré = min(coupé ÷ par vêtement) × couches = 1 × 2.
    const cutDeclared = fullCut().reduce((sum, entry) => sum + entry.qty, 0);
    const values = new Set([expectedTotal, placements.length, cutDeclared, transferResult.transferredQty]);
    if (values.size !== 4) {
      throw new Error(`Quantités confondues : attendu ${expectedTotal}, placé ${placements.length}, coupé ${cutDeclared}, transféré ${transferResult.transferredQty}.`);
    }
    if (transferResult.garmentsPerLayer !== 1 || transferResult.transferredQty !== 2) {
      throw new Error(`Équivalent vêtements incohérent : ${JSON.stringify(transferResult)}`);
    }
    if ((db.prepare('SELECT lot_id AS l FROM marker_plans WHERE id = ?').get(planA.id) as { l: number }).l
      !== transferResult.lotId) {
      throw new Error('Lien plan → lot manquant après transfert.');
    }
  });

  check('Audit : double déclenchement refusé, aucun effet de bord', () => {
    const before = {
      lots: countLots(db, `LOT-P${planA.id}`),
      tickets: planTickets(db, planA.id),
      history: planHistory(db, planA.id),
      roll: rollRemaining(db, roll1.id),
    };
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: planA.id, cutPieces: fullCut(), confirmCut: true,
    }), 409, 'déjà été transféré');
    const after = {
      lots: countLots(db, `LOT-P${planA.id}`),
      tickets: planTickets(db, planA.id),
      history: planHistory(db, planA.id),
      roll: rollRemaining(db, roll1.id),
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`Effets de bord du doublon : ${JSON.stringify({ before, after })}`);
    }
  });

  check('Audit : fenêtre de course (lot concurrent préexistant) → garde interne (409)', () => {
    const planB = createPlan(db, chef, {
      revisionId: revisionM.id, rollId: roll2.id, tableId: table1,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1,
    });
    savePlan(db, chef, planB.id, placements);
    validatePlan(db, admin, planB.id);
    // Simule l'écriture concurrente gagnante : le lot existe déjà,
    // mais marker_plans.lot_id n'est pas encore visible (fenêtre entre
    // la vérification externe et la transaction). better-sqlite3 étant
    // synchrone, la course est reproduite par cet état intermédiaire ;
    // SQLite sérialise les écrivains exactement comme en multi-process.
    const db2 = new Database(db.name);
    db2.pragma('busy_timeout = 2000');
    db2.prepare(
      `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status,
                               responsable_id, notes, started_at, finished_at)
       VALUES (?, ?, ?, 0, 'transfere', ?, 'simulation écriture concurrente',
               datetime('now'), datetime('now'))`,
    ).run(`LOT-P${planB.id}`, planB.product_id, colorId, chef.id);
    db2.close();
    const rollBefore = rollRemaining(db, roll2.id);
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: planB.id, cutPieces: fullCut(), confirmCut: true,
    }), 409, 'Un lot existe déjà');
    if (countLots(db, `LOT-P${planB.id}`) !== 1) throw new Error('Lot dupliqué.');
    if ((db.prepare('SELECT lot_id AS l FROM marker_plans WHERE id = ?').get(planB.id) as { l: number | null }).l !== null) {
      throw new Error('Lien plan → lot posé malgré le refus.');
    }
    if (planTickets(db, planB.id) !== 0 || planHistory(db, planB.id) !== 0) {
      throw new Error('Tickets/historique écrits malgré le refus.');
    }
    if (rollRemaining(db, roll2.id) !== rollBefore) throw new Error('Rouleau décompté malgré le refus.');
  });

  check('Audit : échec interne en cours de transaction → rollback complet', () => {
    const planC = createPlan(db, chef, {
      revisionId: revisionM.id, rollId: roll2.id, tableId: table1,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1,
    });
    savePlan(db, chef, planC.id, placements);
    validatePlan(db, admin, planC.id);
    const realPrepare = db.prepare.bind(db);
    (db as { prepare: unknown }).prepare = (sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO coupe_history')) {
        throw new Error('SIMULATED_DB_FAILURE');
      }
      return realPrepare(sql);
    };
    let failed = false;
    try {
      createCutTransfer(db, chef, { planId: planC.id, cutPieces: fullCut(), confirmCut: true });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('SIMULATED_DB_FAILURE')) throw error;
      failed = true;
    } finally {
      delete (db as { prepare?: unknown }).prepare;
    }
    if (!failed) throw new Error('Panne simulée non déclenchée.');
    if (countLots(db, `LOT-P${planC.id}`) !== 0) throw new Error('Lot non annulé (rollback incomplet).');
    if ((db.prepare('SELECT lot_id AS l FROM marker_plans WHERE id = ?').get(planC.id) as { l: number | null }).l !== null) {
      throw new Error('Lien plan → lot non annulé.');
    }
    if (planTickets(db, planC.id) !== 0 || planHistory(db, planC.id) !== 0) {
      throw new Error('Tickets/historique non annulés.');
    }
    const rollAfterFailure = rollRemaining(db, roll2.id);
    // Après panne, le système reste opérationnel : le transfert réel réussit.
    const result = createCutTransfer(db, chef, {
      planId: planC.id, cutPieces: fullCut(), confirmCut: true,
    });
    if (result.transferredQty !== 1) throw new Error(`1 couche → 1 vêtement attendu, reçu ${result.transferredQty}.`);
    if ((db.prepare('SELECT lot_id AS l FROM marker_plans WHERE id = ?').get(planC.id) as { l: number }).l
      !== result.lotId) {
      throw new Error('Transfert réel impossible après panne simulée.');
    }
    if (rollRemaining(db, roll2.id) >= rollAfterFailure) {
      throw new Error('Consommation du rouleau non décomptée au second transfert.');
    }
  });

  check('Audit : rechargement après transfert — plan inchangé, réception visible', () => {
    if (!transferResult) throw new Error('Transfert de référence manquant.');
    const reloaded = getPlan(db, planA.id);
    if (reloaded.placements.length !== placements.length || reloaded.total_pieces !== placements.length) {
      throw new Error('Plan modifié après transfert (immuabilité rompue).');
    }
    if (reloaded.marker_length_cm !== getPlan(db, planA.id).marker_length_cm) {
      throw new Error('Métriques instables après transfert.');
    }
    const pending = listPendingTransfers(couture);
    if (!pending.some((item) => item.lotCode === `LOT-P${planA.id}`)) {
      throw new Error('Transfert invisible côté Couture après rechargement.');
    }
  });
}
