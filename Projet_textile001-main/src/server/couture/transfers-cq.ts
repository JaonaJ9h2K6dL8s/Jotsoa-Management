import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CoutureTransferDTO } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import { createSensitiveRequest } from '@/server/approvals/approvals';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCouture,
  requireId,
  setLotStatus,
  toNumber,
} from './common';

/**
 * Transferts des pièces cousues vers le Contrôle qualité.
 * Seules les quantités réellement cousues et disponibles (cousues −
 * déjà transférées) peuvent partir. Les transferts partiels sont
 * autorisés ; tout est enregistré dans une transaction SQLite.
 * L'annulation d'un transfert confirmé est une opération sensible.
 */

interface TransferRow {
  id: number;
  code: string;
  assignment_id: number;
  lot_id: number;
  status: 'confirme' | 'annule';
  prepared_by: number;
  confirmed_at: string;
  notes: string | null;
  assignment_code: string;
  lot_code: string;
  product_nom: string;
  color_nom: string;
}

const TRANSFER_SELECT = `
  SELECT t.*, a.code AS assignment_code, l.code AS lot_code,
         p.nom AS product_nom, c.nom AS color_nom
  FROM couture_transfers t
  JOIN couture_assignments a ON a.id = t.assignment_id
  JOIN coupe_lots l ON l.id = t.lot_id
  JOIN products p ON p.id = l.product_id
  JOIN colors c ON c.id = l.color_id`;

