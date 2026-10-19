import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StInventoryDTO, StInventoryLineDTO } from '@/types/stock';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireId,
  requireStock,
  toNumber,
} from './common';

/**
 * Inventaires physiques : le théorique est figé à la création de la
 * session (instant de référence explicite). Le comptage n'a aucun
 * effet direct sur le stock : les écarts passent obligatoirement par
 * des ajustements soumis à seconde validation.
 */

interface InventoryRow {
  id: number;
  code: string;
  location_code: string | null;
  status: StInventoryDTO['status'];
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  counted_at: string | null;
}

interface InventoryLineRow {
  id: number;
  carton_id: number;
  carton_code: string;
  lot_code: string;
  size_id: number;
  size_label: string;
  theoretical_qty: number;
  counted_qty: number | null;
  observation: string | null;
}

function linesOf(
  db: import('better-sqlite3').Database,
  inventoryId: number,
): StInventoryLineDTO[] {
  return (
    db
      .prepare(
        `SELECT il.id, il.carton_id, c.code AS carton_code, l.code AS lot_code,
                il.size_id, s.nom AS size_label, il.theoretical_qty, il.counted_qty,
                il.observation
         FROM st_inventory_lines il
         JOIN st_cartons c ON c.id = il.carton_id
         JOIN coupe_lots l ON l.id = il.lot_id
         JOIN sizes s ON s.id = il.size_id
         WHERE il.inventory_id = ? ORDER BY c.code, s.nom`,
      )
      .all(inventoryId) as InventoryLineRow[]
  ).map((row) => ({
    id: row.id,
    cartonId: row.carton_id,
    cartonCode: row.carton_code,
    lotCode: row.lot_code,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    theoreticalQty: row.theoretical_qty,
    countedQty: row.counted_qty,
    observation: row.observation,
  }));
}

function mapInventory(db: import('better-sqlite3').Database, row: InventoryRow): StInventoryDTO {
  const lines = linesOf(db, row.id);
  return {
    id: row.id,
    code: row.code,
    locationCode: row.location_code,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    countedAt: row.counted_at,
    lines,
    gapsCount: lines.filter(
      (line) => line.countedQty !== null && line.countedQty !== line.theoreticalQty,
    ).length,
  };
}

const INVENTORY_SELECT = `
  SELECT i.*, loc.code AS location_code,
         u.nom || ' ' || u.prenom AS created_by_name
  FROM st_inventories i
  LEFT JOIN st_locations loc ON loc.id = i.location_id
  LEFT JOIN users u ON u.id = i.created_by`;

