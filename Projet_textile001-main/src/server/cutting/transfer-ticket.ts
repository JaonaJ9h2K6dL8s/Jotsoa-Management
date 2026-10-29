import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { requireId } from './common';
import type {
  TransferTicketDTO, TransferTicketListDTO,
  TransferTicketPieceRow, TransferTicketReceptionStatus,
} from '@/types/cutting-ticket';

export type {
  TransferTicketDTO, TransferTicketListDTO,
  TransferTicketPieceRow, TransferTicketReceptionStatus,
  TransferTicketSizeRow,
} from '@/types/cutting-ticket';

/**
 * Tickets de transfert Coupe → Couture (étape 17).
 * Le ticket est une preuve traçable de la remise des pièces entre
 * deux responsables : numéro lisible unique (TRF-AAAA-NNNNNN) généré
 * côté serveur, émetteur issu de la session authentifiée, réception
 * réelle enregistrée par un utilisateur Couture autorisé.
 * Toutes les fonctions ici sont des LECTURES ou une pure génération de
 * numéro : consulter, lister ou imprimer un ticket ne crée jamais de
 * transfert, ne consomme jamais de rouleau et ne préremplit jamais une
 * réception.
 */

/**
 * Numéro de ticket lisible : TRF-<année>-<séquence 6 chiffres>.
 * Appelé UNIQUEMENT à l'intérieur de la transaction de transfert
 * (SQLite = un seul écrivain) : deux transferts simultanés ne peuvent
 * pas produire le même numéro ; l'index unique protège en dernier
 * recours.
 */
