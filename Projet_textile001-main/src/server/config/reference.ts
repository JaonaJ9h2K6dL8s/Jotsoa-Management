import type Database from 'better-sqlite3';
import { normalizeName } from '@/lib/config-validation';
import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { ReferenceRow } from '@/types/config';

/**
 * CRUD générique pour les entités de référence simples
 * (types de produits, couleurs, tailles).
 * Doublons détectés par nom normalisé ; jamais de suppression physique :
 * seule la désactivation est possible (traçabilité préservée).
 */

export interface ReferenceFieldDef {
  column: string;
  required: boolean;
  max: number;
  label: string;
  min?: number;
  validate?: (value: unknown) => string | null;
}

export interface ReferenceDefinition {
  table: string;
  label: string;
  nameColumn: string;
  select: string;
  auditKey: string;
  fields: ReferenceFieldDef[];
}

export interface ReferenceFilters {
  search?: string;
  status?: string;
}

function requireAdmin(actor: Actor): void {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError(
      'Seul un administrateur peut modifier la configuration.',
      403,
    );
  }
}

function collectFields(
  def: ReferenceDefinition,
  input: Record<string, unknown>,
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  const errors: string[] = [];
  for (const field of def.fields) {
    const raw = input[field.column] ?? input[toCamel(field.column)];
    if (raw === undefined) {
      // Champ absent : ignoré (mise à jour partielle, défauts SQL à la création).
      continue;
    }
    const value = raw === null ? '' : String(raw);
    if (!value.trim()) {
      if (field.required) {
        errors.push(`${field.label} est requis(e).`);
      } else {
        values[field.column] = null;
      }
      continue;
    }
    if (value.trim().length > field.max) {
      errors.push(`${field.label} ne doit pas dépasser ${field.max} caractères.`);
      continue;
    }
    if (value.trim().length < (field.min ?? 2)) {
      errors.push(
        `${field.label} doit contenir au moins ${field.min ?? 2} caractères.`,
      );
      continue;
    }
    if (field.validate) {
      const error = field.validate(value);
      if (error) {
        errors.push(error);
        continue;
      }
    }
    values[field.column] = value.trim();
  }
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }
  return values;
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function listReference(
  def: ReferenceDefinition,
  filters: ReferenceFilters = {},
): ReferenceRow[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    clauses.push(`LOWER(TRIM(${def.nameColumn})) LIKE ?`);
    params.push(`%${normalizeName(filters.search)}%`);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${def.select} ${where} ORDER BY id`)
    .all(...params) as Array<Omit<ReferenceRow, 'isActive'> & { isActive: number }>;
  return rows.map((row) => ({ ...row, isActive: row.isActive === 1 }));
}

function findDuplicate(
  db: Database.Database,
  def: ReferenceDefinition,
  name: string,
  excludeId?: number,
): { id: number } | undefined {
  const condition = excludeId ? 'AND id != ?' : '';
  const params: unknown[] = excludeId ? [normalizeName(name), excludeId] : [normalizeName(name)];
  return db
    .prepare(
      `SELECT id FROM ${def.table}
       WHERE LOWER(TRIM(${def.nameColumn})) = ? ${condition}`,
    )
    .get(...params) as { id: number } | undefined;
}

export function createReference(
  def: ReferenceDefinition,
  actor: Actor,
  input: Record<string, unknown>,
): ReferenceRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const values = collectFields(def, input);
  const name = values[def.nameColumn];
  if (!name) {
    throw new ServiceError(`${def.label} : le nom est requis.`, 400);
  }
  if (findDuplicate(db, def, name)) {
    throw new ServiceError(`Ce ${def.label} existe déjà (nom identique).`, 409);
  }
  const columns = Object.keys(values);
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${columns
          .map(() => '?')
          .join(', ')})`,
      )
      .run(...columns.map((column) => values[column]));
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: { entity: def.auditKey, id: Number(result.lastInsertRowid), nom: name },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return listReference(def).find((row) => row.id === id) as ReferenceRow;
}

export function updateReference(
  def: ReferenceDefinition,
  actor: Actor,
  id: number,
  input: Record<string, unknown>,
): ReferenceRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const values = collectFields(def, input);
  const name = values[def.nameColumn];
  if (name && findDuplicate(db, def, name, id)) {
    throw new ServiceError(`Ce ${def.label} existe déjà (nom identique).`, 409);
  }
  const columns = Object.keys(values);
  const apply = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE ${def.table} SET ${columns
          .map((column) => `${column} = ?`)
          .join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...columns.map((column) => values[column]), id);
    if (result.changes === 0) {
      throw new ServiceError(`${def.label} introuvable.`, 404);
    }
    writeAudit(db, {
      action: 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: def.auditKey, id, nom: name },
    });
  });
  apply();
  return listReference(def).find((row) => row.id === id) as ReferenceRow;
}

export function setReferenceActive(
  def: ReferenceDefinition,
  actor: Actor,
  id: number,
  isActive: boolean,
): ReferenceRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const apply = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE ${def.table} SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(isActive ? 1 : 0, id);
    if (result.changes === 0) {
      throw new ServiceError(`${def.label} introuvable.`, 404);
    }
    writeAudit(db, {
      action: isActive ? 'CONFIG_ACTIVATED' : 'CONFIG_DEACTIVATED',
      actorUserId: actor.id,
      details: { entity: def.auditKey, id },
    });
  });
  apply();
  return listReference(def).find((row) => row.id === id) as ReferenceRow;
}
