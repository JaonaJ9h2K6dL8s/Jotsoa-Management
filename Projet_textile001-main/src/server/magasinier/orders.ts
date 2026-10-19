import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { MgOrderDTO, MgOrderLineDTO, MgOrderStatus } from '@/types/magasinier';
import {
  addMgHistory,
  normalizeText,
  requireId,
  requireMagasinier,
  requireText,
  toNumber,
} from './common';

/**
 * Commandes externes : consultation, correspondance manuelle au
 * catalogue, validation. Une commande ne devient préparatrice qu'une
 * fois validée : toutes ses lignes reconnues, aucun doublon actif.
 */

interface OrderRow {
  id: number;
  code: string;
  document_code: string;
  external_order_no: string | null;
  client_name: string | null;
  order_date: string | null;
  status: MgOrderStatus;
  created_at: string;
  notes: string | null;
}

interface LineRow {
  id: number;
  product_id: number | null;
  product_nom: string | null;
  color_id: number | null;
  color_nom: string | null;
  size_id: number | null;
  size_nom: string | null;
  raw_text: string | null;
  qty_ordered: number;
  qty_prepared: number;
  match_status: MgOrderLineDTO['matchStatus'];
  notes: string | null;
}

const ORDER_SELECT = `
  SELECT o.*, d.code AS document_code
  FROM mg_orders o
  JOIN mg_documents d ON d.id = o.document_id`;

const LINE_SELECT = `
  SELECT l.id, l.product_id, p.nom AS product_nom, l.color_id,
         c.nom AS color_nom, l.size_id, s.nom AS size_nom, l.raw_text,
         l.qty_ordered, l.qty_prepared, l.match_status, l.notes
  FROM mg_order_lines l
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN colors c ON c.id = l.color_id
  LEFT JOIN sizes s ON s.id = l.size_id`;

function linesOf(
  db: import('better-sqlite3').Database,
  orderId: number,
): MgOrderLineDTO[] {
  const rows = db
    .prepare(`${LINE_SELECT} WHERE l.order_id = ? ORDER BY l.id`)
    .all(orderId) as LineRow[];
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productNom: row.product_nom,
    colorId: row.color_id,
    colorNom: row.color_nom,
    sizeId: row.size_id,
    sizeNom: row.size_nom,
    rawText: row.raw_text,
    qtyOrdered: row.qty_ordered,
    qtyPrepared: row.qty_prepared,
    matchStatus: row.match_status,
    notes: row.notes,
    reservableQty: 0,
    preparedQty: row.qty_prepared,
  }));
}

function mapOrder(db: import('better-sqlite3').Database, row: OrderRow): MgOrderDTO {
  return {
    id: row.id,
    code: row.code,
    documentCode: row.document_code,
    externalOrderNo: row.external_order_no,
    clientName: row.client_name,
    orderDate: row.order_date,
    status: row.status,
    createdAt: row.created_at,
    lines: linesOf(db, row.id),
    duplicateWarning: row.notes?.includes('Doublon potentiel')
      ? row.notes
      : null,
  };
}

