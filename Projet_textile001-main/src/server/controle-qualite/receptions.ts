import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CqReceptionDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCq,
  requireId,
  toNumber,
} from './common';
import { requireReceivableTransfer } from './balances';

/**
 * Réception des transferts confirmés par la Couture. Une seule
 * réception par transfert (UNIQUE) ; tout écart est alerté et la
 * réception partielle est explicite. Quantités couture jamais modifiées.
 */

interface ReceptionRow {
  id: number;
  code: string;
  transfer_id: number;
  lot_id: number;
  status: 'complete' | 'partielle';
  notes: string | null;
  received_at: string;
  transfer_code: string;
  lot_code: string;
  product_nom: string;
  color_nom: string;
  received_by_name: string | null;
}

const RECEPTION_SELECT = `
  SELECT r.*, t.code AS transfer_code, l.code AS lot_code,
         p.nom AS product_nom, c.nom AS color_nom,
         u.nom || ' ' || u.prenom AS received_by_name
  FROM cq_receptions r
  JOIN couture_transfers t ON t.id = r.transfer_id
  JOIN coupe_lots l ON l.id = r.lot_id
  JOIN products p ON p.id = l.product_id
  JOIN colors c ON c.id = l.color_id
  JOIN users u ON u.id = r.received_by`;

function mapReception(db: ReturnType<typeof sessionsDb>, row: ReceptionRow): CqReceptionDTO {
  const lines = db
    .prepare(
      `SELECT rl.size_id, s.nom AS size_label,
              rl.transferred_qty, rl.received_qty
       FROM cq_reception_lines rl
       JOIN sizes s ON s.id = rl.size_id
       WHERE rl.reception_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{
    size_id: number;
    size_label: string;
    transferred_qty: number;
    received_qty: number;
  }>;
  return {
    id: row.id,
    code: row.code,
    transferId: row.transfer_id,
    transferCode: row.transfer_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    status: row.status,
    notes: row.notes,
    receivedByName: row.received_by_name,
    receivedAt: row.received_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      transferredQty: line.transferred_qty,
      receivedQty: line.received_qty,
    })),
  };
}

export function listReceptions(actor: Actor): CqReceptionDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(`${RECEPTION_SELECT} ORDER BY r.id DESC`)
    .all() as ReceptionRow[];
  return rows.map((row) => mapReception(db, row));
}

export function receiveTransfer(
  actor: Actor,
  input: Record<string, unknown>,
): CqReceptionDTO {
  requireCq(actor);
  const db = sessionsDb();
  const transferId = requireId(input.transferId, 'Transfert');
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Les quantités reçues par taille sont obligatoires.', 400);
  }
  const received = new Map<number, number>();
  for (const entry of rawLines) {
    const record = entry as Record<string, unknown>;
    const sizeId = requireId(record.sizeId, 'Taille');
    if (received.has(sizeId)) {
      throw new ServiceError('Chaque taille ne peut apparaître qu’une fois.', 400);
    }
    received.set(sizeId, toNumber(record.receivedQty, 'La quantité reçue'));
  }
  for (const [, qty] of received.entries()) {
    if (qty < 0) {
      throw new ServiceError('Les quantités reçues ne peuvent pas être négatives.', 400);
    }
  }
  // Détection de doublon hors transaction : l'alerte de tentative de
  // double réception doit persister même si l'opération est refusée.
  // La contrainte UNIQUE sur transfer_id protège des courses critiques.
  const existing = db
    .prepare('SELECT id FROM cq_receptions WHERE transfer_id = ?')
    .get(transferId) as { id: number } | undefined;
  if (existing) {
    raiseAlert(db, {
      category: 'DOUBLON_RECEPTION_CQ',
      severity: 'warning',
      objectType: 'transfert_couture',
      objectId: transferId,
      message: `Tentative de réception en double du transfert ${transferId}.`,
      ownerRole: 'controleur_qualite',
    });
    throw new ServiceError('Ce transfert a déjà été réceptionné.', 409);
  }
  const insert = db.transaction((): number => {
    const transfer = requireReceivableTransfer(db, transferId);
    const transferred = db
      .prepare(
        `SELECT ctl.size_id, ctl.qty FROM couture_transfer_lines ctl
         WHERE ctl.transfer_id = ?`,
      )
      .all(transferId) as Array<{ size_id: number; qty: number }>;
    // Toute taille transférée doit figurer explicitement dans la
    // réception (quantité reçue, même nulle).
    for (const line of transferred) {
      if (!received.has(line.size_id)) {
        received.set(line.size_id, 0);
      }
    }
    for (const [sizeId] of received.entries()) {
      const known = transferred.some((line) => line.size_id === sizeId);
      if (!known) {
        throw new ServiceError(
          'Une taille saisie ne correspond pas au transfert d’origine.',
          400,
        );
      }
    }
    for (const line of transferred) {
      const qty = received.get(line.size_id) ?? 0;
      if (qty > line.qty) {
        raiseAlert(db, {
          category: 'ECART_RECEPTION_CQ',
          severity: 'warning',
          objectType: 'transfert_couture',
          objectId: transferId,
          message: `Quantité reçue (${qty}) supérieure à la quantité transférée (${line.qty}) en taille ${line.size_id}.`,
          ownerRole: 'controleur_qualite',
        });
        throw new ServiceError(
          `Réception refusée : quantité reçue supérieure à la quantité transférée en taille ${line.size_id}.`,
          400,
        );
      }
    }
    // Les tailles non saisies sont réceptionnées à 0 : réception
    // partielle explicite, écart alerté et tracé.
    const hasGap = transferred.some(
      (line) => (received.get(line.size_id) ?? 0) < line.qty,
    );
    const code = nextCode(db, 'cq_receptions', 'RCQ-');
    const result = db
      .prepare(
        `INSERT INTO cq_receptions (code, transfer_id, lot_id, status, notes, received_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, transferId, transfer.lot_id, hasGap ? 'partielle' : 'complete', notes, actor.id);
    const receptionId = Number(result.lastInsertRowid);
    for (const line of transferred) {
      db.prepare(
        `INSERT INTO cq_reception_lines
           (reception_id, size_id, transferred_qty, received_qty)
         VALUES (?, ?, ?, ?)`,
      ).run(receptionId, line.size_id, line.qty, received.get(line.size_id) ?? 0);
    }
    if (hasGap) {
      raiseAlert(db, {
        category: 'ECART_RECEPTION_CQ',
        severity: 'warning',
        objectType: 'cq_reception',
        objectId: receptionId,
        message: `Réception partielle du transfert ${code} : les quantités reçues sont inférieures aux quantités transférées.`,
        ownerRole: 'controleur_qualite',
      });
    }
    addHistory(db, {
      action: 'RECEPTION_CQ_CREATED',
      entityType: 'cq_reception',
      entityId: receptionId,
      actorId: actor.id,
      newValue: { code, transferId, lines: [...received.entries()] },
      reason: hasGap ? 'Réception partielle' : null,
    });
    return receptionId;
  });
  const receptionId = insert();
  const row = db
    .prepare(`${RECEPTION_SELECT} WHERE r.id = ?`)
    .get(receptionId) as ReceptionRow;
  return mapReception(db, row);
}
