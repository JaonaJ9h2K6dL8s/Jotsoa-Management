import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StWasteMovementDTO, StWasteStockDTO } from '@/types/stock';
import {
  addHistory,
  normalizeText,
  requireId,
  requireStock,
  requireText,
  toNumber,
} from './common';

/**
 * Stock des déchets textiles : distinct du stock de vêtements finis.
 * Les entrées restent la table coupe_waste de l'étape Coupe (kg) ;
 * ce module n'enregistre que les sorties et ajustements autorisés.
 * Aucune conversion d'unité : les kg ne sont jamais mélangés aux pièces.
 */

const WASTE_TYPES = ['chute', 'dechet', 'tissu_defectueux', 'autre'] as const;

export function listWasteStock(actor: Actor): StWasteStockDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  const totals = db
    .prepare(
      `SELECT waste_type, COALESCE(SUM(qty), 0) AS total_kg FROM coupe_waste
       GROUP BY waste_type`,
    )
    .all() as Array<{ waste_type: string; total_kg: number }>;
  const out = db
    .prepare(
      `SELECT waste_type,
              COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN qty ELSE 0 END), 0) AS out_kg,
              COALESCE(SUM(CASE WHEN movement_type = 'ajustement' THEN qty ELSE 0 END), 0) AS adj_kg
       FROM st_waste_movements GROUP BY waste_type`,
    )
    .all() as Array<{ waste_type: string; out_kg: number; adj_kg: number }>;
  const outByType = new Map(out.map((row) => [row.waste_type, row]));
  return totals.map((row) => {
    const movements = outByType.get(row.waste_type);
    const outKg = movements?.out_kg ?? 0;
    const adjKg = movements?.adj_kg ?? 0;
    return {
      wasteType: row.waste_type,
      totalKg: row.total_kg,
      outKg,
      availableKg: row.total_kg - outKg + adjKg,
    };
  });
}

export function listWasteMovements(actor: Actor): StWasteMovementDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT w.id, w.waste_type, w.movement_type, l.code AS lot_code,
                w.qty, w.unit, w.reason, u.nom || ' ' || u.prenom AS user_name,
                w.created_at
         FROM st_waste_movements w
         LEFT JOIN coupe_lots l ON l.id = w.lot_id
         LEFT JOIN users u ON u.id = w.user_id
         ORDER BY w.id DESC LIMIT 300`,
      )
      .all() as Array<{
      id: number;
      waste_type: string;
      movement_type: 'sortie' | 'ajustement';
      lot_code: string | null;
      qty: number;
      unit: string;
      reason: string;
      user_name: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    wasteType: row.waste_type,
    movementType: row.movement_type,
    lotCode: row.lot_code,
    qty: row.qty,
    unit: row.unit,
    reason: row.reason,
    userName: row.user_name,
    createdAt: row.created_at,
  }));
}

export function recordWasteMovement(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireStock(actor);
  const db = sessionsDb();
  const wasteType = String(input.wasteType ?? '');
  if (!(WASTE_TYPES as readonly string[]).includes(wasteType)) {
    throw new ServiceError('Type de déchet inconnu.', 400);
  }
  const movementType = String(input.movementType ?? '');
  if (movementType !== 'sortie' && movementType !== 'ajustement') {
    throw new ServiceError('Type de mouvement de déchet inconnu.', 400);
  }
  const lotId = input.lotId ? requireId(input.lotId, 'Lot') : null;
  const qty = toNumber(input.qty, 'La quantité');
  const reason = requireText(input.reason, 'Le motif', 300);
  if (movementType === 'sortie' && qty <= 0) {
    throw new ServiceError('La quantité sortie doit être strictement positive.', 400);
  }
  if (movementType === 'ajustement' && qty === 0) {
    throw new ServiceError("Un ajustement ne peut pas être nul.", 400);
  }
  if (movementType === 'sortie') {
    const stock = listWasteStock(actor).find((row) => row.wasteType === wasteType);
    if (!stock || qty > stock.availableKg) {
      throw new ServiceError(
        `Sortie refusée : disponible ${stock?.availableKg ?? 0} kg pour ce type de déchet.`,
        409,
      );
    }
  }
  const run = db.transaction((): void => {
    db.prepare(
      `INSERT INTO st_waste_movements
         (waste_type, movement_type, lot_id, qty, unit, reason, user_id)
       VALUES (?, ?, ?, ?, 'kg', ?, ?)`,
    ).run(wasteType, movementType, lotId, qty, reason, actor.id);
    addHistory(db, {
      action:
        movementType === 'sortie' ? 'DECHET_SORTIE' : 'DECHET_AJUSTEMENT',
      entityType: 'st_waste',
      entityId: 0,
      actorId: actor.id,
      newValue: { wasteType, qty, lotId },
      reason,
    });
  });
  run();
}

/** Consultation : libellé des types de déchets pour l'interface. */
export function wasteTypes(actor: Actor): Array<{ value: string; label: string }> {
  requireStock(actor);
  void normalizeText;
  return [
    { value: 'chute', label: 'Chutes' },
    { value: 'dechet', label: 'Déchets' },
    { value: 'tissu_defectueux', label: 'Tissu défectueux' },
    { value: 'autre', label: 'Autre' },
  ];
}