export function listOrders(actor: Actor): MgOrderDTO[] {
  requireMagasinier(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT 300`).all() as OrderRow[]
  ).map((row) => mapOrder(db, row));
}

export function getOrder(actor: Actor, orderId: number): MgOrderDTO {
  requireMagasinier(actor);
  const db = sessionsDb();
  const row = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId) as
    | OrderRow
    | undefined;
  if (!row) throw new ServiceError('Commande introuvable.', 404);
  return mapOrder(db, row);
}

function orderWithLock(
  db: import('better-sqlite3').Database,
  orderId: number,
): { id: number; code: string; status: MgOrderStatus; document_id: number } {
  const row = db
    .prepare('SELECT id, code, status, document_id FROM mg_orders WHERE id = ?')
    .get(orderId) as
    | { id: number; code: string; status: MgOrderStatus; document_id: number }
    | undefined;
  if (!row) throw new ServiceError('Commande introuvable.', 404);
  return row;
}

/** Correspondance manuelle d'une ligne : produit + couleur + taille. */
export function matchOrderLine(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const lineId = requireId(input.lineId, 'Ligne');
  const run = db.transaction((): void => {
    const line = db
      .prepare('SELECT id, order_id, match_status FROM mg_order_lines WHERE id = ?')
      .get(lineId) as { id: number; order_id: number; match_status: string } | undefined;
    if (!line) throw new ServiceError('Ligne introuvable.', 404);
    const order = orderWithLock(db, line.order_id);
    if (order.status !== 'a_verifier' && order.status !== 'anomalie') {
      throw new ServiceError(
        `La correspondance n'est modifiable que sur une commande à vérifier (statut : ${order.status}).`,
        409,
      );
    }
    const productId = requireId(input.productId, 'Produit');
    const colorId = input.colorId ? requireId(input.colorId, 'Couleur') : null;
    const sizeId = requireId(input.sizeId, 'Taille');
    const product = db
      .prepare('SELECT id FROM products WHERE id = ? AND is_active = 1')
      .get(productId);
    if (!product) throw new ServiceError('Produit inconnu ou inactif.', 400);
    if (colorId !== null) {
      const color = db
        .prepare('SELECT id FROM colors WHERE id = ? AND is_active = 1')
        .get(colorId);
      if (!color) throw new ServiceError('Couleur inconnue ou inactive.', 400);
    }
    const size = db
      .prepare('SELECT id FROM sizes WHERE id = ? AND is_active = 1')
      .get(sizeId);
    if (!size) throw new ServiceError('Taille inconnue ou inactive.', 400);
    const oldValue = { productId: db.prepare('SELECT product_id FROM mg_order_lines WHERE id = ?').get(lineId), sizeId: db.prepare('SELECT size_id FROM mg_order_lines WHERE id = ?').get(lineId) };
    db.prepare(
      `UPDATE mg_order_lines
       SET product_id = ?, color_id = ?, size_id = ?, match_status = 'reconnu'
       WHERE id = ?`,
    ).run(productId, colorId, sizeId, lineId);
    addMgHistory(db, {
      action: 'LIGNE_ASSOCIEE',
      entityType: 'mg_order_line',
      entityId: lineId,
      actorId: actor.id ?? 0,
      oldValue,
      newValue: { productId, colorId, sizeId },
    });
  });
  run();
}

/** Ajout manuel d'une ligne (PDF scanné / extraction partielle). */
export function addOrderLine(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const qty = toNumber(input.qty, 'La quantité');
  if (qty <= 0) throw new ServiceError('La quantité doit être strictement positive.', 400);
  const run = db.transaction((): void => {
    const order = orderWithLock(db, orderId);
    if (order.status !== 'a_verifier' && order.status !== 'anomalie') {
      throw new ServiceError(
        'Les lignes ne sont ajoutables que sur une commande à vérifier.',
        409,
      );
    }
    db.prepare(
      `INSERT INTO mg_order_lines
         (order_id, raw_text, qty_ordered, match_status, notes)
       VALUES (?, ?, ?, 'non_reconnu', ?)`,
    ).run(orderId, normalizeText(input.rawText, 200), qty, normalizeText(input.notes, 200));
    addMgHistory(db, {
      action: 'LIGNE_AJOUTEE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId: actor.id ?? 0,
      newValue: { qty },
    });
  });
  run();
}

export function removeOrderLine(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const lineId = requireId(input.lineId, 'Ligne');
  const run = db.transaction((): void => {
    const line = db
      .prepare('SELECT id, order_id, qty_prepared FROM mg_order_lines WHERE id = ?')
      .get(lineId) as { id: number; order_id: number; qty_prepared: number } | undefined;
    if (!line) throw new ServiceError('Ligne introuvable.', 404);
    if (line.qty_prepared > 0) {
      throw new ServiceError(
        'Une ligne avec des réservations actives ne peut pas être supprimée.',
        409,
      );
    }
    const order = orderWithLock(db, line.order_id);
    if (order.status !== 'a_verifier' && order.status !== 'anomalie') {
      throw new ServiceError('Ligne supprimable uniquement avant validation.', 409);
    }
    db.prepare('DELETE FROM mg_order_lines WHERE id = ?').run(lineId);
    addMgHistory(db, {
      action: 'LIGNE_SUPPRIMEE',
      entityType: 'mg_order',
      entityId: line.order_id,
      actorId: actor.id ?? 0,
      oldValue: { lineId },
    });
  });
  run();
}

