import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { TaskDTO, TaskStatus } from '@/types/coupe';
import { validateResultsRow } from '@/lib/coupe-validation';
import {
  addHistory,
  normalizeText,
  nextCode,
  requireCoupe,
  requireId,
} from './common';
import { getTaskDTOs } from './lot-queries';
import { setTaskRolls } from './roll-usage';

/**
 * Tâches de coupe : exécution, saisie des résultats réels (en pièces),
 * corrections après validation et validation par le responsable autorisé.
 * La validation par l'exécutant lui-même est autorisée (règle métier),
 * mais uniquement pour un utilisateur disposant du rôle requis côté serveur.
 */

interface TaskDbRow {
  id: number;
  lot_id: number;
  code: string;
  description: string;
  is_mandatory: number;
  requires_results: number;
  status: TaskStatus;
  responsable_id: number;
  observations: string | null;
  started_at: string | null;
  finished_at: string | null;
  validated_by: number | null;
  validated_at: string | null;
  validation_notes: string | null;
}

function getTaskRow(db: ReturnType<typeof sessionsDb>, id: number): TaskDbRow {
  const row = db.prepare('SELECT * FROM coupe_tasks WHERE id = ?').get(id) as
    | TaskDbRow
    | undefined;
  if (!row) throw new ServiceError('Tâche introuvable.', 404);
  return row;
}

export function getTask(actor: Actor, rawId: unknown): TaskDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant de la tâche');
  const db = sessionsDb();
  const row = getTaskRow(db, id);
  const task = getTaskDTOs(db, row.lot_id).find((item) => item.id === id);
  if (!task) throw new ServiceError('Tâche introuvable.', 404);
  return task;
}

export interface ResultInput {
  sizeId: number;
  plannedQty: number;
  cutQty: number;
  usableQty: number;
  anomalyQty: number;
  wasteQty: number;
}

function toNumber(raw: unknown): number {
  return Number(String(raw ?? 0).replace(',', '.'));
}

export function parseResults(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
  raw: unknown,
): ResultInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ServiceError('Aucun résultat fourni.', 400);
  }
  const lotSizes = new Map(
    (
      db
        .prepare(
          'SELECT size_id, planned_qty FROM coupe_lot_sizes WHERE lot_id = ?',
        )
        .all(lotId) as Array<{ size_id: number; planned_qty: number }>
    ).map((row) => [row.size_id, row.planned_qty]),
  );
  const seen = new Set<number>();
  const results: ResultInput[] = [];
  for (const entry of raw) {
    const record = entry as Record<string, unknown>;
    const sizeId = requireId(record.sizeId, 'Taille');
    const plannedQty = lotSizes.get(sizeId);
    if (plannedQty === undefined) {
      throw new ServiceError(
        'Une taille fournie ne fait pas partie des tailles du lot.',
        400,
      );
    }
    if (seen.has(sizeId)) {
      throw new ServiceError(
        'Chaque taille ne peut apparaître qu’une fois.',
        400,
      );
    }
    seen.add(sizeId);
    const error = validateResultsRow(record as {
      cutQty: unknown;
      usableQty: unknown;
      anomalyQty: unknown;
      wasteQty: unknown;
    });
    if (error) throw new ServiceError(error, 400);
    results.push({
      sizeId,
      plannedQty,
      cutQty: toNumber(record.cutQty),
      usableQty: toNumber(record.usableQty),
      anomalyQty: toNumber(record.anomalyQty),
      wasteQty: toNumber(record.wasteQty),
    });
  }
  return results;
}

export function createTask(
  actor: Actor,
  input: Record<string, unknown>,
): TaskDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const lotId = requireId(input.lotId, 'Lot');
  const lot = db
    .prepare('SELECT id, status FROM coupe_lots WHERE id = ?')
    .get(lotId) as { id: number; status: string } | undefined;
  if (!lot) throw new ServiceError('Lot introuvable.', 404);
  if (lot.status === 'transfere' || lot.status === 'annule') {
    throw new ServiceError(
      'Aucune tâche ne peut être ajoutée à un lot transféré ou annulé.',
      409,
    );
  }
  const description = normalizeText(input.description, 300);
  if (!description) {
    throw new ServiceError('La description de la tâche est requise.', 400);
  }
  const isMandatory = input.isMandatory === false ? 0 : 1;
  const requiresResults = input.requiresResults === false ? 0 : 1;
  const observations = normalizeText(input.observations, 500);
  const rollIds = Array.isArray(input.rollIds)
    ? input.rollIds.map((value) => requireId(value, 'Rouleau'))
    : [];
  const insert = db.transaction(() => {
    const code = nextCode(db, 'coupe_tasks', 'TC-');
    const result = db
      .prepare(
        `INSERT INTO coupe_tasks
           (lot_id, code, description, is_mandatory, requires_results,
            responsable_id, observations)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lotId, code, description, isMandatory, requiresResults,
        actor.id, observations,
      );
    const taskId = Number(result.lastInsertRowid);
    addHistory(db, {
      action: 'TASK_CREATED',
      entityType: 'tache',
      entityId: taskId,
      actorId: actor.id,
      newValue: {
        code, lotId, description, isMandatory: isMandatory === 1,
      },
    });
    return taskId;
  });
  const taskId = insert();
  if (rollIds.length > 0) {
    setTaskRolls(actor, taskId, lotId, rollIds);
  }
  return getTask(actor, taskId);
}
