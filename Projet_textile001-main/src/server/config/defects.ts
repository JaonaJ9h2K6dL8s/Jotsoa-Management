import type Database from 'better-sqlite3';
import {
  normalizeName,
  validateCode,
  validateDescription,
  validateLibelle,
} from '@/lib/config-validation';
import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { DefectRow } from '@/types/config';

/**
 * Défauts de qualité : CRUD + associations types de produits et zones
 * de retouche. Aucune suppression physique.
 */

interface DefectDbRow {
  id: number;
  code: string;
  nom: string;
  description: string;
  category: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

const SELECT_DEFECTS = `
  SELECT id, code, nom, description, category, is_active AS isActive,
         created_at AS createdAt, updated_at AS updatedAt
  FROM defects`;

function loadAssociations(
  db: Database.Database,
  defectIds: number[],
): { types: Map<number, number[]>; zones: Map<number, number[]> } {
  const types = new Map<number, number[]>();
  const zones = new Map<number, number[]>();
  if (defectIds.length === 0) return { types, zones };
  const placeholders = defectIds.map(() => '?').join(', ');
  const typeRows = db
    .prepare(
      `SELECT defect_id, product_type_id FROM defect_product_types WHERE defect_id IN (${placeholders})`,
    )
    .all(...defectIds) as { defect_id: number; product_type_id: number }[];
  for (const row of typeRows) {
    types.set(row.defect_id, [...(types.get(row.defect_id) ?? []), row.product_type_id]);
  }
  const zoneRows = db
    .prepare(
      `SELECT defect_id, zone_id FROM defect_rework_zones WHERE defect_id IN (${placeholders})`,
    )
    .all(...defectIds) as { defect_id: number; zone_id: number }[];
  for (const row of zoneRows) {
    zones.set(row.defect_id, [...(zones.get(row.defect_id) ?? []), row.zone_id]);
  }
  return { types, zones };
}

export function listDefects(
  filters: { search?: string; status?: string; category?: string } = {},
): DefectRow[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    const like = `%${normalizeName(filters.search)}%`;
    clauses.push('(LOWER(TRIM(nom)) LIKE ? OR LOWER(TRIM(code)) LIKE ?)');
    params.push(like, like);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  if (filters.category) {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${SELECT_DEFECTS} ${where} ORDER BY code, nom`)
    .all(...params) as DefectDbRow[];
  const { types, zones } = loadAssociations(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    isActive: row.isActive === 1,
    productTypeIds: types.get(row.id) ?? [],
    zoneIds: zones.get(row.id) ?? [],
  }));
}

function getDefect(db: Database.Database, id: number): DefectDbRow {
  const row = db.prepare(`${SELECT_DEFECTS} WHERE id = ?`).get(id) as
    | DefectDbRow
    | undefined;
  if (!row) {
    throw new ServiceError('Défaut introuvable.', 404);
  }
  return row;
}

function validateIds(
  db: Database.Database,
  values: unknown,
  table: string,
  label: string,
): number[] | undefined {
  if (values === undefined || values === null) return undefined;
  if (!Array.isArray(values)) {
    throw new ServiceError(`La liste des ${label} est invalide.`, 400);
  }
  const ids = values.map((value) => Number(value));
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ServiceError(`Identifiant de ${label} invalide.`, 400);
    }
    if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) {
      throw new ServiceError(`Un élément sélectionné (${label}) est introuvable.`, 400);
    }
  }
  return ids;
}

export interface DefectInput {
  code?: unknown;
  nom?: unknown;
  description?: unknown;
  category?: unknown;
  isActive?: unknown;
  productTypeIds?: unknown;
  zoneIds?: unknown;
}

function validateBase(db: Database.Database, input: DefectInput, excludeId?: number) {
  const errors: string[] = [];
  let code: string | undefined;
  let nom: string | undefined;
  if (input.code !== undefined) {
    const error = validateCode(input.code);
    if (error) errors.push(error);
    else code = String(input.code).trim().toUpperCase();
  }
  if (input.nom !== undefined) {
    const error = validateLibelle(input.nom, 'Le libellé');
    if (error) errors.push(error);
    else nom = String(input.nom).trim();
  }
  const descriptionError = validateDescription(input.description ?? '');
  if (descriptionError) errors.push(descriptionError);
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }
  if (code) {
    const condition = excludeId ? 'AND id != ?' : '';
    const params: unknown[] = excludeId ? [code, excludeId] : [code];
    if (db.prepare(`SELECT id FROM defects WHERE UPPER(TRIM(code)) = ? ${condition}`).get(...params)) {
      throw new ServiceError('Ce code de défaut est déjà utilisé.', 409);
    }
  }
  if (nom) {
    const condition = excludeId ? 'AND id != ?' : '';
    const params: unknown[] = excludeId ? [normalizeName(nom), excludeId] : [normalizeName(nom)];
    if (db.prepare(`SELECT id FROM defects WHERE LOWER(TRIM(nom)) = ? ${condition}`).get(...params)) {
      throw new ServiceError('Ce libellé de défaut est déjà utilisé.', 409);
    }
  }
  return {
    code,
    nom,
    description: input.description !== undefined ? String(input.description ?? '').trim() || null : undefined,
    category:
      input.category !== undefined && input.category !== null && input.category !== ''
        ? String(input.category).trim() || null
        : input.category === null
          ? null
          : undefined,
  };
}

export function createDefect(actor: Actor, input: DefectInput): DefectRow {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
  const db = sessionsDb();
  const base = validateBase(db, input);
  if (!base.code || !base.nom) {
    throw new ServiceError('Le code et le libellé du défaut sont requis.', 400);
  }
  const typeIds = validateIds(db, input.productTypeIds, 'product_types', 'types de produits') ?? [];
  const zoneIds = validateIds(db, input.zoneIds, 'rework_zones', 'zones de retouche') ?? [];
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        'INSERT INTO defects (code, nom, description, category) VALUES (?, ?, ?, ?)',
      )
      .run(base.code, base.nom, base.description ?? '', base.category ?? null);
    const defectId = Number(result.lastInsertRowid);
    for (const typeId of typeIds) {
      db.prepare('INSERT OR IGNORE INTO defect_product_types (defect_id, product_type_id) VALUES (?, ?)')
        .run(defectId, typeId);
    }
    for (const zoneId of zoneIds) {
      db.prepare('INSERT OR IGNORE INTO defect_rework_zones (defect_id, zone_id) VALUES (?, ?)')
        .run(defectId, zoneId);
    }
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: { entity: 'defect', id: defectId, code: base.code, nom: base.nom },
    });
    return defectId;
  });
  const id = insert();
  return listDefects().find((defect) => defect.id === id) as DefectRow;
}

export function updateDefect(actor: Actor, id: number, input: DefectInput): DefectRow {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
  const db = sessionsDb();
  getDefect(db, id);
  const base = validateBase(db, input, id);
  const typeIds = validateIds(db, input.productTypeIds, 'product_types', 'types de produits');
  const zoneIds = validateIds(db, input.zoneIds, 'rework_zones', 'zones de retouche');
  const isActive = input.isActive === undefined ? undefined : input.isActive ? 1 : 0;
  const apply = db.transaction(() => {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (base.code !== undefined) { fields.push('code = ?'); params.push(base.code); }
    if (base.nom !== undefined) { fields.push('nom = ?'); params.push(base.nom); }
    if (base.description !== undefined) { fields.push('description = ?'); params.push(base.description ?? ''); }
    if (base.category !== undefined) { fields.push('category = ?'); params.push(base.category); }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive); }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE defects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    if (typeIds !== undefined) {
      db.prepare('DELETE FROM defect_product_types WHERE defect_id = ?').run(id);
      for (const typeId of typeIds) {
        db.prepare('INSERT OR IGNORE INTO defect_product_types (defect_id, product_type_id) VALUES (?, ?)')
          .run(id, typeId);
      }
    }
    if (zoneIds !== undefined) {
      db.prepare('DELETE FROM defect_rework_zones WHERE defect_id = ?').run(id);
      for (const zoneId of zoneIds) {
        db.prepare('INSERT OR IGNORE INTO defect_rework_zones (defect_id, zone_id) VALUES (?, ?)')
          .run(id, zoneId);
      }
    }
    writeAudit(db, {
      action: isActive === 0 ? 'CONFIG_DEACTIVATED' : 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: 'defect', id, code: base.code },
    });
  });
  apply();
  return listDefects().find((defect) => defect.id === id) as DefectRow;
}
