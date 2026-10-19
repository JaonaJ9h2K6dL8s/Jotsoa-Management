import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StockTransferDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCq,
  requireId,
  toNumber,
} from './common';

/**
 * Transferts des quantités conformes vers le Stock (étape 7).
 * Seules les quantités réellement conformes, disponibles (non déjà
 * transférées) d'un contrôle validé peuvent partir. Transaction
 * SQLite : toute erreur annule l'opération complète.
 */

interface ControlBasic {
  id: number;
  code: string;
  lot_id: number;
  status: string;
}

function requireControl(db: ReturnType<typeof sessionsDb>, controleId: number): ControlBasic {
  const row = db
    .prepare('SELECT id, code, lot_id, status FROM cq_controles WHERE id = ?')
    .get(controleId) as ControlBasic | undefined;
  if (!row) throw new ServiceError('Contrôle introuvable.', 404);
  return row;
}

const TRANSFER_SELECT = `
  SELECT st.*, c.code AS controle_code, l.code AS lot_code,
         p.nom AS product_nom, c2.nom AS color_nom,
         u.nom || ' ' || u.prenom AS prepared_by_name
  FROM cq_stock_transfers st
  JOIN cq_controles c ON c.id = st.controle_id
  JOIN coupe_lots l ON l.id = st.lot_id
  JOIN products p ON p.id = l.product_id
  JOIN colors c2 ON c2.id = l.color_id
  JOIN users u ON u.id = st.prepared_by`;

function mapTransfer(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    controle_id: number;
    lot_id: number;
    status: 'confirme' | 'annule';
    prepared_by_name: string | null;
    confirmed_at: string;
    notes: string | null;
    controle_code: string;
    lot_code: string;
    product_nom: string;
    color_nom: string;
  },
): StockTransferDTO {
  const lines = db
    .prepare(
      `SELECT stl.size_id, s.nom AS size_label, stl.qty
       FROM cq_stock_transfer_lines stl
       JOIN sizes s ON s.id = stl.size_id
       WHERE stl.transfer_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{ size_id: number; size_label: string; qty: number }>;
  return {
    id: row.id,
    code: row.code,
    controleId: row.controle_id,
    controleCode: row.controle_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    status: row.status,
    preparedByName: row.prepared_by_name,
    confirmedAt: row.confirmed_at,
    notes: row.notes,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      qty: line.qty,
    })),
  };
}

export function listStockTransfers(actor: Actor): StockTransferDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  return (db.prepare(`${TRANSFER_SELECT} ORDER BY st.id DESC`).all() as never[]).map(
    (row) => mapTransfer(db, row),
  );
}

/** Disponible au stock pour une taille : conforme (initial + final) − déjà transféré. */
function availableForSize(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
  sizeId: number,
): number {
  const row = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(cl.conforme_qty), 0) FROM cq_controle_lines cl
            JOIN cq_controles c ON c.id = cl.controle_id
            WHERE c.lot_id = ? AND cl.size_id = ?) AS conforme_initial,
         (SELECT COALESCE(SUM(fl.conforme_qty), 0) FROM cq_final_lines fl
            JOIN cq_final_controls fc ON fc.id = fl.final_id
            JOIN cq_rework_requests rr ON rr.id = fc.request_id
            WHERE rr.lot_id = ? AND fl.size_id = ?) AS conforme_final,
         (SELECT COALESCE(SUM(stl.qty), 0) FROM cq_stock_transfer_lines stl
            JOIN cq_stock_transfers st ON st.id = stl.transfer_id
            WHERE st.lot_id = ? AND st.status = 'confirme' AND stl.size_id = ?) AS transferred`,
    )
    .get(lotId, sizeId, lotId, sizeId, lotId, sizeId) as {
    conforme_initial: number;
    conforme_final: number;
    transferred: number;
  };
  return Math.max(0, row.conforme_initial + row.conforme_final - row.transferred);
}

/**
 * Prépare le transfert vers le stock d'un contrôle validé. Les
 * quantités à retoucher, rebutées ou en attente ne partent jamais.
 */
