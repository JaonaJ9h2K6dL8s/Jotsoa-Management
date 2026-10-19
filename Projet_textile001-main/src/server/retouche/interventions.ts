import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtInterventionDTO } from '@/types/retouche';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireId,
  requireRetouche,
  toNumber,
} from './common';

/**
 * Interventions de retouche. Seul le retoucheur affecté enregistre
 * ses interventions réelles. Les quantités traitées cumulées ne
 * peuvent jamais dépasser la quantité affectée pour la demande.
 * Une intervention terminée ne signifie pas que la pièce est conforme :
 * le Contrôle qualité reste décisionnaire.
 */

function mapIntervention(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    assignment_id: number;
    assignment_code: string;
    request_code: string;
    retoucheur_nom: string;
    status: 'en_cours' | 'terminee' | 'annulee';
    action: string | null;
    notes: string | null;
    started_at: string;
    ended_at: string | null;
  },
): RtInterventionDTO {
  const lines = db
    .prepare(
      `SELECT il.size_id, s.nom AS size_label, il.processed_qty, il.result
       FROM rt_intervention_lines il
       JOIN sizes s ON s.id = il.size_id
       WHERE il.intervention_id = ?
       ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{
    size_id: number;
    size_label: string;
    processed_qty: number;
    result: 'repare' | 'irreparable' | 'partiel';
  }>;
  return {
    id: row.id,
    code: row.code,
    assignmentId: row.assignment_id,
    assignmentCode: row.assignment_code,
    requestCode: row.request_code,
    retoucheurNom: row.retoucheur_nom,
    status: row.status,
    action: row.action,
    notes: row.notes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      processedQty: line.processed_qty,
      result: line.result,
    })),
  };
}

const INTERVENTION_SELECT = `
  SELECT i.*, a.code AS assignment_code, r.code AS request_code,
         u.nom || ' ' || u.prenom AS retoucheur_nom
  FROM rt_interventions i
  JOIN rt_assignments a ON a.id = i.assignment_id
  JOIN cq_rework_requests r ON r.id = a.request_id
  JOIN users u ON u.id = i.retoucheur_id`;

export function listInterventions(actor: Actor): RtInterventionDTO[] {
  requireRetouche(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${INTERVENTION_SELECT} ORDER BY i.id DESC`).all() as never[]
  ).map((row) => mapIntervention(db, row));
}

/** Démarre une intervention sur une affectation (le retoucheur affecté uniquement). */
export function startIntervention(
  actor: Actor,
  input: Record<string, unknown>,
): RtInterventionDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const assignmentId = requireId(input.assignmentId, 'Affectation');
  const action = normalizeText(input.action, 300);
  const run = db.transaction((): number => {
    const assignment = db
      .prepare('SELECT id, retoucheur_id, status, request_id FROM rt_assignments WHERE id = ?')
      .get(assignmentId) as
      | { id: number; retoucheur_id: number; status: string; request_id: number }
      | undefined;
    if (!assignment) throw new ServiceError('Affectation introuvable.', 404);
    if (assignment.retoucheur_id !== actor.id) {
      throw new ServiceError(
        'Seul le retoucheur affecté peut démarrer cette intervention.',
        403,
      );
    }
    if (!['affectee', 'en_cours'].includes(assignment.status)) {
      throw new ServiceError(
        'Cette affectation n’accepte plus de nouvelle intervention.',
        409,
      );
    }
    const code = nextCode(db, 'rt_interventions', 'IV-');
    const result = db
      .prepare(
        `INSERT INTO rt_interventions (code, assignment_id, retoucheur_id, action)
         VALUES (?, ?, ?, ?)`,
      )
      .run(code, assignmentId, actor.id, action);
    const interventionId = Number(result.lastInsertRowid);
    db.prepare("UPDATE rt_assignments SET status = 'en_cours' WHERE id = ?").run(
      assignmentId,
    );
    addHistory(db, {
      action: 'INTERVENTION_DEMARREE',
      entityType: 'rt_intervention',
      entityId: interventionId,
      actorId: actor.id,
      newValue: { code, assignmentId },
    });
    return interventionId;
  });
  const interventionId = run();
  const row = db
    .prepare(`${INTERVENTION_SELECT} WHERE i.id = ?`)
    .get(interventionId) as never;
  return mapIntervention(db, row);
}

