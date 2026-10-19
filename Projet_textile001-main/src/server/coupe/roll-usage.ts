import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RollStatus } from '@/types/coupe';
import { ROLL_STATUS_LABELS } from '@/types/coupe';
import { addHistory } from './common';

/**
 * Affectations et consommations de rouleaux sur les tâches de coupe.
 * Règles : aucun stock négatif, aucune double consommation, aucun
 * rouleau bloqué ou défectueux utilisé sans résolution préalable.
 */

const USABLE_STATUSES: RollStatus[] = ['disponible', 'en_utilisation'];

interface UsableRoll {
  id: number;
  code: string;
  status: RollStatus;
  remaining_weight_kg: number | null;
  initial_weight_kg: number;
}

/** Vérifie qu'un rouleau est utilisable et retourne ses données. */
export function requireUsableRoll(db: Database.Database, rollId: number): UsableRoll {
  const roll = db
    .prepare(
      'SELECT id, code, status, remaining_weight_kg, initial_weight_kg FROM coupe_rolls WHERE id = ?',
    )
    .get(rollId) as UsableRoll | undefined;
  if (!roll) {
    throw new ServiceError(`Rouleau ${rollId} introuvable.`, 400);
  }
  if (!USABLE_STATUSES.includes(roll.status)) {
    throw new ServiceError(
      `Le rouleau ${roll.code} est ${ROLL_STATUS_LABELS[roll.status].toLowerCase()} : il ne peut pas être utilisé tant que son statut n'est pas résolu.`,
      409,
    );
  }
  return roll;
}

/**
 * Affecte des rouleaux à une tâche (mouvement d'affectation historisé).
 * Un rouleau bloqué ou défectueux est refusé.
 */
export function setTaskRolls(
  actor: Actor,
  taskId: number,
  lotId: number,
  rollIds: number[],
): void {
  const db = sessionsDb();
  const apply = db.transaction(() => {
    const current = db
      .prepare('SELECT roll_id FROM coupe_task_rolls WHERE task_id = ?')
      .all(taskId) as Array<{ roll_id: number }>;
    const currentSet = new Set(current.map((row) => row.roll_id));
    const targetSet = new Set(rollIds);
    for (const removed of currentSet) {
      if (!targetSet.has(removed)) {
        db.prepare(
          'DELETE FROM coupe_task_rolls WHERE task_id = ? AND roll_id = ?',
        ).run(taskId, removed);
      }
    }
    for (const rollId of rollIds) {
      if (currentSet.has(rollId)) continue;
      const roll = requireUsableRoll(db, rollId);
      db.prepare(
        'INSERT INTO coupe_task_rolls (task_id, roll_id) VALUES (?, ?)',
      ).run(taskId, rollId);
      db.prepare(
        `INSERT INTO coupe_roll_movements
           (roll_id, movement_type, lot_id, task_id, reason, user_id)
         VALUES (?, 'affectation', ?, ?, 'Affectation à une tâche de coupe', ?)`,
      ).run(roll.id, lotId, taskId, actor.id);
      db.prepare(
        "UPDATE coupe_rolls SET status = 'en_utilisation', updated_at = datetime('now') WHERE id = ? AND status = 'disponible'",
      ).run(roll.id);
      addHistory(db, {
        action: 'ROLL_ASSIGNED',
        entityType: 'rouleau',
        entityId: roll.id,
        actorId: actor.id,
        newValue: { taskId, lotId },
      });
    }
  });
  apply();
}

export interface RollConsumption {
  rollId: number;
  weightUsed: number;
}

/**
 * Enregistre la consommation réelle de tissu d'une tâche, à chaque
 * saisie de résultats. Aucun stock négatif ni double consommation.
 */
export function recordRollConsumption(
  actor: Actor,
  taskId: number,
  lotId: number,
  consumptions: RollConsumption[],
): void {
  const db = sessionsDb();
  const apply = db.transaction(() => {
    for (const consumption of consumptions) {
      const roll = requireUsableRoll(db, consumption.rollId);
      if (!Number.isFinite(consumption.weightUsed) || consumption.weightUsed <= 0) {
        throw new ServiceError(
          `Consommation invalide pour le rouleau ${roll.code}.`,
          400,
        );
      }
      const remaining = roll.remaining_weight_kg ?? roll.initial_weight_kg;
      if (consumption.weightUsed > remaining + 1e-9) {
        throw new ServiceError(
          `Consommation refusée : le rouleau ${roll.code} ne dispose que de ${remaining.toFixed(2)} kg.`,
          409,
        );
      }
      const after = Math.max(0, remaining - consumption.weightUsed);
      const updated = db
        .prepare(
          `UPDATE coupe_rolls
           SET remaining_weight_kg = ?,
               status = CASE WHEN status = 'disponible' THEN 'en_utilisation' ELSE status END,
               updated_at = datetime('now')
           WHERE id = ? AND (remaining_weight_kg IS NULL OR remaining_weight_kg >= ?)`,
        )
        .run(after, roll.id, consumption.weightUsed);
      if (updated.changes === 0) {
        throw new ServiceError(
          `Consommation refusée pour le rouleau ${roll.code} (état modifié entre-temps).`,
          409,
        );
      }
      db.prepare(
        `INSERT INTO coupe_roll_movements
           (roll_id, movement_type, lot_id, task_id, weight_before, weight_after,
            qty, unit, reason, user_id)
         VALUES (?, 'consommation', ?, ?, ?, ?, ?, 'kg',
                 'Consommation sur tâche de coupe', ?)`,
      ).run(
        roll.id, lotId, taskId, remaining, after,
        consumption.weightUsed, actor.id,
      );
      db.prepare(
        'UPDATE coupe_task_rolls SET weight_used = ? WHERE task_id = ? AND roll_id = ?',
      ).run(consumption.weightUsed, taskId, roll.id);
      addHistory(db, {
        action: 'ROLL_CONSUMED',
        entityType: 'rouleau',
        entityId: roll.id,
        actorId: actor.id,
        newValue: {
          taskId,
          weightUsed: consumption.weightUsed,
          remaining: after,
        },
      });
    }
  });
  apply();
}
