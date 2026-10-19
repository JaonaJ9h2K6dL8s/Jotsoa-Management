import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type {
  MovementDTO,
  RollDTO,
  RollDetailDTO,
  RollStatus,
} from '@/types/coupe';
import { ROLL_STATUS_LABELS } from '@/types/coupe';
import {
  normalizeCode,
  validateCode,
  validateInitialWeight,
} from '@/lib/coupe-validation';
import {
  addHistory,
  normalizeText,
  nextCode,
  requireActiveRef,
  requireCoupe,
  requireId,
} from './common';
import { createIdentifier, getIdentifier } from './identifiers';

/**
 * Gestion des rouleaux de tissu : création (poids initial 9–30 kg
 * obligatoire), consultation, corrections historisées, blocages,
 * affectations et consommations.
 */

interface RollDbRow {
  id: number;
  code: string;
  fabric_ref: string;
  color_id: number | null;
  color_nom: string | null;
  initial_weight_kg: number;
  initial_qty: number | null;
  qty_unit: string | null;
  remaining_weight_kg: number | null;
  remaining_qty: number | null;
  supplier: string | null;
  status: RollStatus;
  observations: string | null;
  received_at: string;
  updated_at: string;
  grammage_g_m2?: number | null;
  usable_width_cm?: number | null;
}

const ROLL_SELECT = `
  SELECT r.*, c.nom AS color_nom
  FROM coupe_rolls r
  LEFT JOIN colors c ON c.id = r.color_id`;

export function mapRoll(row: RollDbRow): RollDTO {
  return {
    id: row.id,
    code: row.code,
    fabricRef: row.fabric_ref,
    colorId: row.color_id,
    colorNom: row.color_nom,
    initialWeightKg: row.initial_weight_kg,
    initialQty: row.initial_qty,
    qtyUnit: row.qty_unit,
    remainingWeightKg: row.remaining_weight_kg,
    remainingQty: row.remaining_qty,
    supplier: row.supplier,
    status: row.status,
    observations: row.observations,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
    grammageGm2: row.grammage_g_m2 ?? null,
    usableWidthCm: row.usable_width_cm ?? null,
  };
}

export function listRolls(
  actor: Actor,
  filters: { search?: string; status?: string } = {},
): RollDTO[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search?.trim()) {
    clauses.push('(LOWER(r.code) LIKE ? OR LOWER(r.fabric_ref) LIKE ?)');
    const term = `%${filters.search.trim().toLowerCase()}%`;
    params.push(term, term);
  }
  if (
    filters.status &&
    Object.prototype.hasOwnProperty.call(ROLL_STATUS_LABELS, filters.status)
  ) {
    clauses.push('r.status = ?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${ROLL_SELECT} ${where} ORDER BY r.id DESC`)
    .all(...params) as RollDbRow[];
  return rows.map(mapRoll);
}

export function getRollDetail(actor: Actor, rawId: unknown): RollDetailDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant du rouleau');
  const db = sessionsDb();
  const row = db
    .prepare(`${ROLL_SELECT} WHERE r.id = ?`)
    .get(id) as RollDbRow | undefined;
  if (!row) throw new ServiceError('Rouleau introuvable.', 404);
  const movements = db
    .prepare(
      `SELECT m.id, m.roll_id, m.movement_type, l.code AS lot_code,
              m.weight_before, m.weight_after, m.qty, m.unit, m.reason,
              u.nom || ' ' || u.prenom AS user_name, m.created_at
       FROM coupe_roll_movements m
       LEFT JOIN coupe_lots l ON l.id = m.lot_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.roll_id = ? ORDER BY m.id DESC`,
    )
    .all(id) as Array<Omit<MovementDTO, 'userName'> & { user_name: string | null }>;
  const identifier = getIdentifier(db, 'rouleau', id);
  return {
    ...mapRoll(row),
    movements: movements.map((m) => ({ ...m, userName: m.user_name })),
    identifier: identifier
      ? { code: identifier.code, qrPayload: identifier.qrPayload }
      : null,
  };
}