function mapTransfer(
  db: ReturnType<typeof sessionsDb>,
  row: TransferRow,
): CoutureTransferDTO {
  const lines = db
    .prepare(
      `SELECT ctl.size_id, s.nom AS size_label, ctl.qty
       FROM couture_transfer_lines ctl
       JOIN sizes s ON s.id = ctl.size_id
       WHERE ctl.transfer_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{ size_id: number; size_label: string; qty: number }>;
  return {
    id: row.id,
    code: row.code,
    assignmentId: row.assignment_id,
    assignmentCode: row.assignment_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    status: row.status,
    preparedByName: null,
    confirmedAt: row.confirmed_at,
    notes: row.notes,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      qty: line.qty,
    })),
  };
}

export function listTransfers(actor: Actor): CoutureTransferDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(`${TRANSFER_SELECT} ORDER BY t.id DESC`)
    .all() as TransferRow[];
  return rows.map((row) => mapTransfer(db, row));
}

export function createTransfer(
  actor: Actor,
  input: Record<string, unknown>,
): CoutureTransferDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const assignmentId = requireId(input.assignmentId, 'Affectation');
  const notes = normalizeText(input.notes, 500);
  const rawSizes = Array.isArray(input.sizes) ? input.sizes : [];
  if (rawSizes.length === 0) {
    throw new ServiceError('Au moins une taille avec une quantité est requise.', 400);
  }
  const qtyBySize = new Map<number, number>();
  for (const entry of rawSizes) {
    const record = entry as Record<string, unknown>;
    const sizeId = requireId(record.sizeId, 'Taille');
    const qty = toNumber(record.qty, 'La quantité transférée');
    if (qty <= 0) {
      throw new ServiceError('Chaque quantité transférée doit être supérieure à 0.', 400);
    }
    if (qtyBySize.has(sizeId)) {
      throw new ServiceError('Chaque taille ne peut apparaître qu’une fois.', 400);
    }
    qtyBySize.set(sizeId, qty);
  }
  // Pré-validation hors transaction : l'alerte doit survivre au refus.
  const assignment = db
    .prepare('SELECT id, lot_id, status FROM couture_assignments WHERE id = ?')
    .get(assignmentId) as
    | { id: number; lot_id: number; status: string }
    | undefined;
  if (!assignment) throw new ServiceError('Affectation introuvable.', 404);
  if (!['en_cours', 'terminee'].includes(assignment.status)) {
    throw new ServiceError(
      'Le transfert n’est possible que pour une affectation en cours ou terminée.',
      409,
    );
  }
  for (const [sizeId, qty] of qtyBySize.entries()) {
    const sewnRow = db
      .prepare(
        `SELECT COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
         WHERE assignment_id = ? AND size_id = ? AND status = 'normal'`,
      )
      .get(assignmentId, sizeId) as { sewn: number };
    const transferredRow = db
      .prepare(
        `SELECT COALESCE(SUM(ctl.qty), 0) AS qty FROM couture_transfer_lines ctl
         JOIN couture_transfers t ON t.id = ctl.transfer_id
         WHERE t.assignment_id = ? AND t.status = 'confirme' AND ctl.size_id = ?`,
      )
      .get(assignmentId, sizeId) as { qty: number };
    const available = Math.max(0, sewnRow.sewn - transferredRow.qty);
    if (qty > available) {
      raiseAlert(db, {
        category: 'TRANSFERT_EXCEDENT',
        severity: 'warning',
        objectType: 'affectation',
        objectId: assignmentId,
        message: `Tentative de transfert de ${qty} pièce(s) en taille ${sizeId} alors que le disponible cousu non transféré est de ${available}.`,
        ownerRole: 'chef_couture',
      });
      throw new ServiceError(
        `Transfert refusé : disponible en taille ${sizeId} = ${available} pièce(s) cousue(s) non transférée(s).`,
        409,
      );
    }
  }
  const insert = db.transaction((): number => {
    const current = db
      .prepare('SELECT id, lot_id, status FROM couture_assignments WHERE id = ?')
      .get(assignmentId) as
      | { id: number; lot_id: number; status: string }
      | undefined;
    if (!current || !['en_cours', 'terminee'].includes(current.status)) {
      throw new ServiceError(
        'Le transfert n’est possible que pour une affectation en cours ou terminée.',
        409,
      );
    }
    for (const [sizeId, qty] of qtyBySize.entries()) {
      const sewnRow = db
        .prepare(
          `SELECT COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
           WHERE assignment_id = ? AND size_id = ? AND status = 'normal'`,
        )
        .get(assignmentId, sizeId) as { sewn: number };
      const transferredRow = db
        .prepare(
          `SELECT COALESCE(SUM(ctl.qty), 0) AS qty FROM couture_transfer_lines ctl
           JOIN couture_transfers t ON t.id = ctl.transfer_id
           WHERE t.assignment_id = ? AND t.status = 'confirme' AND ctl.size_id = ?`,
        )
        .get(assignmentId, sizeId) as { qty: number };
      if (qty > Math.max(0, sewnRow.sewn - transferredRow.qty)) {
        throw new ServiceError(
          `Transfert refusé : disponible en taille ${sizeId} insuffisant.`,
          409,
        );
      }
    }
    const code = nextCode(db, 'couture_transfers', 'TFQ-');
    const result = db
      .prepare(
        `INSERT INTO couture_transfers (code, assignment_id, lot_id, prepared_by, notes)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, assignmentId, assignment.lot_id, actor.id, notes);
    const transferId = Number(result.lastInsertRowid);
    for (const [sizeId, qty] of qtyBySize.entries()) {
      db.prepare(
        'INSERT INTO couture_transfer_lines (transfer_id, size_id, qty) VALUES (?, ?, ?)',
      ).run(transferId, sizeId, qty);
    }
    const totals = db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(p.qty), 0) FROM couture_productions p
            WHERE p.lot_id = ? AND p.status = 'normal') AS sewn,
           (SELECT COALESCE(SUM(ctl.qty), 0) FROM couture_transfer_lines ctl
            JOIN couture_transfers t ON t.id = ctl.transfer_id
            WHERE t.lot_id = ? AND t.status = 'confirme') AS transferred`,
      )
      .get(assignment.lot_id, assignment.lot_id) as { sewn: number; transferred: number };
    if (totals.transferred >= totals.sewn) {
      setLotStatus(db, assignment.lot_id, 'transfere_cq');
    } else {
      setLotStatus(db, assignment.lot_id, 'attente_transfert');
    }
    addHistory(db, {
      action: 'TRANSFER_CQ_CONFIRMED',
      entityType: 'transfert_cq',
      entityId: transferId,
      actorId: actor.id,
      newValue: { code, assignmentId, sizes: [...qtyBySize.entries()] },
    });
    return transferId;
  });
  const transferId = insert();
  const row = db
    .prepare(`${TRANSFER_SELECT} WHERE t.id = ?`)
    .get(transferId) as TransferRow;
  return mapTransfer(db, row);
}

/** Soumet l'annulation d'un transfert confirmé (opération sensible). */
export function requestTransferCancel(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): { requestId: number } {
  requireCouture(actor);
  const db = sessionsDb();
  const transferId = requireId(rawId, 'Transfert');
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif est obligatoire pour annuler un transfert.', 400);
  }
  const transfer = db
    .prepare('SELECT id, status FROM couture_transfers WHERE id = ?')
    .get(transferId) as { id: number; status: string } | undefined;
  if (!transfer) throw new ServiceError('Transfert introuvable.', 404);
  if (transfer.status !== 'confirme') {
    throw new ServiceError('Seul un transfert confirmé peut être annulé.', 409);
  }
  const requestId = createSensitiveRequest(db, {
    action: 'annulation_transfert_couture',
    entityType: 'transfert_cq',
    entityId: transferId,
    payload: { transferId },
    reason,
    requestedBy: actor.id,
  });
  addHistory(db, {
    action: 'TRANSFER_CQ_CANCEL_REQUESTED',
    entityType: 'transfert_cq',
    entityId: transferId,
    actorId: actor.id,
    reason,
  });
  return { requestId };
}
