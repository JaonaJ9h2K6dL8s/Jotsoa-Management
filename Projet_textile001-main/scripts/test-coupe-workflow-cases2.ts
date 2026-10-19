/**
 * Tests du workflow automatisé — partie 2 : transfert partiel,
 * réception avec écart, prévention des doubles opérations et
 * conservation de l'historique.
 */

import type Database from 'better-sqlite3';
import type { Actor } from '../src/server/users/users-service';
import { check, expect, throwsService } from './workflow-test-tools';

export interface TransferTestContext {
  db: Database.Database;
  workflow: typeof import('../src/server/coupe/lot-workflow');
  CHEF: Actor;
  lotId: number;
  sizeIds: number[];
  orderId: number;
}

export function runTransferCases(ctx: TransferTestContext): void {
  const { db, workflow, CHEF, lotId, sizeIds, orderId } = ctx;

  console.log('— Transfert vers la couture');

  check('la préparation du transfert produit le ticket et les paquets', () => {
    const lot = workflow.prepareTransfer(CHEF, lotId);
    expect(lot.status === 'transfert_pret', 'statut transfert_pret');
    const bundles = db
      .prepare('SELECT COUNT(*) total FROM coupe_bundles WHERE lot_id=?')
      .get(lotId) as { total: number };
    expect(bundles.total === 2, 'paquets par taille préparés');
    throwsService(() => workflow.prepareTransfer(CHEF, lotId), 409);
  });

  check('réception avec écart : quantités reçues < envoyées', () => {
    const lot = workflow.confirmTransfer(CHEF, {
      lotId,
      lines: [
        { sizeId: sizeIds[0], qty: 8 },
        { sizeId: sizeIds[1], qty: 6 },
      ],
    });
    expect(lot.status === 'transfere', 'statut transfere');
    const lines = db
      .prepare(
        `SELECT tl.qty FROM coupe_transfer_lines tl
         JOIN coupe_transfers t ON t.id = tl.transfer_id WHERE t.lot_id=?`,
      )
      .all(lotId) as Array<{ qty: number }>;
    const total = lines.reduce((sum, line) => sum + line.qty, 0);
    expect(total === 14, `transfert partiel enregistré (14 < 15)`);
  });

  check('la double confirmation de transfert est empêchée', () => {
    throwsService(
      () =>
        workflow.confirmTransfer(CHEF, {
          lotId,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      409,
    );
  });

  console.log('— Traçabilité');

  check('l’historique conserve toutes les opérations du lot', () => {
    const entries = db
      .prepare(
        `SELECT DISTINCT action FROM coupe_history
         WHERE entity_type='coupe_lot' AND entity_id=?`,
      )
      .all(lotId) as Array<{ action: string }>;
    const actions = entries.map((entry) => entry.action);
    for (const expected of [
      'lot_created_from_order',
      'lot_plan_generated',
      'lot_plan_validated',
      'lot_cutting_started',
      'lot_actual_recorded',
      'lot_results_confirmed',
      'lot_transfer_prepared',
      'lot_transfer_confirmed',
    ]) {
      expect(actions.includes(expected), `action ${expected} absente`);
    }
  });

  check('la commande suit le cycle complet des statuts', () => {
    const row = db
      .prepare('SELECT status FROM orders WHERE id=?')
      .get(orderId) as { status: string };
    expect(row.status === 'transféré', `statut commande : ${row.status}`);
  });
}
