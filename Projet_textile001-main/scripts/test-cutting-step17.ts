/**
 * Tests du ticket de transfert Coupe → Couture (étape 17).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Couverture : numéro lisible unique (TRF-AAAA-NNNNNN) généré côté
 * serveur, émetteur issu de la session, réception complète/partielle
 * par un utilisateur Couture autorisé, refus des non-autorisés,
 * double réception refusée, lecture/impression sans effet de bord,
 * transferts historiques sans ticket présentés sans données inventées.
 * Base de test isolée (createTestDb) — jamais le plan historique #20.
 */

import type { Actor } from '../src/server/users/users-service';
import { ServiceError } from '../src/server/api/service-error';
import { createRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { createCutTransfer } from '../src/server/cutting/transfer';
import {
  getTransferTicket, listTransferTickets,
} from '../src/server/cutting/transfer-ticket';
import { receiveTransfer } from '../src/server/couture/receptions';
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

export function runCuttingStep17Tests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-step17-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
  const roll = createRoll(db, chef, {
    code: 'R-E17-1',
    fabricRef: 'JERSEY-180',
    colorId,
    weightKg: 20,
    // Cohérent : implicite = 20000/(61,7×1,8) ≈ 180 g/m².
    lengthM: 61.7,
    widthCm: 180,
    usableWidthCm: 170,
    grammageGm2: 180,
  });
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId,
    sizeId: sizeM.id,
    mesures: TSHIRT_MESURES,
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'").get() as { id: number }).id;
  const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
    id: number; widthCm: number;
  };
  const dos = revision.pieces.find((piece) => piece.code === 'dos') as { id: number };
  const col = revision.pieces.find((piece) => piece.code === 'col') as { id: number };
  const mancheG = revision.pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
  const mancheD = revision.pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
  const fullCut = (): Array<{ pieceId: number; qty: number }> => [
    { pieceId: devant.id, qty: 2 },
    { pieceId: dos.id, qty: 1 },
    { pieceId: mancheG.id, qty: 1 },
    { pieceId: mancheD.id, qty: 1 },
    { pieceId: col.id, qty: 1 },
  ];
  const buildPlan = (): number => {
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 2, gapCm: 1, matelasLengthCm: 500, qty: 1,
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

  const planA = buildPlan();
  const planB = buildPlan();
  const transferA = createCutTransfer(db, chef, {
    planId: planA, cutPieces: fullCut(), confirmCut: true,
  });
  const transferB = createCutTransfer(db, chef, {
    planId: planB, cutPieces: fullCut(), confirmCut: true,
  });
  const year = new Date().getFullYear();

  check('Ticket : numéro lisible TRF-AAAA-NNNNNN généré côté serveur', () => {
    const pattern = new RegExp(`^TRF-${year}-\\d{6}$`);
    if (!pattern.test(transferA.ticketNo)) {
      throw new Error(`Numéro inattendu : ${transferA.ticketNo}`);
    }
    if (!pattern.test(transferB.ticketNo)) {
      throw new Error(`Numéro inattendu : ${transferB.ticketNo}`);
    }
    if (transferA.ticketNo === transferB.ticketNo) {
      throw new Error('Deux transferts ont reçu le même numéro.');
    }
    const stored = db.prepare(
      'SELECT ticket_no, performed_by FROM coupe_transfers WHERE id = ?',
    ).get(transferA.transferId) as { ticket_no: string; performed_by: number };
    if (stored.ticket_no !== transferA.ticketNo) {
      throw new Error('Numéro non persisté sur le transfert.');
    }
    if (stored.performed_by !== chef.id) {
      throw new Error('L’émetteur doit être l’utilisateur authentifié du transfert.');
    }
  });

  check('Ticket : unicité en base (index unique)', () => {
    const duplicates = db.prepare(
      `SELECT ticket_no FROM coupe_transfers
       WHERE ticket_no IS NOT NULL GROUP BY ticket_no HAVING COUNT(*) > 1`,
    ).all();
    if (duplicates.length > 0) throw new Error('Numéros de ticket dupliqués.');
  });

  check('Ticket : liste — émetteur, quantité, réception en attente', () => {
    const tickets = listTransferTickets(db);
    if (tickets.length !== 2) {
      throw new Error(`2 tickets attendus, reçu ${tickets.length}.`);
    }
    if (tickets[0].transferId !== transferB.transferId) {
      throw new Error('Ordre attendu : plus récent d’abord.');
    }
    for (const ticket of tickets) {
      if (ticket.receptionStatus !== 'en_attente') {
        throw new Error(`Réception prématurée : ${ticket.receptionStatus}`);
      }
      if (!ticket.emitterName.includes('Chef')) {
        throw new Error(`Émetteur inattendu : ${ticket.emitterName}`);
      }
      if (ticket.emitterRole !== 'Chef de coupe') {
        throw new Error(`Fonction inattendue : ${String(ticket.emitterRole)}`);
      }
      if (ticket.qtySent !== 2 || ticket.pieceRows !== 5) {
        throw new Error(`Lignes incohérentes : qty=${ticket.qtySent}, pièces=${ticket.pieceRows}`);
      }
      if (ticket.productName === null || ticket.sizeLabel !== 'M') {
        throw new Error('Produit/taille du ticket manquants.');
      }
      if (ticket.planId === null) {
        throw new Error('Plan de coupe associé introuvable.');
      }
    }
  });

  check('Ticket : détail — prévue = placements × couches, envoyée exacte', () => {
    const ticket = getTransferTicket(db, transferA.transferId);
    if (ticket.appName === '—') throw new Error('Nom d’application absent.');
    if (ticket.reception !== null) {
      throw new Error('Aucune réception ne doit être préremplie.');
    }
    const planned = new Map(ticket.pieces.map((piece) => [piece.code, piece.qtyPlanned]));
    if (planned.get('devant') !== 4 || planned.get('dos') !== 2 || planned.get('col') !== 2) {
      throw new Error(`Quantités prévues incohérentes : ${JSON.stringify([...planned])}`);
    }
    const sent = new Map(ticket.pieces.map((piece) => [piece.code, piece.qtySent]));
    if (sent.get('devant') !== 4 || sent.get('dos') !== 2) {
      throw new Error('Quantités envoyées incohérentes avec le relevé de coupe.');
    }
    if (ticket.sizes.length !== 1 || ticket.sizes[0].qtySent !== 2
      || ticket.sizes[0].qtyReceived !== null) {
      throw new Error('Lignes de taille incohérentes avant réception.');
    }
  });

  check('Ticket : consultation/impression = lecture pure, aucun effet de bord', () => {
    const before = {
      transfers: (db.prepare('SELECT COUNT(*) AS n FROM coupe_transfers').get() as { n: number }).n,
      receptions: (db.prepare('SELECT COUNT(*) AS n FROM couture_receptions').get() as { n: number }).n,
      tickets: (db.prepare('SELECT COUNT(*) AS n FROM production_tickets').get() as { n: number }).n,
      movements: (db.prepare('SELECT COUNT(*) AS n FROM coupe_roll_movements').get() as { n: number }).n,
      roll: (db.prepare('SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?')
        .get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg,
    };
    listTransferTickets(db);
    getTransferTicket(db, transferA.transferId);
    getTransferTicket(db, transferB.transferId);
    const after = {
      transfers: (db.prepare('SELECT COUNT(*) AS n FROM coupe_transfers').get() as { n: number }).n,
      receptions: (db.prepare('SELECT COUNT(*) AS n FROM couture_receptions').get() as { n: number }).n,
      tickets: (db.prepare('SELECT COUNT(*) AS n FROM production_tickets').get() as { n: number }).n,
      movements: (db.prepare('SELECT COUNT(*) AS n FROM coupe_roll_movements').get() as { n: number }).n,
      roll: (db.prepare('SELECT remaining_weight_kg FROM coupe_rolls WHERE id = ?')
        .get(roll.id) as { remaining_weight_kg: number }).remaining_weight_kg,
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('La consultation a modifié des données : lecture pure attendue.');
    }
  });

  check('Ticket : réception refusée à un non-Couture (403)', () => {
    expectServiceError(() => receiveTransfer(chef as unknown as Actor, {
      transferId: transferA.transferId,
      lines: [{ sizeId: sizeM.id, receivedQty: 2 }],
    }), 403);
  });

  check('Ticket : réception partielle tracée avec écart', () => {
    receiveTransfer(couture, {
      transferId: transferA.transferId,
      lines: [{ sizeId: sizeM.id, receivedQty: 1 }],
      notes: 'Un carton ouvert, 1 vêtement manquant.',
    });
    const ticket = getTransferTicket(db, transferA.transferId);
    if (ticket.reception === null || ticket.reception.status !== 'partielle') {
      throw new Error('Statut « partielle » attendu.');
    }
    if (!ticket.reception.receivedByName?.includes('Couture')) {
      throw new Error('Réceptionnaire Couture attendu.');
    }
    if (ticket.sizes[0].qtyReceived !== 1
      || !ticket.sizes[0].observation.includes('Écart')) {
      throw new Error('Écart de réception non tracé.');
    }
    const list = listTransferTickets(db)
      .find((item) => item.transferId === transferA.transferId);
    if (list?.receptionStatus !== 'partielle') {
      throw new Error('Liste : réception partielle attendue.');
    }
  });

  check('Ticket : réception complète sans écart', () => {
    receiveTransfer(couture, {
      transferId: transferB.transferId,
      lines: [{ sizeId: sizeM.id, receivedQty: 2 }],
    });
    const ticket = getTransferTicket(db, transferB.transferId);
    if (ticket.reception === null || ticket.reception.status !== 'complete') {
      throw new Error('Statut « complete » attendu.');
    }
    if (ticket.sizes[0].observation !== 'OK') {
      throw new Error(`Observation attendue « OK », reçue : ${ticket.sizes[0].observation}`);
    }
  });

  check('Ticket : double réception refusée, aucun second enregistrement', () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM couture_receptions')
      .get() as { n: number }).n;
    expectServiceError(() => receiveTransfer(couture, {
      transferId: transferA.transferId,
      lines: [{ sizeId: sizeM.id, receivedQty: 2 }],
    }), 409, 'déjà été réceptionné');
    const after = (db.prepare('SELECT COUNT(*) AS n FROM couture_receptions')
      .get() as { n: number }).n;
    if (before !== after) throw new Error('Une double réception a été enregistrée.');
  });

  check('Ticket : transferts historiques sans numéro présentés sans invention', () => {
    db.prepare('UPDATE coupe_transfers SET ticket_no = NULL WHERE id = ?')
      .run(transferB.transferId);
    const list = listTransferTickets(db)
      .find((item) => item.transferId === transferB.transferId);
    if (!list || list.ticketNo !== null || list.code !== transferB.transferCode) {
      throw new Error('Transfert historique : code brut attendu.');
    }
    const ticket = getTransferTicket(db, transferB.transferId);
    if (ticket.ticketNo !== null) throw new Error('ticket_no doit rester NULL.');
    if (!ticket.reception) throw new Error('La réception réelle reste consultable.');
  });
}
