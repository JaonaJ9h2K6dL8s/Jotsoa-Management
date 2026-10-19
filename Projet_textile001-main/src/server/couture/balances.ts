import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type {
  LotBalanceDTO,
  CoutureLotStatus,
  PendingTransferDTO,
} from '@/types/couture';
import { requireCouture, requireId } from './common';

/**
 * Soldes de quantités du module Couture, toujours recalculés depuis
 * les mouvements réels (réceptions, affectations, productions,
 * transferts) et jamais depuis des valeurs saisies librement.
 */

/** Soldes détaillés par taille pour un lot donné. */
export function getSizeBalances(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): Array<{
  sizeId: number;
  sizeLabel: string;
  transferred: number;
  received: number;
  contested: number;
  assigned: number;
  sewn: number;
  transferredCq: number;
}> {
  return db
    .prepare(
      `SELECT s.id AS sizeId, s.nom AS sizeLabel,
         (SELECT COALESCE(SUM(tl.qty), 0) FROM coupe_transfer_lines tl
          JOIN coupe_transfers t ON t.id = tl.transfer_id
          WHERE t.lot_id = ? AND t.status = 'confirme' AND tl.size_id = s.id) AS transferred,
         (SELECT COALESCE(SUM(rl.received_qty), 0) FROM couture_reception_lines rl
          JOIN couture_receptions r ON r.id = rl.reception_id
          WHERE r.lot_id = ? AND rl.size_id = s.id) AS received,
         (SELECT COALESCE(SUM(rl.transferred_qty - rl.received_qty), 0)
          FROM couture_reception_lines rl
          JOIN couture_receptions r ON r.id = rl.reception_id
          WHERE r.lot_id = ? AND rl.size_id = s.id) AS contested,
         (SELECT COALESCE(SUM(asz.planned_qty), 0)
          FROM couture_assignment_sizes asz
          JOIN couture_assignments a ON a.id = asz.assignment_id
          WHERE a.lot_id = ? AND a.status != 'annulee' AND asz.size_id = s.id) AS assigned,
         (SELECT COALESCE(SUM(p.qty), 0) FROM couture_productions p
          WHERE p.lot_id = ? AND p.status != 'annulee' AND p.size_id = s.id) AS sewn,
         (SELECT COALESCE(SUM(ctl.qty), 0) FROM couture_transfer_lines ctl
          JOIN couture_transfers t ON t.id = ctl.transfer_id
          WHERE t.lot_id = ? AND t.status = 'confirme' AND ctl.size_id = s.id) AS transferredCq
       FROM sizes s
       WHERE s.id IN (
         SELECT tl.size_id FROM coupe_transfer_lines tl
         JOIN coupe_transfers t ON t.id = tl.transfer_id
         WHERE t.lot_id = ? AND t.status = 'confirme'
       )
       ORDER BY s.display_order, s.id`,
    )
    .all(lotId, lotId, lotId, lotId, lotId, lotId, lotId) as Array<{
    sizeId: number;
    sizeLabel: string;
    transferred: number;
    received: number;
    contested: number;
    assigned: number;
    sewn: number;
    transferredCq: number;
  }>;
}

/** Soldes globaux de tous les lots connus en couture. */
export function getLotBalances(actor: Actor): LotBalanceDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const lots = db
    .prepare(
      `SELECT l.id, l.code, p.nom AS product_nom, c.nom AS color_nom,
              COALESCE(cs.status, 'en_attente_reception') AS status
       FROM coupe_lots l
       JOIN products p ON p.id = l.product_id
       JOIN colors c ON c.id = l.color_id
       LEFT JOIN couture_lot_status cs ON cs.lot_id = l.id
       WHERE EXISTS (
         SELECT 1 FROM coupe_transfers t
         WHERE t.lot_id = l.id AND t.status = 'confirme'
       )
       ORDER BY l.id DESC`,
    )
    .all() as Array<{
    id: number;
    code: string;
    product_nom: string;
    color_nom: string;
    status: CoutureLotStatus;
  }>;
  return lots.map((lot) => {
    const sizes = getSizeBalances(db, lot.id);
    const sum = (key: 'transferred' | 'received' | 'contested' | 'assigned' | 'sewn' | 'transferredCq') =>
      sizes.reduce((acc, size) => acc + size[key], 0);
    const assigned = sum('assigned');
    const sewn = sum('sewn');
    const transferredCq = sum('transferredCq');
    return {
      lotId: lot.id,
      lotCode: lot.code,
      productNom: lot.product_nom,
      colorNom: lot.color_nom,
      status: lot.status,
      transferredQty: sum('transferred'),
      receivedQty: sum('received'),
      contestedQty: sum('contested'),
      assignedQty: assigned,
      sewnQty: sewn,
      transferredCqQty: transferredCq,
      remainingToSew: Math.max(0, assigned - sewn),
      availableToAssign: Math.max(0, sum('received') - sum('contested') - assigned),
      availableToTransfer: Math.max(0, sewn - transferredCq),
    };
  });
}

