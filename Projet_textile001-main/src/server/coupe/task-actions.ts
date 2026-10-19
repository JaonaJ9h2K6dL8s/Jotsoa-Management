import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { TaskDTO, TaskStatus } from '@/types/coupe';
import {
  addHistory,
  normalizeText,
  requireCoupe,
  requireId,
} from './common';
import { getTask, parseResults, type ResultInput } from './tasks';
import {
  recordRollConsumption,
  setTaskRolls,
  type RollConsumption,
} from './roll-usage';

/**
 * Actions d'exécution des tâches de coupe : transitions de statut,
 * saisie des résultats réels, corrections après validation et
 * validation par le responsable autorisé (auto-validation permise).
 */

interface TaskRow {
  id: number;
  lot_id: number;
  code: string;
  description: string;
  is_mandatory: number;
  requires_results: number;
  status: TaskStatus;
  responsable_id: number;
  validated_by: number | null;
  validated_at: string | null;
}

function loadTask(db: ReturnType<typeof sessionsDb>, id: number): TaskRow {
  const row = db.prepare('SELECT * FROM coupe_tasks WHERE id = ?').get(id) as
    | TaskRow
    | undefined;
  if (!row) throw new ServiceError('Tâche introuvable.', 404);
  return row;
}

function assertLotEditable(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): void {
  const lot = db
    .prepare('SELECT status FROM coupe_lots WHERE id = ?')
    .get(lotId) as { status: string } | undefined;
  if (!lot) throw new ServiceError('Lot introuvable.', 404);
  if (lot.status === 'transfere' || lot.status === 'annule') {
    throw new ServiceError(
      'Ce lot est transféré ou annulé : ses tâches ne sont plus modifiables.',
      409,
    );
  }
}

