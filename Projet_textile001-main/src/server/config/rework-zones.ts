import type Database from 'better-sqlite3';
import { normalizeName, validateDisplayOrder } from '@/lib/config-validation';
import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { ReworkZoneRow } from '@/types/config';

/**
 * Zones de retouche : CRUD + association aux types de produits.
 * Aucune suppression physique ; désactivation uniquement.
 */

interface ZoneDbRow {
  id: number;
  nom: string;
  displayOrder: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

const SELECT_ZONES = `
  SELECT id, nom, display_order AS displayOrder, is_active AS isActive,
         created_at AS createdAt, updated_at AS updatedAt
  FROM rework_zones`;

function loadTypeIds(db: Database.Database, zoneIds: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  if (zoneIds.length === 0) return map;
  const placeholders = zoneIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT zone_id, product_type_id FROM rework_zone_product_types
       WHERE zone_id IN (${placeholders})`,
    )
    .all(...zoneIds) as { zone_id: number; product_type_id: number }[];
  for (const row of rows) {
    const list = map.get(row.zone_id) ?? [];
    list.push(row.product_type_id);
    map.set(row.zone_id, list);
  }
  return map;
}

export function listReworkZones(filters: { search?: string; status?: string } = {}): ReworkZoneRow[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    clauses.push('LOWER(TRIM(nom)) LIKE ?');
    params.push(`%${normalizeName(filters.search)}%`);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${SELECT_ZONES} ${where} ORDER BY display_order, nom`)
    .all(...params) as ZoneDbRow[];
  const typeIds = loadTypeIds(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    isActive: row.isActive === 1,
    displayOrder: row.displayOrder,
    productTypeIds: typeIds.get(row.id) ?? [],
  }));
}

function getZone(db: Database.Database, id: number): ZoneDbRow {
  const row = db.prepare(`${SELECT_ZONES} WHERE id = ?`).get(id) as
    | ZoneDbRow
    | undefined;
  if (!row) {
    throw new ServiceError('Zone de retouche introuvable.', 404);
  }
  return row;
}

function validateTypeIds(db: Database.Database, typeIds: unknown): number[] {
  if (typeIds === undefined || typeIds === null) return [];
  if (!Array.isArray(typeIds)) {
    throw new ServiceError('La liste des types de produits est invalide.', 400);
  }
  const ids = typeIds.map((value) => Number(value));
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ServiceError('Identifiant de type invalide.', 400);
    }
    const exists = db
      .prepare('SELECT id FROM product_types WHERE id = ?')
      .get(id);
    if (!exists) {
      throw new ServiceError('Un type de produit sélectionné est introuvable.', 400);
    }
  }
  return ids;
}

export interface ZoneInput {
  nom?: unknown;
  displayOrder?: unknown;
  productTypeIds?: unknown;
}

function checkNom(db: Database.Database, nom: string, excludeId?: number): void {
  const condition = excludeId ? 'AND id != ?' : '';
  const params: unknown[] = excludeId ? [normalizeName(nom), excludeId] : [normalizeName(nom)];
  const duplicate = db
    .prepare(
      `SELECT id FROM rework_zones WHERE LOWER(TRIM(nom)) = ? ${condition}`,
    )
    .get(...params);
  if (duplicate) {
    throw new ServiceError('Cette zone de retouche existe déjà.', 409);
  }
}

function validateNom(nom: unknown): string {
  if (typeof nom !== 'string' || nom.trim().length < 2 || nom.trim().length > 80) {
    throw new ServiceError('Le libellé de la zone est requis (2 à 80 caractères).', 400);
  }
  return nom.trim();
}

export function createReworkZone(actor: Actor, input: ZoneInput): ReworkZoneRow {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
  const db = sessionsDb();
  const nom = validateNom(input.nom);
  checkNom(db, nom);
  const orderError = validateDisplayOrder(input.displayOrder ?? 1);
  if (orderError) throw new ServiceError(orderError, 400);
  const typeIds = validateTypeIds(db, input.productTypeIds);
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        'INSERT INTO rework_zones (nom, display_order) VALUES (?, ?)',
      )
      .run(nom, Number(input.displayOrder ?? 1));
    const zoneId = Number(result.lastInsertRowid);
    for (const typeId of typeIds) {
      db.prepare(
        'INSERT OR IGNORE INTO rework_zone_product_types (zone_id, product_type_id) VALUES (?, ?)',
      ).run(zoneId, typeId);
    }
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: { entity: 'rework_zone', id: zoneId, nom, typeIds },
    });
    return zoneId;
  });
  const id = insert();
  return listReworkZones().find((zone) => zone.id === id) as ReworkZoneRow;
}

export function updateReworkZone(
  actor: Actor,
  id: number,
  input: ZoneInput & { isActive?: unknown },
): ReworkZoneRow {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
  const db = sessionsDb();
  getZone(db, id);
  const nom = input.nom !== undefined ? validateNom(input.nom) : undefined;
  if (nom) checkNom(db, nom, id);
  const orderError = validateDisplayOrder(input.displayOrder);
  if (orderError) throw new ServiceError(orderError, 400);
  const typeIds =
    input.productTypeIds !== undefined
      ? validateTypeIds(db, input.productTypeIds)
      : undefined;
  const isActive =
    input.isActive === undefined ? undefined : input.isActive ? 1 : 0;
  const apply = db.transaction(() => {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (nom !== undefined) {
      fields.push('nom = ?');
      params.push(nom);
    }
    if (input.displayOrder !== undefined) {
      fields.push('display_order = ?');
      params.push(Number(input.displayOrder));
    }
    if (isActive !== undefined) {
      fields.push('is_active = ?');
      params.push(isActive);
    }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE rework_zones SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    if (typeIds !== undefined) {
      db.prepare('DELETE FROM rework_zone_product_types WHERE zone_id = ?').run(id);
      for (const typeId of typeIds) {
        db.prepare(
          'INSERT OR IGNORE INTO rework_zone_product_types (zone_id, product_type_id) VALUES (?, ?)',
        ).run(id, typeId);
      }
    }
    writeAudit(db, {
      action: isActive === 0 ? 'CONFIG_DEACTIVATED' : 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: 'rework_zone', id, nom, typeIds },
    });
  });
  apply();
  return listReworkZones().find((zone) => zone.id === id) as ReworkZoneRow;
}