/** Soldes détaillés par taille, protégés par le rôle chef_couture. */
export function getLotSizeBalances(
  actor: Actor,
  rawLotId: unknown,
): ReturnType<typeof getSizeBalances> {
  requireCouture(actor);
  return getSizeBalances(sessionsDb(), requireId(rawLotId, 'Lot'));
}

/** Transferts Coupe confirmés, éligibles à une réception couture. */
export function listPendingTransfers(actor: Actor): PendingTransferDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const transfers = db
    .prepare(
      `SELECT t.id, t.code, t.lot_id, t.confirmed_at, l.code AS lot_code,
              p.nom AS product_nom, c.nom AS color_nom
       FROM coupe_transfers t
       JOIN coupe_lots l ON l.id = t.lot_id
       JOIN products p ON p.id = l.product_id
       JOIN colors c ON c.id = l.color_id
       WHERE t.status = 'confirme'
         AND NOT EXISTS (
           SELECT 1 FROM couture_receptions r WHERE r.transfer_id = t.id
         )
       ORDER BY t.id DESC`,
    )
    .all() as Array<{
    id: number;
    code: string;
    lot_id: number;
    confirmed_at: string;
    lot_code: string;
    product_nom: string;
    color_nom: string;
  }>;
  return transfers.map((transfer) => ({
    transferId: transfer.id,
    transferCode: transfer.code,
    lotId: transfer.lot_id,
    lotCode: transfer.lot_code,
    productNom: transfer.product_nom,
    colorNom: transfer.color_nom,
    confirmedAt: transfer.confirmed_at,
    received: false,
    lines: (
      db
        .prepare(
          `SELECT tl.size_id, s.nom AS size_label, tl.qty
           FROM coupe_transfer_lines tl
           JOIN sizes s ON s.id = tl.size_id
           WHERE tl.transfer_id = ? ORDER BY s.display_order, s.id`,
        )
        .all(transfer.id) as Array<{ size_id: number; size_label: string; qty: number }>
    ).map((row) => ({
      sizeId: row.size_id,
      sizeLabel: row.size_label,
      qty: row.qty,
    })),
  }));
}

export function requirePendingTransfer(
  db: ReturnType<typeof sessionsDb>,
  rawTransferId: unknown,
): { transferId: number; lotId: number; lines: Map<number, number> } {
  const transferId = requireId(rawTransferId, 'Transfert Coupe');
  const transfer = db
    .prepare(
      "SELECT id, lot_id FROM coupe_transfers WHERE id = ? AND status = 'confirme'",
    )
    .get(transferId) as { id: number; lot_id: number } | undefined;
  if (!transfer) {
    throw new ServiceError(
      "Ce transfert Coupe n'existe pas ou n'est pas confirmé.",
      400,
    );
  }
  const already = db
    .prepare('SELECT id FROM couture_receptions WHERE transfer_id = ?')
    .get(transferId) as { id: number } | undefined;
  if (already) {
    throw new ServiceError(
      'Ce transfert a déjà été réceptionné : double réception refusée.',
      409,
    );
  }
  const lines = new Map<number, number>(
    (
      db
        .prepare(
          'SELECT size_id, qty FROM coupe_transfer_lines WHERE transfer_id = ?',
        )
        .all(transferId) as Array<{ size_id: number; qty: number }>
    ).map((row) => [row.size_id, row.qty]),
  );
  if (lines.size === 0) {
    throw new ServiceError('Transfert sans lignes de quantités.', 400);
  }
  return { transferId, lotId: transfer.lot_id, lines };
}