export function listInventories(actor: Actor): StInventoryDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${INVENTORY_SELECT} ORDER BY i.id DESC LIMIT 200`).all() as InventoryRow[]
  ).map((row) => mapInventory(db, row));
}

export function getInventory(actor: Actor, inventoryId: number): StInventoryDTO {
  requireStock(actor);
  const db = sessionsDb();
  const row = db.prepare(`${INVENTORY_SELECT} WHERE i.id = ?`).get(inventoryId) as
    | InventoryRow
    | undefined;
  if (!row) throw new ServiceError('Session d’inventaire introuvable.', 404);
  return mapInventory(db, row);
}

/** Création : fige le théorique des cartons du périmètre choisi. */
export function createInventory(
  actor: Actor,
  input: Record<string, unknown>,
): StInventoryDTO {
  requireStock(actor);
  const db = sessionsDb();
  const locationId = input.locationId ? requireId(input.locationId, 'Emplacement') : null;
  const notes = normalizeText(input.notes, 300);
  const run = db.transaction((): number => {
    const code = nextCode(db, 'st_inventories', 'INV-');
    const result = db
      .prepare(
        `INSERT INTO st_inventories (code, location_id, notes, created_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(code, locationId, notes, actor.id);
    const id = Number(result.lastInsertRowid);
    const params: number[] = [];
    let scope = `WHERE c.status NOT IN ('annule','vide')
                   AND EXISTS (SELECT 1 FROM st_carton_lines cl WHERE cl.carton_id = c.id)`;
    if (locationId !== null) {
      scope += ' AND c.location_id = ?';
      params.push(locationId);
    }
    const cartonLines = db
      .prepare(
        `SELECT cl.carton_id, cl.lot_id, cl.size_id, COALESCE(SUM(cl.qty), 0) AS qty
         FROM st_cartons c
         JOIN st_carton_lines cl ON cl.carton_id = c.id
         ${scope}
         GROUP BY cl.carton_id, cl.lot_id, cl.size_id`,
      )
      .all(...params) as Array<{
      carton_id: number;
      lot_id: number;
      size_id: number;
      qty: number;
    }>;
    if (cartonLines.length === 0) {
      throw new ServiceError(
        'Aucun carton dans le périmètre choisi : rien à inventorier.',
        409,
      );
    }
    const insertLine = db.prepare(
      `INSERT INTO st_inventory_lines
         (inventory_id, carton_id, lot_id, size_id, theoretical_qty)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const line of cartonLines) {
      insertLine.run(id, line.carton_id, line.lot_id, line.size_id, line.qty);
    }
    addHistory(db, {
      action: 'INVENTAIRE_CREE',
      entityType: 'st_inventory',
      entityId: id,
      actorId: actor.id,
      newValue: { code, locationId, lines: cartonLines.length },
    });
    return id;
  });
  const id = run();
  return getInventory(actor, id);
}

/** Saisie du comptage physique : aucune écriture de stock. */
export function submitCount(actor: Actor, input: Record<string, unknown>): StInventoryDTO {
  requireStock(actor);
  const db = sessionsDb();
  const inventoryId = requireId(input.inventoryId, 'Inventaire');
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucun comptage fourni.', 400);
  }
  const run = db.transaction((): void => {
    const inventory = db
      .prepare('SELECT id, code, status FROM st_inventories WHERE id = ?')
      .get(inventoryId) as { id: number; code: string; status: string } | undefined;
    if (!inventory) throw new ServiceError('Session d’inventaire introuvable.', 404);
    if (inventory.status !== 'comptage' && inventory.status !== 'ecarts') {
      throw new ServiceError(
        `Le comptage n'est plus modifiable (statut : ${inventory.status}).`,
        409,
      );
    }
    for (const raw of rawLines as Array<Record<string, unknown>>) {
      const lineId = requireId(raw.lineId, 'Ligne d’inventaire');
      const countedQty = toNumber(raw.countedQty, 'La quantité comptée');
      if (countedQty < 0) {
        throw new ServiceError('La quantité comptée ne peut pas être négative.', 400);
      }
      const observation = normalizeText(raw.observation, 300);
      const line = db
        .prepare(
          'SELECT id, inventory_id FROM st_inventory_lines WHERE id = ?',
        )
        .get(lineId) as { id: number; inventory_id: number } | undefined;
      if (!line || line.inventory_id !== inventoryId) {
        throw new ServiceError('Ligne d’inventaire inconnue pour cette session.', 400);
      }
      db.prepare(
        `UPDATE st_inventory_lines
         SET counted_qty = ?, observation = ?, counted_by = ?, counted_at = datetime('now')
         WHERE id = ?`,
      ).run(countedQty, observation, actor.id, lineId);
    }
    const gaps = db
      .prepare(
        `SELECT COUNT(*) AS n FROM st_inventory_lines
         WHERE inventory_id = ? AND counted_qty IS NOT NULL
           AND counted_qty != theoretical_qty`,
      )
      .get(inventoryId) as { n: number };
    const counted = db
      .prepare(
        `SELECT COUNT(*) AS n FROM st_inventory_lines
         WHERE inventory_id = ? AND counted_qty IS NOT NULL`,
      )
      .get(inventoryId) as { n: number };
    const total = db
      .prepare('SELECT COUNT(*) AS n FROM st_inventory_lines WHERE inventory_id = ?')
      .get(inventoryId) as { n: number };
    if (counted.n < total.n) {
      if (inventory.status === 'comptage') return;
      return;
    }
    const nextStatus = gaps.n > 0 ? 'ecarts' : 'valide';
    db.prepare(
      `UPDATE st_inventories SET status = ?, counted_at = datetime('now') WHERE id = ?`,
    ).run(nextStatus, inventoryId);
    addHistory(db, {
      action: 'INVENTAIRE_COMPTAGE',
      entityType: 'st_inventory',
      entityId: inventoryId,
      actorId: actor.id,
      oldValue: { status: inventory.status },
      newValue: { status: nextStatus, gaps: gaps.n },
    });
  });
  run();
  return getInventory(actor, inventoryId);
}