/** Validation : toutes les lignes reconnues, aucun doublon actif. */
export function validateOrder(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const run = db.transaction((): void => {
    const order = orderWithLock(db, orderId);
    if (order.status !== 'a_verifier' && order.status !== 'anomalie') {
      throw new ServiceError(
        `Seule une commande à vérifier peut être validée (statut : ${order.status}).`,
        409,
      );
    }
    const unknown = db
      .prepare(
        `SELECT COUNT(*) AS n FROM mg_order_lines
         WHERE order_id = ? AND match_status != 'reconnu'`,
      )
      .get(orderId) as { n: number };
    if (unknown.n > 0) {
      throw new ServiceError(
        `${unknown.n} ligne(s) ne sont pas associées au catalogue : validation refusée.`,
        409,
      );
    }
    const total = db
      .prepare('SELECT COUNT(*) AS n FROM mg_order_lines WHERE order_id = ?')
      .get(orderId) as { n: number };
    if (total.n === 0) {
      throw new ServiceError('La commande ne contient aucune ligne.', 409);
    }
    const notes = db
      .prepare('SELECT notes FROM mg_orders WHERE id = ?')
      .get(orderId) as { notes: string | null };
    if (notes.notes?.includes('Doublon potentiel')) {
      throw new ServiceError(
        'Un doublon potentiel est signalé : faites-le examiner avant validation.',
        409,
      );
    }
    db.prepare(
      `UPDATE mg_orders SET status = 'valide', validated_by = ?,
         validated_at = datetime('now'), notes = NULL WHERE id = ?`,
    ).run(actorId, orderId);
    const doc = db
      .prepare('SELECT id FROM mg_documents WHERE id = ?')
      .get(order.document_id) as { id: number };
    db.prepare(`UPDATE mg_documents SET status = 'valide' WHERE id = ?`).run(doc.id);
    addMgHistory(db, {
      action: 'COMMANDE_VALIDEE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId,
      oldValue: { status: order.status },
      newValue: { status: 'valide' },
    });
  });
  run();
}

/** Annulation contrôlée : réservations actives libérées, historisé. */
export function cancelOrder(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const reason = requireText(input.reason, 'Le motif', 300);
  const run = db.transaction((): void => {
    const order = orderWithLock(db, orderId);
    if (order.status === 'soumis' || order.status === 'annule') {
      throw new ServiceError(
        `Une commande ${order.status === 'soumis' ? 'soumise à sécurité' : 'annulée'} ne peut pas être annulée ici.`,
        409,
      );
    }
    const active = db
      .prepare(
        `SELECT id, code FROM mg_reservations
         WHERE order_id = ? AND status = 'active'`,
      )
      .all(orderId) as Array<{ id: number; code: string }>;
    for (const reservation of active) {
      db.prepare(
        `UPDATE mg_reservations SET status = 'liberee', released_by = ?,
           released_at = datetime('now'), release_reason = ? WHERE id = ?`,
      ).run(actor.id ?? 0, `Annulation de la commande ${order.code}`, reservation.id);
    }
    db.prepare(
      `UPDATE mg_order_lines SET qty_prepared = 0 WHERE order_id = ?`,
    ).run(orderId);
    db.prepare(`UPDATE mg_orders SET status = 'annule' WHERE id = ?`).run(orderId);
    addMgHistory(db, {
      action: 'COMMANDE_ANNULEE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId: actor.id ?? 0,
      oldValue: { status: order.status },
      newValue: { status: 'annule', reservationsLiberees: active.length },
      reason,
    });
  });
  run();
}