export function patchTask(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): TaskDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant de la tâche');
  const db = sessionsDb();
  const task = loadTask(db, id);
  assertLotEditable(db, task.lot_id);
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  const apply = db.transaction(() => {
    if (action === 'start') {
      if (!['a_faire', 'en_attente', 'a_verifier'].includes(task.status)) {
        throw new ServiceError(
          'Seule une tâche à faire, en attente ou à vérifier peut démarrer.',
          409,
        );
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'en_cours', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'finish') {
      if (task.status !== 'en_cours') {
        throw new ServiceError(
          'Seule une tâche en cours peut être terminée.', 409,
        );
      }
      if (task.requires_results === 1) {
        const count = db
          .prepare('SELECT COUNT(*) AS n FROM coupe_results WHERE task_id = ?')
          .get(id) as { n: number };
        if (count.n === 0) {
          throw new ServiceError(
            'Les résultats réels doivent être saisis avant de terminer la tâche.',
            400,
          );
        }
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'terminee', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'set_attente') {
      if (!['a_faire', 'en_cours'].includes(task.status)) {
        throw new ServiceError(
          'Seule une tâche à faire ou en cours peut être mise en attente.', 409,
        );
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'en_attente', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'block') {
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour bloquer une tâche.', 400,
        );
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'bloquee', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'unblock') {
      if (task.status !== 'bloquee') {
        throw new ServiceError('Cette tâche n’est pas bloquée.', 409);
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'a_faire', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'cancel') {
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour annuler une tâche.', 400,
        );
      }
      if (task.status === 'validee') {
        throw new ServiceError(
          'Une tâche validée ne peut pas être annulée : corrigez le résultat.', 409,
        );
      }
      db.prepare(
        "UPDATE coupe_tasks SET status = 'annulee', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'set_observations') {
      const observations = normalizeText(input.observations, 500);
      db.prepare(
        "UPDATE coupe_tasks SET observations = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(observations, id);
    } else if (action === 'set_rolls') {
      const rollIds = Array.isArray(input.rollIds)
        ? input.rollIds.map((value) => requireId(value, 'Rouleau'))
        : [];
      setTaskRolls(actor, id, task.lot_id, rollIds);
    } else {
      throw new ServiceError('Action inconnue sur la tâche.', 400);
    }
    if (action !== 'set_observations' && action !== 'set_rolls') {
      addHistory(db, {
        action: `TASK_${action.toUpperCase()}`,
        entityType: 'tache',
        entityId: id,
        actorId: actor.id,
        oldValue: { status: task.status },
        reason,
      });
    }
  });
  apply();
  return getTask(actor, id);
}

function upsertResults(
  db: ReturnType<typeof sessionsDb>,
  taskId: number,
  lotId: number,
  actorId: number | null,
  results: ResultInput[],
): void {
  for (const row of results) {
    db.prepare(
      `INSERT INTO coupe_results
         (task_id, lot_id, size_id, planned_qty, cut_qty, usable_qty,
          anomaly_qty, waste_qty, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_id, size_id) DO UPDATE SET
         planned_qty = excluded.planned_qty,
         cut_qty = excluded.cut_qty,
         usable_qty = excluded.usable_qty,
         anomaly_qty = excluded.anomaly_qty,
         waste_qty = excluded.waste_qty,
         updated_at = datetime('now')`,
    ).run(
      taskId, lotId, row.sizeId, row.plannedQty, row.cutQty,
      row.usableQty, row.anomalyQty, row.wasteQty, actorId,
    );
  }
}

/**
 * Saisie (ou correction) des résultats réels par taille.
 * Une correction sur une tâche validée conserve les anciennes valeurs
 * dans l'historique et invalide l'approbation précédente : une nouvelle
 * validation est ensuite requise.
 */
export function setTaskResults(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): TaskDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant de la tâche');
  const db = sessionsDb();
  const task = loadTask(db, id);
  assertLotEditable(db, task.lot_id);
  if (!['a_faire', 'en_cours', 'terminee', 'validee', 'a_verifier'].includes(task.status)) {
    throw new ServiceError(
      'Les résultats ne peuvent être saisis que sur une tâche active ou terminée.',
      409,
    );
  }
  const results = parseResults(db, task.lot_id, input.results);
  if (db.prepare('SELECT id FROM marker_plans WHERE result_task_id = ?').get(id)) {
    throw new ServiceError('Résultats liés à un plan et à ses composants : correction isolée interdite pour préserver la traçabilité.', 409);
  }
  const reason = normalizeText(input.reason, 300);
  const wasValidated = task.status === 'validee';
  if (wasValidated && !reason) {
    throw new ServiceError(
      'Un motif est obligatoire pour corriger un résultat déjà validé.',
      400,
    );
  }
  const consumptions: RollConsumption[] = Array.isArray(input.consumptions)
    ? (input.consumptions as Array<Record<string, unknown>>).map((entry) => ({
        rollId: requireId(entry.rollId, 'Rouleau'),
        weightUsed: Number(String(entry.weightUsed ?? '').replace(',', '.')),
      }))
    : [];
  const apply = db.transaction(() => {
    if (wasValidated) {
      const oldResults = db
        .prepare('SELECT * FROM coupe_results WHERE task_id = ?')
        .all(id);
      addHistory(db, {
        action: 'TASK_RESULTS_CORRECTED',
        entityType: 'tache',
        entityId: id,
        actorId: actor.id,
        oldValue: oldResults,
        newValue: results,
        reason,
      });
      db.prepare(
        "UPDATE coupe_tasks SET status = 'terminee', validated_by = NULL, validated_at = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    }
    upsertResults(db, id, task.lot_id, actor.id, results);
    if (task.status === 'a_faire') {
      db.prepare(
        "UPDATE coupe_tasks SET status = 'en_cours', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    }
    // La consommation fait partie de la même transaction : un refus
    // annule aussi la saisie des résultats (aucune écriture partielle).
    if (consumptions.length > 0) {
      recordRollConsumption(actor, id, task.lot_id, consumptions);
    }
    addHistory(db, {
      action: wasValidated ? 'TASK_CORRECTION' : 'TASK_RESULTS_SAVED',
      entityType: 'tache',
      entityId: id,
      actorId: actor.id,
      newValue: { results },
      reason,
    });
  });
  apply();
  return getTask(actor, id);
}

/** Validation par le responsable autorisé (l'exécutant peut se valider). */
export function validateTask(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): TaskDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant de la tâche');
  const db = sessionsDb();
  const task = loadTask(db, id);
  assertLotEditable(db, task.lot_id);
  if (!['terminee', 'a_verifier'].includes(task.status)) {
    throw new ServiceError(
      'Seule une tâche terminée peut être validée.', 409,
    );
  }
  if (task.requires_results === 1) {
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM coupe_results WHERE task_id = ?')
      .get(id) as { n: number };
    if (count.n === 0) {
      throw new ServiceError(
        'Validation refusée : les résultats obligatoires sont absents.',
        400,
      );
    }
  }
  const notes = normalizeText(input.notes, 300);
  const apply = db.transaction(() => {
    db.prepare(
      "UPDATE coupe_tasks SET status = 'validee', validated_by = ?, validated_at = datetime('now'), validation_notes = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(actor.id, notes, id);
    addHistory(db, {
      action: 'TASK_VALIDATED',
      entityType: 'tache',
      entityId: id,
      actorId: actor.id,
      newValue: { notes, autoValidation: actor.id === task.responsable_id || undefined },
    });
  });
  apply();
  return getTask(actor, id);
}

/** Refus de validation : la tâche passe « à vérifier » avec un motif. */
export function refuseTask(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): TaskDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant de la tâche');
  const db = sessionsDb();
  const task = loadTask(db, id);
  assertLotEditable(db, task.lot_id);
  if (!['terminee', 'a_verifier'].includes(task.status)) {
    throw new ServiceError(
      'Le refus s’applique uniquement à une tâche terminée.', 409,
    );
  }
  const reason = normalizeText(input.reason, 300);
  if (!reason) {
    throw new ServiceError('Un motif est obligatoire pour refuser une validation.', 400);
  }
  const apply = db.transaction(() => {
    db.prepare(
      "UPDATE coupe_tasks SET status = 'a_verifier', validated_by = NULL, validated_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    addHistory(db, {
      action: 'TASK_VALIDATION_REFUSED',
      entityType: 'tache',
      entityId: id,
      actorId: actor.id,
      oldValue: { status: task.status },
      reason,
    });
  });
  apply();
  return getTask(actor, id);
}
