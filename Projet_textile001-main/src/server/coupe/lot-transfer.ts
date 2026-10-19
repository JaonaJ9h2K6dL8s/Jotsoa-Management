/**
 * Transfert vers la couture : préparation automatique du ticket et des
 * paquets, confirmation de la remise physique avec écarts enregistrés.
 * Les quantités transférées ne sont jamais inventées : elles viennent
 * des résultats réels ou de la confirmation de réception.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { addHistory, nextCode, requireCoupe, requireId } from './common';
import { getOrder, updateOrderStatus } from '../orders/orders';
import { getLot } from './lot-shared';
import { storeTicket } from './tickets';

export interface TransferLineInput {
  sizeId: number;
  qty: number;
}

export interface ConfirmTransferInput {
  lotId: number;
  lines: TransferLineInput[];
}

export function prepareTransfer(actor: Actor, lotId: number): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(lotId, 'Lot'));
    if (lot.status !== 'coupe') throw new ServiceError('Le lot n\'est pas à l\'état coupé.', 409);

    const bundle = db.prepare('SELECT id FROM coupe_bundles WHERE lot_id=? LIMIT 1').get(lot.id) as { id: number } | undefined;
    if (!bundle) {
      const insert = db.prepare('INSERT INTO coupe_bundles (lot_id, size_id, qty, status, created_by) VALUES (?,?,?,?,?)');
      for (const size of lot.sizes) {
        if (size.cutQty > 0) insert.run(lot.id, size.sizeId, size.cutQty, 'pret', actor.id);
      }
    }

    storeTicket(actor, {
      type: 'transfert',
      lotId: lot.id,
      refOperation: `TRF-${lot.code}`,
      payload: { sizes: lot.sizes.filter((s) => s.cutQty > 0) },
    });

    db.prepare(`
      UPDATE coupe_lots SET status='transfert_pret', updated_at=datetime('now') WHERE id=?
    `).run(lot.id);

    addHistory(db, {
      action: 'lot_transfer_prepared',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
    });

    return getLot(actor, lot.id);
  }).immediate();
}

export function confirmTransfer(actor: Actor, input: ConfirmTransferInput): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(input.lotId, 'Lot'));
    if (lot.status !== 'transfert_pret') throw new ServiceError('Le transfert n\'est pas prêt.', 409);

    const totalTransfer = input.lines.reduce((sum, l) => sum + l.qty, 0);
    if (totalTransfer <= 0) throw new ServiceError('Aucune quantité à transférer.', 400);

    const code = nextCode(db, 'coupe_transfers', 'TF-');
    const transferId = Number(db.prepare(`
      INSERT INTO coupe_transfers (lot_id, code, status, performed_by, notes)
      VALUES (?, ?, 'confirme', ?, ?)
    `).run(lot.id, code, actor.id, 'Transfert confirmé depuis le workflow automatisé').lastInsertRowid);

    const insertLine = db.prepare('INSERT INTO coupe_transfer_lines (transfer_id, product_id, color_id, size_id, qty) VALUES (?,?,?,?,?)');
    for (const line of input.lines) {
      insertLine.run(transferId, lot.productId, lot.colorId, line.sizeId, line.qty);
    }

    db.prepare("UPDATE coupe_bundles SET status='transfere' WHERE lot_id=?").run(lot.id);
    db.prepare(`
      UPDATE coupe_lots SET status='transfere', updated_at=datetime('now') WHERE id=?
    `).run(lot.id);

    if (lot.orderId) {
      updateOrderStatus(actor, lot.orderId, 'transféré');
    }

    addHistory(db, {
      action: 'lot_transfer_confirmed',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      newValue: { transferCode: code, lines: input.lines },
    });

    return getLot(actor, lot.id);
  }).immediate();
}
