import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { WasteDTO, WasteType } from '@/types/coupe';
import { WASTE_TYPE_LABELS } from '@/types/coupe';
import {
  addHistory,
  normalizeText,
  requireCoupe,
  requireId,
} from './common';

/**
 * Déclaration des déchets et chutes de tissu, distincts des pièces
 * coupées. Aucune suppression : les déclarations sont conservées.
 */

interface WasteRow {
  id: number;
  lot_id: number | null;
  lot_code: string | null;
  roll_id: number | null;
  roll_code: string | null;
  waste_type: WasteType;
  qty: number;
  unit: string;
  reason: string | null;
  observations: string | null;
  user_name: string | null;
  created_at: string;
}

const WASTE_SELECT = `
  SELECT w.id, w.lot_id, l.code AS lot_code, w.roll_id, r.code AS roll_code,
         w.waste_type, w.qty, w.unit, w.reason, w.observations,
         u.nom || ' ' || u.prenom AS user_name, w.created_at
  FROM coupe_waste w
  LEFT JOIN coupe_lots l ON l.id = w.lot_id
  LEFT JOIN coupe_rolls r ON r.id = w.roll_id
  JOIN users u ON u.id = w.user_id`;

function mapWaste(row: WasteRow): WasteDTO {
  return {
    id: row.id,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    rollId: row.roll_id,
    rollCode: row.roll_code,
    wasteType: row.waste_type,
    qty: row.qty,
    unit: row.unit,
    reason: row.reason,
    observations: row.observations,
    userName: row.user_name,
    createdAt: row.created_at,
  };
}

export function listWaste(
  actor: Actor,
  filters: { lotId?: string; wasteType?: string } = {},
): WasteDTO[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.lotId && Number.isInteger(Number(filters.lotId))) {
    clauses.push('w.lot_id = ?');
    params.push(Number(filters.lotId));
  }
  if (
    filters.wasteType &&
    Object.prototype.hasOwnProperty.call(WASTE_TYPE_LABELS, filters.wasteType)
  ) {
    clauses.push('w.waste_type = ?');
    params.push(filters.wasteType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${WASTE_SELECT} ${where} ORDER BY w.id DESC`)
    .all(...params) as WasteRow[];
  return rows.map(mapWaste);
}

export function getWasteForLot(actor: Actor, lotId: number): WasteDTO[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(`${WASTE_SELECT} WHERE w.lot_id = ? ORDER BY w.id DESC`)
    .all(lotId) as WasteRow[];
  return rows.map(mapWaste);
}

export function declareWaste(
  actor: Actor,
  input: Record<string, unknown>,
): WasteDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const wasteType = String(input.wasteType ?? '');
  if (!Object.prototype.hasOwnProperty.call(WASTE_TYPE_LABELS, wasteType)) {
    throw new ServiceError('Type de déchet invalide.', 400);
  }
  const qty = Number(String(input.qty ?? '').replace(',', '.'));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ServiceError('La quantité de déchet doit être supérieure à 0.', 400);
  }
  const unit = normalizeText(input.unit, 20) ?? 'kg';
  const reason = normalizeText(input.reason, 300);
  const observations = normalizeText(input.observations, 500);
  let lotId: number | null = null;
  if (input.lotId !== undefined && input.lotId !== null && input.lotId !== '') {
    lotId = requireId(input.lotId, 'Lot');
    const lot = db
      .prepare('SELECT id, status FROM coupe_lots WHERE id = ?')
      .get(lotId) as { id: number; status: string } | undefined;
    if (!lot) throw new ServiceError('Lot introuvable.', 400);
    if (lot.status === 'annule') {
      throw new ServiceError(
        'Aucun déchet ne peut être déclaré sur un lot annulé.', 409,
      );
    }
  }
  let rollId: number | null = null;
  if (input.rollId !== undefined && input.rollId !== null && input.rollId !== '') {
    rollId = requireId(input.rollId, 'Rouleau');
    const roll = db
      .prepare('SELECT id FROM coupe_rolls WHERE id = ?')
      .get(rollId) as { id: number } | undefined;
    if (!roll) throw new ServiceError('Rouleau introuvable.', 400);
  }
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO coupe_waste
           (lot_id, roll_id, waste_type, qty, unit, reason, observations, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(lotId, rollId, wasteType, qty, unit, reason, observations, actor.id);
    const id = Number(result.lastInsertRowid);
    addHistory(db, {
      action: 'WASTE_DECLARED',
      entityType: 'dechet',
      entityId: id,
      actorId: actor.id,
      newValue: { lotId, rollId, wasteType, qty, unit },
      reason,
    });
    return id;
  });
  const id = insert();
  const row = db
    .prepare(`${WASTE_SELECT} WHERE w.id = ?`)
    .get(id) as WasteRow;
  return mapWaste(row);
}