export function createStockTransfer(
  actor: Actor,
  input: Record<string, unknown>,
): StockTransferDTO {
  requireCq(actor);
  const db = sessionsDb();
  const rawControlId = input.controleId;
  const rawLotId = input.lotId;
  if (rawControlId === undefined && rawLotId === undefined) {
    throw new ServiceError('Contrôle ou lot requis pour le transfert.', 400);
  }
  let controleId: number;
  if (rawControlId !== undefined) {
    controleId = requireId(rawControlId, 'Contrôle');
  } else {
    // Résolution du dernier contrôle validé du lot côté serveur.
    const lotId = requireId(rawLotId, 'Lot');
    const row = db
      .prepare(
        `SELECT id FROM cq_controles
         WHERE lot_id = ? AND status IN ('valide','cloture')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(lotId) as { id: number } | undefined;
    if (!row) {
      throw new ServiceError(
        'Aucun contrôle validé pour ce lot : transfert impossible.',
        409,
      );
    }
    controleId = row.id;
  }
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité fournie pour le transfert.', 400);
  }
  const insert = db.transaction((): number => {
    const control = requireControl(db, controleId);
    if (!['valide', 'cloture'].includes(control.status)) {
      throw new ServiceError(
        'Seul un contrôle validé peut préparer un transfert vers le stock.',
        409,
      );
    }
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS total FROM cq_defauts WHERE controle_id = ? AND decision = 'attente'`,
      )
      .get(controleId) as { total: number };
    if (pending.total > 0) {
      throw new ServiceError(
        `${pending.total} défaut(s) en attente de décision sur ce contrôle : decisions incomplètes.`,
        409,
      );
    }
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const qty = toNumber(record.qty, 'La quantité transférée');
      if (qty <= 0) {
        throw new ServiceError('La quantité transférée doit être supérieure à 0.', 400);
      }
      const conforme = db
        .prepare(
          `SELECT COALESCE(SUM(conforme_qty), 0) AS qty FROM cq_controle_lines
           WHERE controle_id = ? AND size_id = ?`,
        )
        .get(controleId, sizeId) as { qty: number };
      const inspected = db
        .prepare(
          `SELECT COALESCE(SUM(inspected_qty), 0) AS qty FROM cq_controle_lines
           WHERE controle_id = ? AND size_id = ?`,
        )
        .get(controleId, sizeId) as { qty: number };
      if (conforme.qty <= 0) {
        throw new ServiceError(
          `Aucune quantité conforme validée en taille ${sizeId} : transfert impossible.`,
          409,
        );
      }
      const available = availableForSize(db, control.lot_id, sizeId);
      if (qty > available) {
        raiseAlert(db, {
          category: 'TRANSFERT_STOCK_EXCEDENT_CQ',
          severity: 'warning',
          objectType: 'cq_controle',
          objectId: controleId,
          message: `Tentative de transfert de ${qty} pièce(s) en taille ${sizeId} alors que ${available} sont disponibles au stock.`,
          ownerRole: 'controleur_qualite',
        });
        throw new ServiceError(
          `Quantité supérieure au disponible au stock en taille ${sizeId} (disponible : ${available}).`,
          409,
        );
      }
      if (inspected.qty === 0) {
        throw new ServiceError(
          `Aucune pièce inspectée en taille ${sizeId} : impossible de déclarer des conformes.`,
          409,
        );
      }
    }
    const code = nextCode(db, 'cq_stock_transfers', 'TS-');
    const result = db
      .prepare(
        `INSERT INTO cq_stock_transfers (code, controle_id, lot_id, status, prepared_by, notes)
         VALUES (?, ?, ?, 'confirme', ?, ?)`,
      )
      .run(code, controleId, control.lot_id, actor.id, notes);
    const transferId = Number(result.lastInsertRowid);
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      db.prepare(
        'INSERT INTO cq_stock_transfer_lines (transfer_id, size_id, qty) VALUES (?, ?, ?)',
      ).run(transferId, requireId(record.sizeId, 'Taille'), toNumber(record.qty, 'La quantité'));
    }
    addHistory(db, {
      action: 'STOCK_TRANSFER_CREATED',
      entityType: 'cq_stock_transfer',
      entityId: transferId,
      actorId: actor.id,
      newValue: { code, controleId, lines: rawLines },
    });
    return transferId;
  });
  const transferId = insert();
  const row = db
    .prepare(`${TRANSFER_SELECT} WHERE st.id = ?`)
    .get(transferId) as never;
  return mapTransfer(db, row);
}
