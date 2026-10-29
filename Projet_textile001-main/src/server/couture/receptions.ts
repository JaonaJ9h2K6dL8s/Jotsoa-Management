import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { ReceptionDTO } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import { addHistory, requireCouture, requireId, setLotStatus, toNumber } from './common';
import { requirePendingTransfer } from './balances';

/**
 * Réception des transferts confirmés du module Coupe.
 * Seuls les transferts confirmés et non déjà réceptionnés sont acceptés.
 * Un écart de quantité crée une alerte et bloque les quantités contestées.
 */

export function listReceptions(actor: Actor): ReceptionDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const receptions = db
    .prepare(
      `SELECT r.id, r.transfer_id, t.code AS transfer_code, t.ticket_no, r.lot_id,
              l.code AS lot_code, r.status, r.notes, r.received_at,
              u.nom || ' ' || u.prenom AS received_by_name
       FROM couture_receptions r
       JOIN coupe_transfers t ON t.id = r.transfer_id
       JOIN coupe_lots l ON l.id = r.lot_id
       JOIN users u ON u.id = r.received_by
       ORDER BY r.id DESC`,
    )
    .all() as Array<{
    id: number;
    transfer_id: number;
    transfer_code: string;
    ticket_no: string | null;
    lot_id: number;
    lot_code: string;
    status: 'complete' | 'partielle';
    notes: string | null;
    received_at: string;
    received_by_name: string | null;
  }>;
  return receptions.map((row) => ({
    id: row.id,
    transferId: row.transfer_id,
    transferCode: row.transfer_code,
    ticketNo: row.ticket_no,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    status: row.status,
    notes: row.notes,
    receivedByName: row.received_by_name,
    receivedAt: row.received_at,
    lines: (
      db
        .prepare(
          `SELECT rl.product_id, p.nom AS product_nom, c.nom AS color_nom,
                  rl.size_id, s.nom AS size_label,
                  rl.transferred_qty, rl.received_qty
           FROM couture_reception_lines rl
           JOIN products p ON p.id = rl.product_id
           JOIN colors c ON c.id = rl.color_id
           JOIN sizes s ON s.id = rl.size_id
           WHERE rl.reception_id = ? ORDER BY s.display_order, s.id`,
        )
        .all(row.id) as ReceptionDTO['lines']
    ).map((line) => ({
      ...line,
      productId: line.productId,
    })),
  }));
}

/**
 * Réceptionne un transfert Coupe confirmé.
 * Les quantités reçues sont saisies par taille ; toute quantité non
 * reçue devient « contestée » : bloquée et signalée par une alerte.
 */
export function receiveTransfer(
  actor: Actor,
  input: Record<string, unknown>,
): ReceptionDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const notes =
    typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) || null : null;
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const run = db.transaction((): number => {
    const pending = requirePendingTransfer(db, input.transferId);
    const received = new Map<number, number>();
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const transferred = pending.lines.get(sizeId);
      if (transferred === undefined) {
        throw new ServiceError(
          'Une taille saisie ne fait pas partie du transfert Coupe.',
          400,
        );
      }
      if (received.has(sizeId)) {
        throw new ServiceError('Chaque taille ne peut apparaître qu’une fois.', 400);
      }
      const qty = toNumber(record.receivedQty, 'La quantité reçue');
      if (qty < 0) {
        throw new ServiceError('La quantité reçue ne peut pas être négative.', 400);
      }
      if (qty > transferred) {
        throw new ServiceError(
          `Quantité reçue (${qty}) supérieure à la quantité transférée (${transferred}).`,
          400,
        );
      }
      received.set(sizeId, qty);
    }
    // Les tailles non saisies sont réceptionnées à 0 : réception explicite.
    const hasGap = [...pending.lines.entries()].some(
      ([sizeId, qty]) => (received.get(sizeId) ?? 0) < qty,
    );
    const result = db
      .prepare(
        `INSERT INTO couture_receptions (transfer_id, lot_id, status, notes, received_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        pending.transferId,
        pending.lotId,
        hasGap ? 'partielle' : 'complete',
        notes,
        actor.id,
      );
    const receptionId = Number(result.lastInsertRowid);
    const productColor = db
      .prepare('SELECT product_id, color_id FROM coupe_lots WHERE id = ?')
      .get(pending.lotId) as { product_id: number; color_id: number };
    for (const [sizeId, transferred] of pending.lines.entries()) {
      const qty = received.get(sizeId) ?? 0;
      db.prepare(
        `INSERT INTO couture_reception_lines
           (reception_id, product_id, color_id, size_id, transferred_qty, received_qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(receptionId, productColor.product_id, productColor.color_id, sizeId, transferred, qty);
      if (qty < transferred) {
        raiseAlert(db, {
          category: 'ECART_RECEPTION',
          severity: 'warning',
          objectType: 'lot_couture',
          objectId: pending.lotId,
          message: `Écart de réception sur le lot : ${transferred - qty} pièce(s) contestée(s) en taille ${sizeId}. Les quantités contestées restent bloquées jusqu'à résolution.`,
          ownerRole: 'chef_couture',
        });
        addHistory(db, {
          action: 'RECEPTION_ECART',
          entityType: 'lot_couture',
          entityId: pending.lotId,
          actorId: actor.id,
          newValue: { sizeId, transferred, received: qty },
        });
      }
    }
    setLotStatus(
      db,
      pending.lotId,
      hasGap ? 'reception_partielle' : 'a_affecter',
    );
    addHistory(db, {
      action: 'RECEPTION_CREATED',
      entityType: 'reception',
      entityId: receptionId,
      actorId: actor.id,
      newValue: { transferId: pending.transferId, lotId: pending.lotId, hasGap },
    });
    return receptionId;
  });
  const receptionId = run();
  const reception = listReceptions(actor).find((item) => item.id === receptionId);
  if (!reception) {
    throw new ServiceError('Réception introuvable après enregistrement.', 500);
  }
  return reception;
}
