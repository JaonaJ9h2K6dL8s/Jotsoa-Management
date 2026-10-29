/**
 * Tests du transfert réel Coupe → Couture (étape 8).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture : conditions serveur (plan validé, révision approuvée,
 * ticket correspondant, confirmation de coupe physique), bornage des
 * quantités déclarées par le placement enregistré, anti-doublon,
 * permissions, consommation du rouleau, traçabilité (tickets,
 * historique) et réception effective par le module Couture existant.
 */

import { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';
import { createRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan, getPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTicket, createCutTransfer } from '../src/server/cutting/transfer';
import { receiveTransfer } from '../src/server/couture/receptions';
import { getLotBalances, listPendingTransfers } from '../src/server/couture/balances';
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

export function runCuttingTransferTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-transfer-');
  // Les services Couture lisent la base globale (sessionsDb) : on
  // injecte la base temporaire du test pour un bout-en-bout fidèle.
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
  const roll = createRoll(db, chef, {
    code: 'R-TRF-1',
    fabricRef: 'JERSEY-180',
    colorId,
    weightKg: 20,
    lengthM: 50,
    widthCm: 180,
    usableWidthCm: 170,
    // Cohérent : implicite = 20000/(50×1,8) = 222,2 g/m².
    grammageGm2: 222.2,
  });
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId,
    sizeId: sizeM.id,
    mesures: TSHIRT_MESURES,
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'").get() as { id: number }).id;
  const plan = createPlan(db, chef, {
    revisionId: revision.id,
    rollId: roll.id,
    tableId: table1,
    layers: 2,
    gapCm: 1,
    matelasLengthCm: 500,
    qty: 1,
  });
  const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
    id: number; widthCm: number;
  };
  const dos = revision.pieces.find((piece) => piece.code === 'dos') as { id: number };
  const col = revision.pieces.find((piece) => piece.code === 'col') as { id: number };
  const mancheG = revision.pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
  const mancheD = revision.pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
  // Déclaration complète (1 vêtement par couche) : 2 devant, 1 dos,
  // 1 manche gauche, 1 manche droite, 1 col.
  const fullCut = (): Array<{ pieceId: number; qty: number }> => [
    { pieceId: devant.id, qty: 2 },
    { pieceId: dos.id, qty: 1 },
    { pieceId: mancheG.id, qty: 1 },
    { pieceId: mancheD.id, qty: 1 },
    { pieceId: col.id, qty: 1 },
  ];
  // Placement : 2 devant côte à côte, 1 dos, 1 col, 1 manche de chaque côté.
  savePlan(db, chef, plan.id, [
    { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
    { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
    { pieceId: col.id, x: 2, y: 160, rotation: 0 },
    { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
    { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
  ]);
  const brouillonPlanId = plan.id;

  check('Transfert : plan non validé refusé (409)', () => {
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: [{ pieceId: devant.id, qty: 2 }],
      confirmCut: true,
    }), 409, 'validé');
  });

  check('Transfert : confirmation de coupe physique requise (400)', () => {
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: [{ pieceId: devant.id, qty: 2 }],
      confirmCut: false,
    }), 400, 'confirmation de coupe physique');
  });

  check('Transfert : quantité déclarée > placement enregistré refusée (409)', () => {
    validatePlan(db, admin, brouillonPlanId);
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: [{ pieceId: devant.id, qty: 3 }, { pieceId: dos.id, qty: 1 }, { pieceId: col.id, qty: 1 }],
      confirmCut: true,
    }), 409, 'ne peut pas être coupée');
  });

  check('Transfert : vêtement incomplet refusé (400)', () => {
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: [
        { pieceId: devant.id, qty: 2 },
        { pieceId: dos.id, qty: 1 },
        { pieceId: col.id, qty: 0 },
      ],
      confirmCut: true,
    }), 400, 'un seul vêtement');
  });

  check('Transfert : ticket d’un autre plan refusé (409)', () => {
    // Plan annexe (1 placement valide) pour produire un ticket étranger.
    const otherPlan = createPlan(db, chef, {
      revisionId: revision.id,
      rollId: roll.id,
      tableId: table1,
      layers: 1,
      gapCm: 1,
      matelasLengthCm: 500,
      qty: 1,
    });
    savePlan(db, chef, otherPlan.id, [{ pieceId: devant.id, x: 2, y: 2, rotation: 0 }]);
    const foreignTicket = createCutTicket(db, chef, otherPlan.id);
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      ticketCode: foreignTicket.code,
      cutPieces: fullCut(),
      confirmCut: true,
    }), 409, 'ne correspond pas à ce plan');
  });

  check('Transfert : rôle couture refusé (403)', () => {
    expectServiceError(() => createCutTransfer(db, couture as unknown as Actor, {
      planId: brouillonPlanId,
      cutPieces: fullCut(),
      confirmCut: true,
    }), 403);
  });

  check('Transfert réel : lot, transfert confirmé, tickets, historique, rouleau', () => {
    const before = db.prepare(
      'SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number };
    const result = createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: fullCut(),
      confirmCut: true,
    });
    if (result.garmentsPerLayer !== 1) {
      throw new Error(`1 vêtement par couche attendu (dos = 1), reçu ${result.garmentsPerLayer}.`);
    }
    if (result.transferredQty !== 2) {
      throw new Error(`2 vêtements transférés attendus (2 couches), reçu ${result.transferredQty}.`);
    }
    if (result.cutPieces.find((piece) => piece.pieceId === devant.id)?.totalQty !== 4) {
      throw new Error('Le détail doit conserver 2 pièces devant par couche sur 2 couches.');
    }
    const lot = db.prepare('SELECT * FROM coupe_lots WHERE id = ?')
      .get(result.lotId) as { code: string; status: string; total_planned_qty: number; color_id: number };
    if (lot.status !== 'transfere' || lot.total_planned_qty !== 2 || lot.color_id !== colorId) {
      throw new Error(`Lot incohérent : ${JSON.stringify(lot)}`);
    }
    if ((db.prepare('SELECT lot_id FROM marker_plans WHERE id = ?')
      .get(brouillonPlanId) as { lot_id: number | null })?.lot_id !== result.lotId) {
      throw new Error('Lien plan → lot manquant.');
    }
    const transfer = db.prepare("SELECT status, code FROM coupe_transfers WHERE id = ?")
      .get(result.transferId) as { status: string; code: string };
    if (transfer.status !== 'confirme') throw new Error('Transfert attendu confirmé.');
    const line = db.prepare('SELECT qty, size_id FROM coupe_transfer_lines WHERE transfer_id = ?')
      .get(result.transferId) as { qty: number; size_id: number };
    if (line.qty !== 2 || line.size_id !== sizeM.id) {
      throw new Error(`Ligne de transfert incohérente : ${JSON.stringify(line)}`);
    }
    const savedCut = getPlan(db, brouillonPlanId).cutPieces;
    if (savedCut.find((piece) => piece.pieceId === devant.id)?.totalQty !== 4) {
      throw new Error('Le relevé des pièces coupées ne survit pas au rechargement du plan.');
    }
    const tickets = db.prepare(
      "SELECT code, type FROM production_tickets WHERE lot_id = ? ORDER BY type",
    ).all(result.lotId) as Array<{ code: string; type: string }>;
    const types = tickets.map((ticket) => ticket.type).sort();
    if (JSON.stringify(types) !== JSON.stringify(['coupe', 'transfert'])) {
      throw new Error(`Tickets attendus coupe+transfert, reçu : ${types.join(',')}`);
    }
    const history = db.prepare(
      "SELECT COUNT(*) AS n FROM coupe_history WHERE action = 'PLAN_TRANSFERE' AND entity_id = ?",
    ).get(brouillonPlanId) as { n: number };
    if (history.n !== 1) throw new Error('Traçabilité historique manquante.');
    const after = db.prepare(
      'SELECT remaining_weight_kg, status FROM coupe_rolls WHERE id = ?',
    ).get(roll.id) as { remaining_weight_kg: number; status: string };
    if (!(after.remaining_weight_kg < before.remaining_weight_kg)) {
      throw new Error('Consommation du rouleau non décomptée.');
    }
    if (result.fabricConsumedKg === null) throw new Error('Grammage connu : consommation attendue.');
  });

  check('Anti-doublon : second transfert du même plan refusé (409)', () => {
    expectServiceError(() => createCutTransfer(db, chef, {
      planId: brouillonPlanId,
      cutPieces: [{ pieceId: devant.id, qty: 2 }, { pieceId: dos.id, qty: 1 }, { pieceId: col.id, qty: 1 }],
      confirmCut: true,
    }), 409, 'déjà été transféré');
  });

  check('Bout-en-bout : la Couture voit le transfert et le réceptionne', () => {
    const pending = listPendingTransfers(couture);
    const found = pending.find((item) => item.lotCode === `LOT-P${brouillonPlanId}`);
    if (!found) throw new Error('Transfert invisible côté Couture.');
    const reception = receiveTransfer(couture, {
      transferId: found.transferId,
      lines: [{ sizeId: sizeM.id, receivedQty: 2 }],
    });
    if (reception.status !== 'complete') throw new Error('Réception complète attendue.');
    const balances = getLotBalances(couture).find((item) => item.lotId === found.lotId);
    if (!balances || balances.receivedQty !== 2) {
      throw new Error('Soldes couture incohérents après réception.');
    }
  });

  check('Plan sans grammage connu : transfert OK, consommation non décomptée', () => {
    const roll2 = createRoll(db, chef, {
      code: 'R-TRF-2',
      fabricRef: 'JERSEY',
      colorId,
      weightKg: 15,
      lengthM: 40,
      widthCm: 180,
      usableWidthCm: 170,
    });
    const plan2 = createPlan(db, chef, {
      revisionId: revision.id,
      rollId: roll2.id,
      tableId: table1,
      layers: 1,
      gapCm: 1,
      matelasLengthCm: 500,
      qty: 1,
    });
    savePlan(db, chef, plan2.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
      { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
      { pieceId: dos.id, x: 2 + devant.widthCm + 1, y: 80, rotation: 0 },
      { pieceId: col.id, x: 2, y: 160, rotation: 0 },
      { pieceId: col.id, x: 2 + devant.widthCm + 1, y: 160, rotation: 0 },
      { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
      { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
    ]);
    validatePlan(db, admin, plan2.id);
    const result = createCutTransfer(db, chef, {
      planId: plan2.id,
      cutPieces: fullCut(),
      confirmCut: true,
    });
    if (result.fabricConsumedKg !== null) {
      throw new Error('Sans grammage, la consommation doit rester inconnue.');
    }
    const reloaded = getPlan(db, plan2.id);
    if (reloaded.lot_id !== result.lotId) throw new Error('Lot non lié au plan 2.');
  });
}
