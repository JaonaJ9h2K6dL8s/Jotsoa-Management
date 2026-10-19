import type Database from 'better-sqlite3';
import { raiseAlert } from '@/server/alerts/alerts';
import type { MgExtractedLineDTO } from '@/types/magasinier';
import { addMgHistory, nextMgCode } from './common';
import { matchLine } from './parser';

/**
 * Création d'une commande liée à un document importé : lignes
 * extraites, correspondance catalogue, détection de doublons par
 * numéro externe et par signature de lignes. Utilisée par l'import
 * PDF et par la saisie manuelle.
 */

export interface ParsedOrderInput {
  orderNo: string | null;
  orderDate: string | null;
  clientName: string | null;
  lines: MgExtractedLineDTO[];
}

function lineSignature(
  product: string | null,
  color: string | null,
  size: string | null,
  qty: number | null,
): string {
  return `${product ?? ''}|${color ?? ''}|${size ?? ''}|${qty ?? ''}`;
}

export function createOrderInternal(
  db: Database.Database,
  documentId: number,
  documentCode: string,
  parsed: ParsedOrderInput,
  actorId: number,
  withOrderNo: boolean,
): number {
  const orderCode = nextMgCode(db, 'mg_orders', 'CMD-');
  const result = db
    .prepare(
      `INSERT INTO mg_orders
         (code, document_id, external_order_no, client_name, order_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      orderCode,
      documentId,
      withOrderNo ? parsed.orderNo : null,
      parsed.clientName,
      parsed.orderDate,
      actorId,
    );
  const orderId = Number(result.lastInsertRowid);
  const insertLine = db.prepare(
    `INSERT INTO mg_order_lines
       (order_id, product_id, color_id, size_id, raw_text, qty_ordered, match_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of parsed.lines) {
    const matched = matchLine(db, line);
    const known = matched.productId !== null && matched.sizeId !== null;
    insertLine.run(
      orderId,
      matched.productId,
      matched.colorId,
      matched.sizeId,
      line.rawText,
      line.qty ?? 0,
      known ? 'reconnu' : 'non_reconnu',
    );
  }
  detectContentDuplicate(db, orderId, orderCode, documentCode, parsed.lines);
  db.prepare('UPDATE mg_documents SET status = ? WHERE id = ?').run(
    'a_verifier',
    documentId,
  );
  addMgHistory(db, {
    action: 'COMMANDE_EXTRAITE',
    entityType: 'mg_order',
    entityId: orderId,
    actorId,
    newValue: { orderCode, lines: parsed.lines.length },
  });
  return orderId;
}

/** Doublon par contenu : mêmes références et quantités qu'une commande existante. */
function detectContentDuplicate(
  db: Database.Database,
  orderId: number,
  orderCode: string,
  documentCode: string,
  lines: MgExtractedLineDTO[],
): void {
  if (lines.length === 0) return;
  const signature = lines
    .map((line) =>
      lineSignature(line.productNom, line.colorNom, line.sizeNom, line.qty),
    )
    .sort()
    .join(';');
  const others = db
    .prepare(
      `SELECT o.id, o.code FROM mg_orders o WHERE o.id != ? AND o.status != 'annule'`,
    )
    .all(orderId) as Array<{ id: number; code: string }>;
  for (const other of others) {
    const otherLines = db
      .prepare(
        `SELECT p.nom AS product, c.nom AS color, s.nom AS size, l.qty_ordered
         FROM mg_order_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN colors c ON c.id = l.color_id
         LEFT JOIN sizes s ON s.id = l.size_id
         WHERE l.order_id = ?`,
      )
      .all(other.id) as Array<{
      product: string | null;
      color: string | null;
      size: string | null;
      qty_ordered: number;
    }>;
    const otherSignature = otherLines
      .map((line) =>
        lineSignature(line.product, line.color, line.size, line.qty_ordered),
      )
      .sort()
      .join(';');
    if (otherSignature === signature && signature.length > 0) {
      db.prepare(
        `UPDATE mg_orders SET status = 'anomalie',
           notes = COALESCE(notes || ' | ', '') || ? WHERE id = ?`,
      ).run(
        `Doublon potentiel : lignes identiques à la commande ${other.code}.`,
        orderId,
      );
      raiseAlert(db, {
        category: 'DOUBLON_COMMANDE_MG',
        severity: 'warning',
        objectType: 'mg_order',
        objectId: orderId,
        message: `Doublon potentiel : les lignes de ${orderCode} (document ${documentCode}) sont identiques à ${other.code}.`,
        ownerRole: 'chef_magasinier',
      });
      return;
    }
  }
}
