/**
 * Service Commandes (internes/externes).
 * Une commande = entête + lignes par taille.
 * Le statut 'a_couper' déclenche la création automatique d'un lot de coupe.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { nextCode, requireId } from './common';

export interface OrderLineInput {
  sizeId: number;
  qty: number;
}

export interface OrderInput {
  type: 'interne' | 'externe';
  clientId?: number | null;
  clientNom?: string | null;
  productId: number;
  colorId?: number | null;
  notes?: string;
  lines: OrderLineInput[];
}

export interface OrderLineRow {
  id: number;
  orderId: number;
  sizeId: number;
  sizeNom: string;
  qty: number;
  cutQty: number;
  remaining: number;
}

export interface OrderRow {
  id: number;
  code: string;
  type: 'interne' | 'externe';
  clientId: number | null;
  clientNom: string | null;
  productId: number;
  productNom: string;
  colorId: number | null;
  colorNom: string | null;
  status: string;
  notes: string | null;
  totalQty: number;
  totalCut: number;
  lines: OrderLineRow[];
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

function mapOrder(row: Record<string, unknown>, lines: OrderLineRow[]): OrderRow {
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  const totalCut = lines.reduce((sum, l) => sum + l.cutQty, 0);
  return {
    id: Number(row.id),
    code: String(row.code),
    type: String(row.type) as OrderRow['type'],
    clientId: row.client_id as number | null,
    clientNom: row.client_nom as string | null,
    productId: Number(row.product_id),
    productNom: String(row.product_nom),
    colorId: row.color_id as number | null,
    colorNom: row.color_nom as string | null,
    status: String(row.status),
    notes: row.notes as string | null,
    totalQty,
    totalCut,
    lines,
    createdBy: Number(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function loadLines(db: ReturnType<typeof sessionsDb>, orderId: number): OrderLineRow[] {
  return db.prepare(`
    SELECT ol.id, ol.order_id orderId, ol.size_id sizeId, s.nom sizeNom, ol.qty, ol.cut_qty cutQty
    FROM order_lines ol
    JOIN sizes s ON s.id = ol.size_id
    WHERE ol.order_id = ?
    ORDER BY s.display_order
  `).all(orderId) as OrderLineRow[];
}

export function listOrders(actor: Actor, status?: string, search?: string): OrderRow[] {
  const db = sessionsDb();
  let sql = `SELECT o.*, p.nom product_nom, c.nom color_nom
             FROM orders o
             JOIN products p ON p.id = o.product_id
             LEFT JOIN colors c ON c.id = o.color_id`;
  const params: (string | number)[] = [];
  const where: string[] = [];
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(o.code LIKE ? OR o.client_nom LIKE ? OR p.nom LIKE ?)');
    const like = `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    params.push(like, like, like);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY o.created_at DESC';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => mapOrder(row, loadLines(db, Number(row.id))));
}

export function getOrder(actor: Actor, id: number): OrderRow {
  const db = sessionsDb();
  const row = db.prepare(`
    SELECT o.*, p.nom product_nom, c.nom color_nom
    FROM orders o
    JOIN products p ON p.id = o.product_id
    LEFT JOIN colors c ON c.id = o.color_id
    WHERE o.id = ?
  `).get(requireId(id, 'Commande')) as Record<string, unknown> | undefined;
  if (!row) throw new ServiceError('Commande introuvable.', 404);
  return mapOrder(row, loadLines(db, Number(row.id)));
}

export function createOrder(actor: Actor, input: OrderInput): OrderRow {
  const db = sessionsDb();
  return db.transaction(() => {
    if (!input.lines || input.lines.length === 0) {
      throw new ServiceError('Une commande doit comporter au moins une ligne de taille.', 400);
    }
    const dup = new Set<number>();
    for (const line of input.lines) {
      if (!line.sizeId || line.qty <= 0) {
        throw new ServiceError('Chaque ligne doit avoir une taille et une quantité positive.', 400);
      }
      if (dup.has(line.sizeId)) throw new ServiceError('Une taille ne peut apparaître qu une seule fois.', 400);
      dup.add(line.sizeId);
    }
    const product = db.prepare('SELECT id, nom FROM products WHERE id=?').get(input.productId) as { id: number; nom: string } | undefined;
    if (!product) throw new ServiceError('Produit introuvable.', 404);
    const color = input.colorId ? db.prepare('SELECT id, nom FROM colors WHERE id=?').get(input.colorId) as { id: number; nom: string } | undefined : undefined;
    const clientNom = input.clientId
      ? (db.prepare('SELECT nom FROM clients WHERE id=?').get(input.clientId) as { nom: string } | undefined)?.nom
      : input.clientNom || null;
    const code = nextCode(db, 'orders', 'CMD-');
    const orderId = Number(
      db.prepare(`INSERT INTO orders
        (code, type, client_id, client_nom, product_id, color_id, status, notes, created_by)
        VALUES (?,?,?,?,?,?, 'a_couper', ?, ?)`).run(
        code,
        input.type,
        input.clientId ?? null,
        clientNom ?? null,
        product.id,
        input.colorId ?? null,
        input.notes ?? null,
        actor.id,
      ).lastInsertRowid,
    );
    const insertLine = db.prepare('INSERT INTO order_lines (order_id, size_id, qty) VALUES (?,?,?)');
    for (const line of input.lines) {
      insertLine.run(orderId, line.sizeId, line.qty);
    }
    return getOrder(actor, orderId);
  }).immediate();
}

export function updateOrderStatus(actor: Actor, id: number, status: OrderRow['status']): OrderRow {
  const db = sessionsDb();
  const valid = ['brouillon','a_couper','en_coupe','coupé','transféré','livré','annulé'] as const;
  if (!valid.includes(status as typeof valid[number])) throw new ServiceError('Statut invalide.', 400);
  const res = db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, requireId(id, 'Commande'));
  if (res.changes === 0) throw new ServiceError('Commande introuvable.', 404);
  return getOrder(actor, id);
}

export function updateCutQty(actor: Actor, orderId: number, sizeId: number, cutQty: number): void {
  const db = sessionsDb();
  db.prepare('UPDATE order_lines SET cut_qty=? WHERE order_id=? AND size_id=?').run(
    Math.max(0, Math.trunc(cutQty)),
    requireId(orderId, 'Commande'),
    requireId(sizeId, 'Taille'),
  );
}

export function deleteOrder(actor: Actor, id: number): void {
  const db = sessionsDb();
  const order = getOrder(actor, id);
  if (order.status !== 'brouillon') throw new ServiceError('Seules les commandes au statut brouillon peuvent être supprimées.', 409);
  const linked = db.prepare('SELECT 1 FROM coupe_lots WHERE order_id=? LIMIT 1').get(id) as { '1': number } | undefined;
  if (linked) throw new ServiceError('Cette commande est liée à un lot : suppression impossible.', 409);
  const res = db.prepare('DELETE FROM orders WHERE id=?').run(id);
  if (res.changes === 0) throw new ServiceError('Commande introuvable.', 404);
}
