import {
  validateIsoDate,
  validateOptionalIsoDate,
  validatePeriod,
  validatePositiveNumber,
} from '@/lib/config-validation';
import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CadenceRow } from '@/types/config';

/**
 * Cadences de production.
 * Règle d'unicité : une seule configuration ACTIVE par contexte
 * (type de produit, salle, ligne). Règle de priorité à la lecture :
 * le contexte le plus spécifique l'emporte (ligne > salle > global ;
 * type de produit spécifique > tous types).
 */

interface CadenceDbRow {
  id: number;
  productTypeId: number | null;
  productTypeNom: string | null;
  roomId: number | null;
  roomNom: string | null;
  lineId: number | null;
  lineNom: string | null;
  value: number;
  unit: string;
  period: 'heure' | 'jour';
  startDate: string;
  endDate: string | null;
  isActive: number;
}

const SELECT_CADENCES = `
  SELECT c.id,
         c.product_type_id AS productTypeId, t.nom AS productTypeNom,
         c.room_id AS roomId, r.nom AS roomNom,
         c.line_id AS lineId, l.nom AS lineNom,
         c.cadence_value AS value, c.unit, c.period,
         c.start_date AS startDate, c.end_date AS endDate,
         c.is_active AS isActive
  FROM production_cadences c
  LEFT JOIN product_types t ON t.id = c.product_type_id
  LEFT JOIN sewing_rooms r ON r.id = c.room_id
  LEFT JOIN sewing_lines l ON l.id = c.line_id`;

export function listCadences(
  filters: { productTypeId?: number; roomId?: number; status?: string } = {},
): CadenceRow[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.productTypeId) {
    clauses.push('c.product_type_id = ?');
    params.push(filters.productTypeId);
  }
  if (filters.roomId) {
    clauses.push('c.room_id = ?');
    params.push(filters.roomId);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('c.is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${SELECT_CADENCES} ${where} ORDER BY c.id DESC`)
    .all(...params) as CadenceDbRow[];
  return rows.map((row) => ({ ...row, isActive: row.isActive === 1 }));
}

function requireAdmin(actor: Actor): void {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
}

export interface CadenceInput {
  productTypeId?: unknown;
  roomId?: unknown;
  lineId?: unknown;
  value?: unknown;
  unit?: unknown;
  period?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

interface ParsedContext {
  productTypeId: number | null;
  roomId: number | null;
  lineId: number | null;
  value: number;
  unit: string;
  period: 'heure' | 'jour';
  startDate: string;
  endDate: string | null;
}

function parseOptionalId(
  value: unknown,
  table: string,
  label: string,
  db: ReturnType<typeof sessionsDb>,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServiceError(`Identifiant de ${label} invalide.`, 400);
  }
  if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) {
    throw new ServiceError(`${label} introuvable.`, 400);
  }
  return id;
}

function parseCadence(input: CadenceInput, db: ReturnType<typeof sessionsDb>): ParsedContext {
  const errors: string[] = [];
  const productTypeId = parseOptionalId(input.productTypeId, 'product_types', 'Type de produit', db);
  const roomId = parseOptionalId(input.roomId, 'sewing_rooms', 'Salle', db);
  const lineId = parseOptionalId(input.lineId, 'sewing_lines', 'Ligne', db);
  if (lineId && roomId) {
    const line = db
      .prepare('SELECT room_id FROM sewing_lines WHERE id = ?')
      .get(lineId) as { room_id: number } | undefined;
    if (!line || line.room_id !== roomId) {
      throw new ServiceError(
        "La ligne sélectionnée n'appartient pas à la salle indiquée.",
        400,
      );
    }
  }
  const valueError = validatePositiveNumber(input.value, 'La valeur de cadence');
  if (valueError) errors.push(valueError);
  const unit =
    input.unit !== undefined && input.unit !== null && String(input.unit).trim() !== ''
      ? String(input.unit).trim()
      : null;
  if (!unit) errors.push("L'unité de mesure est requise (ex. pièces/heure).");
  if (unit && unit.length > 40) errors.push("L'unité de mesure ne doit pas dépasser 40 caractères.");
  const periodError = validatePeriod(input.period);
  if (periodError) errors.push(periodError);
  const startError = validateIsoDate(input.startDate, 'La date de début');
  if (startError) errors.push(startError);
  const endError = validateOptionalIsoDate(input.endDate, 'La date de fin');
  if (endError) errors.push(endError);
  if (
    typeof input.startDate === 'string' &&
    typeof input.endDate === 'string' &&
    input.endDate &&
    Date.parse(input.endDate) < Date.parse(input.startDate)
  ) {
    errors.push('La date de fin doit être postérieure à la date de début.');
  }
  if (errors.length > 0) throw new ServiceError(errors.join(' '), 400);

  return {
    productTypeId,
    roomId: lineId ? null : roomId,
    lineId,
    value: Number(input.value),
    unit: unit as string,
    period: input.period as 'heure' | 'jour',
    startDate: String(input.startDate).trim(),
    endDate: input.endDate ? String(input.endDate).trim() : null,
  };
}

