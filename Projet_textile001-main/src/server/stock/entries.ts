import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { StEntryDTO, StPendingCqTransferDTO } from '@/types/stock';
import { addHistory, nextCode, normalizeText, requireId, requireStock } from './common';

/**
 * Entrées de vêtements finis : seule source autorisée = un transfert
 * CQ confirmé (quantités réellement conformes). La réception est
 * atomique : lignes de carton + mouvement d'entrée + traçabilité.
 * La détection de doublon et l'alerte associée sortent de la
 * transaction pour survivre au refus (pattern CQ/Retouche).
 */

interface TransferRow {
  id: number;
  code: string;
  controle_id: number;
  lot_id: number;
  status: string;
  confirmed_at: string;
}

interface TransferLineRow {
  size_id: number;
  size_label: string;
  qty: number;
}

interface EntryRow {
  id: number;
  code: string;
  transfer_code: string;
  controle_code: string;
  lot_code: string;
  received_by_name: string | null;
  notes: string | null;
  created_at: string;
}

interface EntryLineRow {
  lot_code: string;
  controle_code: string;
  size_label: string;
  carton_code: string;
  qty: number;
}

function mapEntry(db: import('better-sqlite3').Database, row: EntryRow): StEntryDTO {
  const lines = (
    db
      .prepare(
        `SELECT l.code AS lot_code, c.code AS controle_code,
                s.nom AS size_label, ct.code AS carton_code, el.qty
         FROM st_entry_lines el
         JOIN coupe_lots l ON l.id = el.lot_id
         JOIN cq_controles c ON c.id = el.controle_id
         JOIN sizes s ON s.id = el.size_id
         JOIN st_cartons ct ON ct.id = el.carton_id
         WHERE el.entry_id = ? ORDER BY s.nom`,
      )
      .all(row.id) as EntryLineRow[]
  ).map((line) => ({
    lotCode: line.lot_code,
    controleCode: line.controle_code,
    sizeLabel: line.size_label,
    cartonCode: line.carton_code,
    qty: line.qty,
  }));
  return {
    id: row.id,
    code: row.code,
    transferCode: row.transfer_code,
    controleCode: row.controle_code,
    lotCode: row.lot_code,
    receivedByName: row.received_by_name,
    notes: row.notes,
    createdAt: row.created_at,
    lines,
  };
}

/** Transferts CQ confirmés pas encore réceptionnés en stock. */
export function listPendingCqTransfers(actor: Actor): StPendingCqTransferDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT t.id, t.code AS transfer_code, t.controle_id, t.lot_id,
                t.status, t.confirmed_at, c.code AS controle_code,
                l.code AS lot_code, p.nom AS product_nom, col.nom AS color_nom
         FROM cq_stock_transfers t
         JOIN cq_controles c ON c.id = t.controle_id
         JOIN coupe_lots l ON l.id = t.lot_id
         JOIN products p ON p.id = l.product_id
         JOIN colors col ON col.id = l.color_id
         WHERE t.status = 'confirme'
           AND NOT EXISTS (SELECT 1 FROM st_entries e WHERE e.transfer_id = t.id)
         ORDER BY t.id`,
      )
      .all() as Array<{
        id: number;
        transfer_code: string;
        controle_id: number;
        controle_code: string;
        lot_id: number;
        lot_code: string;
        product_nom: string;
        color_nom: string;
        confirmed_at: string;
      }>
    )
    .map((row) => {
      const lines = (
        db
          .prepare(
            `SELECT tl.size_id, s.nom AS size_label, tl.qty
               FROM cq_stock_transfer_lines tl
               JOIN sizes s ON s.id = tl.size_id
               WHERE tl.transfer_id = ? ORDER BY s.nom`,
          )
          .all(row.id) as TransferLineRow[]
      ).map((line) => ({
        sizeId: line.size_id,
        sizeLabel: line.size_label,
        qty: line.qty,
      }));
      return {
        transferId: row.id,
        transferCode: row.transfer_code,
        controleId: row.controle_id,
        controleCode: row.controle_code,
        lotId: row.lot_id,
        lotCode: row.lot_code,
        productNom: row.product_nom,
        colorNom: row.color_nom,
        confirmedAt: row.confirmed_at,
        lines,
      };
    });
}

export function listEntries(actor: Actor): StEntryDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT e.id, e.code, t.code AS transfer_code, c.code AS controle_code,
                l.code AS lot_code, u.nom || ' ' || u.prenom AS received_by_name,
                e.notes, e.created_at
         FROM st_entries e
         JOIN cq_stock_transfers t ON t.id = e.transfer_id
         JOIN cq_controles c ON c.id = t.controle_id
         JOIN coupe_lots l ON l.id = t.lot_id
         LEFT JOIN users u ON u.id = e.received_by
         ORDER BY e.id DESC`,
      )
      .all() as EntryRow[]
  ).map((row) => mapEntry(db, row));
}

/**
 * Réception d'un transfert CQ : chaque taille du transfert est rangée
 * dans un carton ouvert (plusieurs cartons possibles). Quantité exacte
 * = quantité transférée ; aucune saisie libre.
 */