/**
 * Termine une intervention : quantités traitées par taille avec
 * résultat. Cumul vérifié contre la quantité affectée ; transaction
 * SQLite, aucune écriture partielle en cas d'échec.
 */
export function finishIntervention(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): RtInterventionDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const interventionId = requireId(rawId, 'Intervention');
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité traitée fournie.', 400);
  }
  const run = db.transaction((): void => {
    const intervention = db
      .prepare(
        `SELECT i.id, i.assignment_id, i.retoucheur_id, i.status, a.request_id
         FROM rt_interventions i
         JOIN rt_assignments a ON a.id = i.assignment_id
         WHERE i.id = ?`,
      )
      .get(interventionId) as
      | { id: number; assignment_id: number; retoucheur_id: number; status: string; request_id: number }
      | undefined;
    if (!intervention) throw new ServiceError('Intervention introuvable.', 404);
    if (intervention.retoucheur_id !== actor.id) {
      throw new ServiceError(
        'Seul le retoucheur affecté peut terminer cette intervention.',
        403,
      );
    }
    if (intervention.status !== 'en_cours') {
      throw new ServiceError('Cette intervention est déjà terminée.', 409);
    }
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const processed = toNumber(record.processedQty, 'La quantité traitée');
      const result = String(record.result ?? '');
      if (!['repare', 'irreparable', 'partiel'].includes(result)) {
        throw new ServiceError('Résultat d’intervention inconnu.', 400);
      }
      if (processed < 0) {
        throw new ServiceError('La quantité traitée ne peut pas être négative.', 400);
      }
      const assigned = db
        .prepare(
          `SELECT COALESCE(SUM(al.qty), 0) AS qty FROM rt_assignment_lines al
           WHERE al.assignment_id = ? AND al.size_id = ?`,
        )
        .get(intervention.assignment_id, sizeId) as { qty: number };
      if (assigned.qty === 0) {
        throw new ServiceError(
          'Cette taille n’est pas affectée dans cette tâche.',
          400,
        );
      }
      const alreadyProcessed = db
        .prepare(
          `SELECT COALESCE(SUM(il.processed_qty), 0) AS qty
           FROM rt_intervention_lines il
           JOIN rt_interventions i ON i.id = il.intervention_id
           JOIN rt_assignments a ON a.id = i.assignment_id
           WHERE a.request_id = ? AND il.size_id = ? AND i.status = 'terminee'`,
        )
        .get(intervention.request_id, sizeId) as { qty: number };
      if (alreadyProcessed.qty + processed > assigned.qty) {
        throw new ServiceError(
          `Cumul traité (${alreadyProcessed.qty} + ${processed}) supérieur à la quantité affectée (${assigned.qty}) en taille ${sizeId}.`,
          409,
        );
      }
      db.prepare(
        `INSERT INTO rt_intervention_lines
           (intervention_id, size_id, processed_qty, result)
         VALUES (?, ?, ?, ?)`,
      ).run(interventionId, sizeId, processed, result);
    }
    db.prepare(
      `UPDATE rt_interventions
       SET status = 'terminee', ended_at = datetime('now'), notes = ?
       WHERE id = ?`,
    ).run(notes, interventionId);
    const remaining = db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(qty), 0) FROM rt_assignment_lines WHERE assignment_id = ?) AS assigned,
           (SELECT COALESCE(SUM(il.processed_qty), 0)
              FROM rt_intervention_lines il
              JOIN rt_interventions i ON i.id = il.intervention_id
              WHERE i.assignment_id = ? AND i.status = 'terminee') AS processed`,
      )
      .get(intervention.assignment_id, intervention.assignment_id) as {
      assigned: number;
      processed: number;
    };
    if (remaining.processed >= remaining.assigned) {
      db.prepare("UPDATE rt_assignments SET status = 'terminee' WHERE id = ?").run(
        intervention.assignment_id,
      );
    }
    addHistory(db, {
      action: 'INTERVENTION_TERMINEE',
      entityType: 'rt_intervention',
      entityId: interventionId,
      actorId: actor.id,
      newValue: { lines: rawLines },
      reason: notes,
    });
  });
  run();
  const row = db
    .prepare(`${INTERVENTION_SELECT} WHERE i.id = ?`)
    .get(interventionId) as never;
  return mapIntervention(db, row);
}
