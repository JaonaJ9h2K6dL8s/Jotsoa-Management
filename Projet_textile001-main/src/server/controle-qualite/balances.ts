import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type {
  CqLotBalanceDTO,
  CqSizeBalanceDTO,
  PendingCqTransferDTO,
} from '@/types/cq';
import { requireCq, requireId } from './common';

/**
 * Soldes de quantités du Contrôle qualité, toujours recalculés depuis
 * les mouvements réels (réceptions, contrôles, défauts, retouches,
 * contrôles finaux, transferts stock) — jamais depuis des valeurs
 * saisies librement dans l'interface.
 */

interface BalanceRow {
  size_id: number;
  size_label: string;
  received: number;
  inspected: number;
  conforme_initial: number;
  conforme_final: number;
  rework: number;
  rebut_initial: number;
  rebut_final: number;
  transferred_stock: number;
}

const BALANCE_SELECT = `
  SELECT s.id AS size_id, s.nom AS size_label,
    (SELECT COALESCE(SUM(rl.received_qty), 0) FROM cq_reception_lines rl
       JOIN cq_receptions r ON r.id = rl.reception_id
       WHERE r.lot_id = :lotId AND rl.size_id = s.id) AS received,
    (SELECT COALESCE(SUM(cl.inspected_qty), 0) FROM cq_controle_lines cl
       JOIN cq_controles c ON c.id = cl.controle_id
       WHERE c.lot_id = :lotId AND cl.size_id = s.id) AS inspected,
    (SELECT COALESCE(SUM(cl.conforme_qty), 0) FROM cq_controle_lines cl
       JOIN cq_controles c ON c.id = cl.controle_id
       WHERE c.lot_id = :lotId AND cl.size_id = s.id) AS conforme_initial,
    (SELECT COALESCE(SUM(fl.conforme_qty), 0) FROM cq_final_lines fl
       JOIN cq_final_controls fc ON fc.id = fl.final_id
       JOIN cq_rework_requests rr ON rr.id = fc.request_id
       WHERE rr.lot_id = :lotId AND fl.size_id = s.id) AS conforme_final,
    (SELECT COALESCE(SUM(rwl.qty), 0) FROM cq_rework_lines rwl
       JOIN cq_rework_requests rw ON rw.id = rwl.request_id
       WHERE rw.lot_id = :lotId AND rw.status != 'annulee'
         AND rwl.size_id = s.id) AS rework,
    (SELECT COALESCE(SUM(d.qty_pieces), 0) FROM cq_defauts d
       WHERE d.lot_id = :lotId AND d.decision = 'rebut' AND d.size_id = s.id) AS rebut_initial,
    (SELECT COALESCE(SUM(fl.rebut_qty), 0) FROM cq_final_lines fl
       JOIN cq_final_controls fc ON fc.id = fl.final_id
       JOIN cq_rework_requests rr ON rr.id = fc.request_id
       WHERE rr.lot_id = :lotId AND fl.size_id = s.id) AS rebut_final,
    (SELECT COALESCE(SUM(stl.qty), 0) FROM cq_stock_transfer_lines stl
       JOIN cq_stock_transfers st ON st.id = stl.transfer_id
       WHERE st.lot_id = :lotId AND st.status = 'confirme'
         AND stl.size_id = s.id) AS transferred_stock
  FROM sizes s
  WHERE s.id IN (
    SELECT rl.size_id FROM cq_reception_lines rl
      JOIN cq_receptions r ON r.id = rl.reception_id WHERE r.lot_id = :lotId
  )
  ORDER BY s.display_order, s.id`;

function mapBalance(row: BalanceRow): CqSizeBalanceDTO {
  const conforme = row.conforme_initial + row.conforme_final;
  const rebut = row.rebut_initial + row.rebut_final;
  return {
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    received: row.received,
    inspected: row.inspected,
    conforme,
    rework: row.rework,
    rebut,
    transferredStock: row.transferred_stock,
    availableStock: Math.max(0, conforme - row.transferred_stock),
  };
}

/** Soldes par taille d'un lot (protégé par le rôle controleur_qualite). */
export function getLotSizeBalances(
  actor: Actor,
  rawLotId: unknown,
): CqSizeBalanceDTO[] {
  requireCq(actor);
  const lotId = requireId(rawLotId, 'Lot');
  const rows = sessionsDb()
    .prepare(BALANCE_SELECT)
    .all({ lotId }) as BalanceRow[];
  return rows.map(mapBalance);
}