export function nextTransferTicketNo(db: Database.Database): string {
  const year = new Date().getFullYear();
  const prefix = `TRF-${year}-`;
  const rows = db
    .prepare('SELECT ticket_no FROM coupe_transfers WHERE ticket_no LIKE ?')
    .all(`${prefix}%`) as Array<{ ticket_no: string }>;
  let max = 0;
  for (const row of rows) {
    const seq = Number(row.ticket_no.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

function appName(db: Database.Database): string {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'app_name'")
    .get() as { value: string } | undefined;
  return row?.value ?? '—';
}

const TICKET_SELECT = `
  SELECT t.id AS transfer_id, t.ticket_no, t.code, t.status, t.confirmed_at, t.notes,
         l.code AS lot_code, l.product_id, p.nom AS product_nom, c.nom AS color_nom,
         u.nom || ' ' || COALESCE(u.prenom, '') AS emitter_name, r.nom AS emitter_role,
         (SELECT COALESCE(SUM(qty), 0) FROM coupe_transfer_lines WHERE transfer_id = t.id)
           AS qty_sent,
         (SELECT COUNT(*) FROM coupe_transfer_piece_counts pc WHERE pc.transfer_id = t.id)
           AS piece_rows,
         (SELECT s.nom FROM coupe_transfer_lines ls
            JOIN sizes s ON s.id = ls.size_id
           WHERE ls.transfer_id = t.id ORDER BY s.display_order, s.id LIMIT 1)
           AS size_label,
         rec.status AS reception_status, rec.received_at, rec.notes AS reception_notes,
         ru.nom || ' ' || COALESCE(ru.prenom, '') AS received_by_name
  FROM coupe_transfers t
  JOIN coupe_lots l ON l.id = t.lot_id
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN colors c ON c.id = l.color_id
  JOIN users u ON u.id = t.performed_by
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN couture_receptions rec ON rec.transfer_id = t.id
  LEFT JOIN users ru ON ru.id = rec.received_by
`;

function receptionStatus(
  status: string | null,
): TransferTicketReceptionStatus {
  if (status === 'complete') return 'complete';
  if (status === 'partielle') return 'partielle';
  return 'en_attente';
}

/** Liste des tickets de transfert (lecture : chef de coupe / admin). */
export function listTransferTickets(
  db: Database.Database,
): TransferTicketListDTO[] {
  const rows = db
    .prepare(`${TICKET_SELECT} ORDER BY t.id DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    transferId: Number(row.transfer_id),
    ticketNo: (row.ticket_no as string | null) ?? null,
    code: String(row.code),
    status: String(row.status),
    confirmedAt: String(row.confirmed_at),
    lotCode: String(row.lot_code),
    planId: (db.prepare(
      'SELECT id FROM marker_plans WHERE lot_id = ?',
    ).get(row.transfer_id) as { id: number } | undefined)?.id ?? null,
    productName: (row.product_nom as string | null) ?? null,
    colorName: (row.color_nom as string | null) ?? null,
    sizeLabel: (row.size_label as string | null) ?? null,
    qtySent: Number(row.qty_sent),
    pieceRows: Number(row.piece_rows),
    emitterName: String(row.emitter_name).trim(),
    emitterRole: (row.emitter_role as string | null) ?? null,
    receptionStatus: receptionStatus(row.reception_status as string | null),
    receivedByName: (row.received_by_name as string | null) ?? null,
    receivedAt: (row.received_at as string | null) ?? null,
  }));
}

/** Ticket détaillé d'un transfert : pièces, tailles, émetteur, réception. */
export function getTransferTicket(
  db: Database.Database,
  rawTransferId: unknown,
): TransferTicketDTO {
  const transferId = requireId(rawTransferId, 'Le transfert');
  const row = db
    .prepare(`${TICKET_SELECT} WHERE t.id = ?`)
    .get(transferId) as Record<string, unknown> | undefined;
  if (!row) throw new ServiceError('Transfert introuvable.', 404);
  const planRow = db
    .prepare('SELECT id FROM marker_plans WHERE lot_id = ?')
    .get(row.transfer_id) as { id: number } | undefined;
  const pieces = (
    db
      .prepare(
        `SELECT pc.piece_id, pp.piece_code AS code, pp.piece_label AS label,
                pc.qty_per_layer, pc.layers
         FROM coupe_transfer_piece_counts pc
         JOIN pattern_pieces pp ON pp.id = pc.piece_id
         WHERE pc.transfer_id = ? ORDER BY pp.id`,
      )
      .all(transferId) as Array<{
      piece_id: number; code: string; label: string;
      qty_per_layer: number; layers: number;
    }>
  ).map((piece): TransferTicketPieceRow => {
    const qtySent = piece.qty_per_layer * piece.layers;
    return {
      pieceId: piece.piece_id,
      code: piece.code,
      label: piece.label,
      qtyPlanned: null,
      qtyPerLayer: piece.qty_per_layer,
      layers: piece.layers,
      qtySent,
    };
  });
  // Quantité prévue : placements enregistrés du plan validé × couches.
  if (planRow) {
    const raw = db
      .prepare('SELECT pieces_json FROM marker_plans WHERE id = ?')
      .get(planRow.id) as { pieces_json: string } | undefined;
    if (raw) {
      try {
        const placements = JSON.parse(raw.pieces_json) as Array<{
          piece_id?: number; pieceId?: number;
        }>;
        const placed = new Map<number, number>();
        for (const placement of placements) {
          const pieceId = placement.piece_id ?? placement.pieceId;
          if (typeof pieceId === 'number') {
            placed.set(pieceId, (placed.get(pieceId) ?? 0) + 1);
          }
        }
        const layers = pieces[0]?.layers ?? 1;
        for (const piece of pieces) {
          const count = placed.get(piece.pieceId);
          piece.qtyPlanned = count === undefined ? null : count * layers;
        }
      } catch { /* plan historique illisible : prévue reste null */ }
    }
  }
  const receptions = db
    .prepare(
      'SELECT id, status, notes, received_at FROM couture_receptions WHERE transfer_id = ?',
    )
    .all(transferId) as Array<{
    id: number; status: string; notes: string | null; received_at: string;
  }>;
  const reception = receptions[0] ?? null;
  const sizes = (
    db
      .prepare(
        `SELECT tl.size_id, s.nom AS size_label, tl.qty
         FROM coupe_transfer_lines tl JOIN sizes s ON s.id = tl.size_id
         WHERE tl.transfer_id = ? ORDER BY s.display_order, s.id`,
      )
      .all(transferId) as Array<{ size_id: number; size_label: string; qty: number }>
  ).map((size) => {
    const received = reception
      ? (db
        .prepare(
          'SELECT received_qty FROM couture_reception_lines WHERE reception_id = ? AND size_id = ?',
        )
        .get(reception.id, size.size_id) as { received_qty: number } | undefined)
        ?.received_qty ?? 0
      : null;
    const observation = received === null
      ? '—'
      : received < size.qty
        ? `Écart : ${size.qty - received} manquante(s)`
        : 'OK';
    return {
      sizeId: size.size_id,
      sizeLabel: size.size_label,
      qtySent: size.qty,
      qtyReceived: received,
      observation,
    };
  });
  return {
    transferId,
    ticketNo: (row.ticket_no as string | null) ?? null,
    code: String(row.code),
    status: String(row.status),
    confirmedAt: String(row.confirmed_at),
    appName: appName(db),
    lotCode: String(row.lot_code),
    planId: planRow?.id ?? null,
    productName: (row.product_nom as string | null) ?? null,
    colorName: (row.color_nom as string | null) ?? null,
    emitter: {
      name: String(row.emitter_name).trim(),
      role: (row.emitter_role as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
    },
    pieces,
    sizes,
    reception: reception
      ? {
        status: receptionStatus(reception.status),
        receivedByName: String(row.received_by_name ?? '').trim() || null,
        receivedAt: reception.received_at,
        notes: reception.notes,
      }
      : null,
  };
}