function checkConflict(
  db: ReturnType<typeof sessionsDb>,
  context: ParsedContext,
  excludeId?: number,
): void {
  const condition = excludeId ? 'AND id != ?' : '';
  const params: unknown[] = excludeId ? [excludeId] : [];
  const conflict = db
    .prepare(
      `SELECT id FROM production_cadences
       WHERE is_active = 1
         AND IFNULL(product_type_id, 0) = IFNULL(?, 0)
         AND IFNULL(room_id, 0) = IFNULL(?, 0)
         AND IFNULL(line_id, 0) = IFNULL(?, 0) ${condition}`,
    )
    .get(context.productTypeId, context.roomId, context.lineId, ...params) as
    | { id: number }
    | undefined;
  if (conflict) {
    throw new ServiceError(
      'Une configuration active existe déjà pour ce contexte (type de produit / salle / ligne). Désactivez-la avant de créer la nouvelle.',
      409,
    );
  }
}

export function createCadence(actor: Actor, input: CadenceInput): CadenceRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const context = parseCadence(input, db);
  checkConflict(db, context);
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO production_cadences
         (product_type_id, room_id, line_id, cadence_value, unit, period, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.productTypeId,
        context.roomId,
        context.lineId,
        context.value,
        context.unit,
        context.period,
        context.startDate,
        context.endDate,
      );
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: { entity: 'cadence', id: Number(result.lastInsertRowid) },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return listCadences().find((row) => row.id === id) as CadenceRow;
}

export function updateCadence(
  actor: Actor,
  id: number,
  input: CadenceInput & { isActive?: unknown },
): CadenceRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const existing = db
    .prepare('SELECT id, is_active FROM production_cadences WHERE id = ?')
    .get(id) as { id: number; is_active: number } | undefined;
  if (!existing) {
    throw new ServiceError('Cadence introuvable.', 404);
  }
  const hasContextChange = Object.keys(input).some((key) => key !== 'isActive');
  const context = hasContextChange ? parseCadence(input, db) : null;
  if (context && (existing.is_active === 1 || input.isActive)) {
    checkConflict(db, context, id);
  }
  const isActive = input.isActive === undefined ? undefined : input.isActive ? 1 : 0;
  if (isActive === 1 && existing.is_active !== 1 && !context) {
    // Réactivation : reconstruire le contexte depuis la ligne existante.
    const row = db
      .prepare(
        `SELECT product_type_id, room_id, line_id FROM production_cadences WHERE id = ?`,
      )
      .get(id) as { product_type_id: number | null; room_id: number | null; line_id: number | null };
    checkConflict(db, {
      productTypeId: row.product_type_id,
      roomId: row.room_id,
      lineId: row.line_id,
    } as ParsedContext, id);
  }
  const apply = db.transaction(() => {
    if (context) {
      db.prepare(
        `UPDATE production_cadences SET product_type_id = ?, room_id = ?, line_id = ?,
                cadence_value = ?, unit = ?, period = ?, start_date = ?, end_date = ?,
                updated_at = datetime('now') WHERE id = ?`,
      ).run(
        context.productTypeId,
        context.roomId,
        context.lineId,
        context.value,
        context.unit,
        context.period,
        context.startDate,
        context.endDate,
        id,
      );
    }
    if (isActive !== undefined) {
      db.prepare(
        `UPDATE production_cadences SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(isActive, id);
    }
    writeAudit(db, {
      action: isActive === 0 ? 'CONFIG_DEACTIVATED' : 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: 'cadence', id },
    });
  });
  apply();
  return listCadences().find((row) => row.id === id) as CadenceRow;
}

/** Règle de priorité : contexte le plus spécifique (ligne > salle ; type > global). */
export function findApplicableCadence(
  productTypeId: number | null,
  roomId: number | null,
  lineId: number | null,
): CadenceRow | null {
  const db = sessionsDb();
  const rows = db
    .prepare(
      `${SELECT_CADENCES}
       WHERE c.is_active = 1
         AND (c.product_type_id IS NULL OR c.product_type_id = ?)
         AND (c.room_id IS NULL OR c.room_id = ?)
         AND (c.line_id IS NULL OR c.line_id = ?)
         AND (c.end_date IS NULL OR c.end_date >= date('now'))`,
    )
    .all(productTypeId, roomId, lineId) as CadenceDbRow[];
  if (rows.length === 0) return null;
  const score = (row: CadenceDbRow): number =>
    (row.lineId ? 4 : 0) + (row.roomId ? 2 : 0) + (row.productTypeId ? 1 : 0);
  const best = rows.reduce((acc, row) => (score(row) > score(acc) ? row : acc));
  return { ...best, isActive: best.isActive === 1 };
}