export function createRoll(
  actor: Actor,
  input: Record<string, unknown>,
): RollDetailDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const weightError = validateInitialWeight(input.initialWeightKg);
  if (weightError) throw new ServiceError(weightError, 400);
  const initialWeight = Number(String(input.initialWeightKg).replace(',', '.'));
  const fabricRef = normalizeText(input.fabricRef, 80);
  if (!fabricRef) {
    throw new ServiceError('La référence du tissu est requise.', 400);
  }
  const observations = normalizeText(input.observations, 500);
  const supplier = normalizeText(input.supplier, 120);
  const initialQty = input.initialQty === undefined || input.initialQty === null || input.initialQty === ''
    ? null
    : Number(input.initialQty);
  if (initialQty !== null && (!Number.isFinite(initialQty) || initialQty < 0)) {
    throw new ServiceError('La quantité initiale doit être un nombre positif.', 400);
  }
  const qtyUnit = normalizeText(input.qtyUnit, 20);
  let colorId: number | null = null;
  if (input.colorId !== undefined && input.colorId !== null && input.colorId !== '') {
    colorId = requireId(input.colorId, 'Couleur');
    requireActiveRef(db, 'colors', colorId, 'La couleur');
  }
  let code = input.code ? normalizeCode(input.code) : '';
  if (input.code) {
    const codeError = validateCode(input.code, 'Le code du rouleau');
    if (codeError) throw new ServiceError(codeError, 400);
    const existing = db
      .prepare('SELECT id FROM coupe_rolls WHERE code = ?')
      .get(code) as { id: number } | undefined;
    if (existing) {
      throw new ServiceError(`Le code « ${code} » est déjà utilisé.`, 409);
    }
  }
  const insert = db.transaction(() => {
    if (!code) {
      code = nextCode(db, 'coupe_rolls', 'RO-');
      const seq = db
        .prepare('SELECT id FROM coupe_rolls WHERE code = ?')
        .get(code);
      if (seq) code = `${code}-${Date.now() % 10000}`;
    }
    const result = db
      .prepare(
        `INSERT INTO coupe_rolls
           (code, fabric_ref, color_id, initial_weight_kg, initial_qty, qty_unit,
            remaining_weight_kg, remaining_qty, supplier, status, observations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponible', ?)`,
      )
      .run(
        code, fabricRef, colorId, initialWeight, initialQty, qtyUnit,
        initialWeight, initialQty, supplier, observations,
      );
    const id = Number(result.lastInsertRowid);
    createIdentifier(db, {
      objectType: 'rouleau', objectId: id, code, actorId: actor.id,
    });
    db.prepare(
      `INSERT INTO coupe_roll_movements
         (roll_id, movement_type, weight_after, reason, user_id)
       VALUES (?, 'creation', ?, 'Réception du rouleau', ?)`,
    ).run(id, initialWeight, actor.id);
    addHistory(db, {
      action: 'ROLL_CREATED', entityType: 'rouleau', entityId: id,
      actorId: actor.id,
      newValue: { code, initialWeightKg: initialWeight, fabricRef },
    });
    return id;
  });
  const id = insert();
  return getRollDetail(actor, id);
}

export function updateRoll(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): RollDetailDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant du rouleau');
  const db = sessionsDb();
  const roll = db
    .prepare('SELECT * FROM coupe_rolls WHERE id = ?')
    .get(id) as
    | { id: number; code: string; initial_weight_kg: number; remaining_weight_kg: number | null; status: RollStatus }
    | undefined;
  if (!roll) throw new ServiceError('Rouleau introuvable.', 404);
  const action = String(input.action ?? '');
  const apply = db.transaction(() => {
    if (action === 'correct_weight') {
      const reason = normalizeText(input.reason, 300);
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour corriger le poids initial.', 400,
        );
      }
      const weightError = validateInitialWeight(input.newWeightKg);
      if (weightError) throw new ServiceError(weightError, 400);
      const newWeight = Number(String(input.newWeightKg).replace(',', '.'));
      if (newWeight === roll.initial_weight_kg) {
        throw new ServiceError('Le nouveau poids est identique à l’ancien.', 400);
      }
      db.prepare(
        "UPDATE coupe_rolls SET initial_weight_kg = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(newWeight, id);
      db.prepare(
        `INSERT INTO coupe_roll_movements
           (roll_id, movement_type, weight_before, weight_after, reason, user_id)
         VALUES (?, 'correction_poids', ?, ?, ?, ?)`,
      ).run(id, roll.initial_weight_kg, newWeight, reason, actor.id);
      addHistory(db, {
        action: 'ROLL_WEIGHT_CORRECTED', entityType: 'rouleau', entityId: id,
        actorId: actor.id,
        oldValue: { initialWeightKg: roll.initial_weight_kg },
        newValue: { initialWeightKg: newWeight },
        reason,
      });
    } else if (action === 'set_status') {
      const status = String(input.status ?? '') as RollStatus;
      if (!Object.prototype.hasOwnProperty.call(ROLL_STATUS_LABELS, status)) {
        throw new ServiceError('Statut de rouleau invalide.', 400);
      }
      const reason = normalizeText(input.reason, 300);
      if ((status === 'bloque' || status === 'defectueux') && !reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour bloquer ou déclarer défectueux un rouleau.', 400,
        );
      }
      db.prepare(
        "UPDATE coupe_rolls SET status = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(status, id);
      const movementType =
        status === 'bloque' ? 'blocage'
        : status === 'disponible' && roll.status === 'bloque' ? 'deblocage'
        : 'statut';
      db.prepare(
        `INSERT INTO coupe_roll_movements
           (roll_id, movement_type, reason, user_id) VALUES (?, ?, ?, ?)`,
      ).run(id, movementType, reason ?? `Statut : ${ROLL_STATUS_LABELS[status]}`, actor.id);
      addHistory(db, {
        action: 'ROLL_STATUS_CHANGED', entityType: 'rouleau', entityId: id,
        actorId: actor.id,
        oldValue: { status: roll.status }, newValue: { status }, reason,
      });
    } else if (action === 'set_observations') {
      const observations = normalizeText(input.observations, 500);
      db.prepare(
        "UPDATE coupe_rolls SET observations = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(observations, id);
      addHistory(db, {
        action: 'ROLL_UPDATED', entityType: 'rouleau', entityId: id,
        actorId: actor.id, newValue: { observations },
      });
    } else {
      throw new ServiceError('Action inconnue sur le rouleau.', 400);
    }
  });
  apply();
  return getRollDetail(actor, id);
}