export function receiveCqTransfer(
  actor: Actor,
  input: Record<string, unknown>,
): StEntryDTO {
  requireStock(actor);
  const db = sessionsDb();
  const transferId = requireId(input.transferId, 'Transfert');
  const notes = normalizeText(input.notes, 300);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Indiquez le carton de destination pour chaque taille.', 400);
  }

  // Détection de doublon hors transaction : l'alerte persiste après refus.
  const existing = db
    .prepare('SELECT id, code FROM st_entries WHERE transfer_id = ?')
    .get(transferId) as { id: number; code: string } | undefined;
  if (existing) {
    raiseAlert(db, {
      category: 'DOUBLON_ENTREE_STOCK',
      severity: 'warning',
      objectType: 'cq_stock_transfer',
      objectId: transferId,
      message: `Tentative de réception en double du transfert ${existing.code}.`,
      ownerRole: 'chef_stock',
    });
    throw new ServiceError(
      `Ce transfert CQ a déjà été réceptionné en stock (entrée ${existing.code}).`,
      409,
    );
  }

  const transfer = db
    .prepare('SELECT id, code, controle_id, lot_id, status FROM cq_stock_transfers WHERE id = ?')
    .get(transferId) as TransferRow | undefined;
  if (!transfer) throw new ServiceError('Transfert CQ introuvable.', 404);
  if (transfer.status !== 'confirme') {
    throw new ServiceError(
      'Seul un transfert confirmé par le Contrôle qualité peut être réceptionné.',
      409,
    );
  }
  const transferLines = db
    .prepare(
      `SELECT tl.size_id, s.nom AS size_label, tl.qty
       FROM cq_stock_transfer_lines tl JOIN sizes s ON s.id = tl.size_id
       WHERE tl.transfer_id = ?`,
    )
    .all(transferId) as TransferLineRow[];

  const run = db.transaction((): number => {
    const bySize = new Map(transferLines.map((line) => [line.size_id, line]));
    const seen = new Set<number>();
    const resolved: Array<{ sizeId: number; cartonId: number; qty: number }> = [];
    for (const raw of rawLines as Array<Record<string, unknown>>) {
      const sizeId = requireId(raw.sizeId, 'Taille');
      const cartonId = requireId(raw.cartonId, 'Carton');
      if (seen.has(sizeId)) {
        throw new ServiceError('Chaque taille ne doit apparaître qu’une seule fois.', 400);
      }
      seen.add(sizeId);
      const line = bySize.get(sizeId);
      if (!line) {
        throw new ServiceError(
          'Une taille indiquée ne fait pas partie de ce transfert.',
          400,
        );
      }
      const carton = db
        .prepare('SELECT id, code, status FROM st_cartons WHERE id = ?')
        .get(cartonId) as { id: number; code: string; status: string } | undefined;
      if (!carton || carton.status !== 'remplissage') {
        throw new ServiceError(
          'Chaque quantité doit être rangée dans un carton ouvert (en remplissage).',
          409,
        );
      }
      resolved.push({ sizeId, cartonId, qty: line.qty });
    }
    for (const line of transferLines) {
      if (!seen.has(line.size_id)) {
        throw new ServiceError(
          `La taille « ${line.size_label} » du transfert n'est pas rangée.`,
          400,
        );
      }
    }
    const code = nextCode(db, 'st_entries', 'ES-');
    const result = db
      .prepare(
        `INSERT INTO st_entries (code, transfer_id, received_by, notes)
         VALUES (?, ?, ?, ?)`,
      )
      .run(code, transferId, actor.id, notes);
    const entryId = Number(result.lastInsertRowid);
    for (const item of resolved) {
      const line = bySize.get(item.sizeId) as TransferLineRow;
      db.prepare(
        `INSERT INTO st_entry_lines
           (entry_id, lot_id, controle_id, size_id, carton_id, qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(entryId, transfer.lot_id, transfer.controle_id, item.sizeId, item.cartonId, line.qty);
      const upsert = db.prepare(
        `INSERT INTO st_carton_lines (carton_id, lot_id, controle_id, size_id, qty)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (carton_id, lot_id, controle_id, size_id)
         DO UPDATE SET qty = qty + excluded.qty`,
      ).run(item.cartonId, transfer.lot_id, transfer.controle_id, item.sizeId, line.qty);
      if (upsert.changes === 0) {
        throw new ServiceError('Rangement du carton impossible.', 500);
      }
      db.prepare(
        `INSERT INTO st_movements
           (movement_type, lot_id, size_id, qty, carton_id, source_type, source_id, reason, user_id)
         VALUES ('entree_cq', ?, ?, ?, ?, 'st_entry', ?, NULL, ?)`,
      ).run(transfer.lot_id, item.sizeId, line.qty, item.cartonId, entryId, actor.id);
    }
    addHistory(db, {
      action: 'ENTREE_CQ_RECUE',
      entityType: 'st_entry',
      entityId: entryId,
      actorId: actor.id,
      newValue: { code, transferId },
    });
    return entryId;
  });
  const entryId = run();
  const row = db
    .prepare(
      `SELECT e.id, e.code, t.code AS transfer_code, c.code AS controle_code,
              l.code AS lot_code, u.nom || ' ' || u.prenom AS received_by_name,
              e.notes, e.created_at
       FROM st_entries e
       JOIN cq_stock_transfers t ON t.id = e.transfer_id
       JOIN cq_controles c ON c.id = t.controle_id
       JOIN coupe_lots l ON l.id = t.lot_id
       LEFT JOIN users u ON u.id = e.received_by
       WHERE e.id = ?`,
    )
    .get(entryId) as EntryRow;
  return mapEntry(db, row);
}