/** Soldes agrégés de tous les lots reçus au contrôle qualité. */
export function getLotBalances(actor: Actor): CqLotBalanceDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  const lots = db
    .prepare(
      `SELECT DISTINCT r.lot_id, l.code AS lot_code, p.nom AS product_nom,
              c.nom AS color_nom, r.code AS reception_code
       FROM cq_receptions r
       JOIN coupe_lots l ON l.id = r.lot_id
       JOIN products p ON p.id = l.product_id
       JOIN colors c ON c.id = l.color_id
       ORDER BY r.id DESC`,
    )
    .all() as Array<{
    lot_id: number;
    lot_code: string;
    product_nom: string;
    color_nom: string;
    reception_code: string;
  }>;
  return lots.map((lot) => {
    const sizes = getLotSizeBalances(actor, lot.lot_id);
    const controle = db
      .prepare(
        `SELECT code, status FROM cq_controles WHERE lot_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(lot.lot_id) as { code: string; status: string } | undefined;
    const sum = (key: keyof CqSizeBalanceDTO) =>
      sizes.reduce((acc, size) => acc + (size[key] as number), 0);
    const totalReceived = sum('received');
    const totalInspected = sum('inspected');
    return {
      lotId: lot.lot_id,
      lotCode: lot.lot_code,
      productNom: lot.product_nom,
      colorNom: lot.color_nom,
      receptionCode: lot.reception_code,
      controleCode: controle?.code ?? null,
      controleStatus: (controle?.status as CqLotBalanceDTO['controleStatus']) ?? null,
      totalReceived,
      totalInspected,
      totalConforme: sum('conforme'),
      totalRework: sum('rework'),
      totalRebut: sum('rebut'),
      totalPending: Math.max(0, totalReceived - totalInspected),
      totalAvailableStock: sum('availableStock'),
      sizes,
    };
  });
}

/**
 * Transferts couture confirmés, éligibles à une réception CQ :
 * statut « confirme » côté couture et sans réception existante.
 */
export function listPendingCqTransfers(actor: Actor): PendingCqTransferDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  return db
    .prepare(
      `SELECT t.id AS transfer_id, t.code AS transfer_code, t.lot_id,
              l.code AS lot_code, p.nom AS product_nom, c.nom AS color_nom,
              sr.nom AS room_nom, sl.nom AS line_nom, t.confirmed_at
       FROM couture_transfers t
       JOIN coupe_lots l ON l.id = t.lot_id
       JOIN products p ON p.id = l.product_id
       JOIN colors c ON c.id = l.color_id
       LEFT JOIN couture_assignments a ON a.id = t.assignment_id
       LEFT JOIN sewing_rooms sr ON sr.id = a.room_id
       LEFT JOIN sewing_lines sl ON sl.id = a.line_id
       WHERE t.status = 'confirme'
         AND NOT EXISTS (SELECT 1 FROM cq_receptions r WHERE r.transfer_id = t.id)
       ORDER BY t.id DESC`,
    )
    .all()
    .map((row) => {
      const item = row as {
        transfer_id: number;
        transfer_code: string;
        lot_id: number;
        lot_code: string;
        product_nom: string;
        color_nom: string;
        room_nom: string | null;
        line_nom: string | null;
        confirmed_at: string;
      };
      const lines = db
        .prepare(
          `SELECT ctl.size_id, s.nom AS size_label, ctl.qty
           FROM couture_transfer_lines ctl
           JOIN sizes s ON s.id = ctl.size_id
           WHERE ctl.transfer_id = ? ORDER BY s.display_order, s.id`,
        )
        .all(item.transfer_id) as Array<{ size_id: number; size_label: string; qty: number }>;
      return {
        transferId: item.transfer_id,
        transferCode: item.transfer_code,
        lotId: item.lot_id,
        lotCode: item.lot_code,
        productNom: item.product_nom,
        colorNom: item.color_nom,
        roomNom: item.room_nom ?? '',
        lineNom: item.line_nom ?? '',
        confirmedAt: item.confirmed_at,
        lines: lines.map((line) => ({
          sizeId: line.size_id,
          sizeLabel: line.size_label,
          qty: line.qty,
        })),
      };
    });
}

/** Vérifie qu'un transfert couture est réceptionnable (transaction). */
export function requireReceivableTransfer(
  db: ReturnType<typeof sessionsDb>,
  transferId: number,
): {
  id: number;
  lot_id: number;
  product_id: number;
  color_id: number;
  status: string;
} {
  const transfer = db
    .prepare(
      `SELECT t.id, t.lot_id, t.status, l.product_id, l.color_id
       FROM couture_transfers t
       JOIN coupe_lots l ON l.id = t.lot_id
       WHERE t.id = ?`,
    )
    .get(transferId) as
    | { id: number; lot_id: number; product_id: number; color_id: number; status: string }
    | undefined;
  if (!transfer) {
    throw new ServiceError('Transfert couture introuvable.', 404);
  }
  if (transfer.status !== 'confirme') {
    throw new ServiceError(
      'Seul un transfert confirmé par la couture peut être réceptionné.',
      400,
    );
  }
  return transfer;
}
