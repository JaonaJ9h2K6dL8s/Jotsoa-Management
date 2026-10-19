import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { IncidentDTO, IncidentSeverity, IncidentStatus } from '@/types/couture';
import { INCIDENT_TYPE_OPTIONS } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  normalizeText,
  requireCouture,
  requireId,
  setLotStatus,
} from './common';

/**
 * Interruptions et anomalies de production. Une anomalie critique
 * bloque l'affectation concernée et déclenche une alerte critique ;
 * sa clôture exige une résolution enregistrée par un utilisateur
 * autorisé.
 */

interface IncidentRow {
  id: number;
  lot_id: number | null;
  assignment_id: number | null;
  room_id: number | null;
  line_id: number | null;
  incident_type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  started_at: string;
  ended_at: string | null;
  resolution_note: string | null;
  declared_by: number;
  lot_code: string | null;
  assignment_code: string | null;
  room_nom: string | null;
  line_nom: string | null;
  declared_by_name: string | null;
}

const INCIDENT_SELECT = `
  SELECT i.*, l.code AS lot_code, a.code AS assignment_code,
         r.nom AS room_nom, li.nom AS line_nom,
         u.nom || ' ' || u.prenom AS declared_by_name
  FROM couture_incidents i
  LEFT JOIN coupe_lots l ON l.id = i.lot_id
  LEFT JOIN couture_assignments a ON a.id = i.assignment_id
  LEFT JOIN sewing_rooms r ON r.id = i.room_id
  LEFT JOIN sewing_lines li ON li.id = i.line_id
  JOIN users u ON u.id = i.declared_by`;

function mapIncident(row: IncidentRow): IncidentDTO {
  return {
    id: row.id,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    assignmentId: row.assignment_id,
    assignmentCode: row.assignment_code,
    roomNom: row.room_nom,
    lineNom: row.line_nom,
    incidentType: row.incident_type,
    severity: row.severity,
    status: row.status,
    description: row.description,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    resolutionNote: row.resolution_note,
    declaredByName: row.declared_by_name,
  };
}

export function listIncidents(
  actor: Actor,
  filters: { status?: string; severity?: string; lotId?: string } = {},
): IncidentDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('i.status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    clauses.push('i.severity = ?');
    params.push(filters.severity);
  }
  if (filters.lotId && Number.isInteger(Number(filters.lotId))) {
    clauses.push('i.lot_id = ?');
    params.push(Number(filters.lotId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${INCIDENT_SELECT} ${where} ORDER BY i.id DESC LIMIT 300`)
    .all(...params) as IncidentRow[];
  return rows.map(mapIncident);
}

export function createIncident(
  actor: Actor,
  input: Record<string, unknown>,
): IncidentDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const incidentType = String(input.incidentType ?? '');
  if (!(INCIDENT_TYPE_OPTIONS as readonly string[]).includes(incidentType)) {
    throw new ServiceError('Type d’incident inconnu.', 400);
  }
  const severity = String(input.severity ?? '');
  if (!['mineure', 'majeure', 'critique'].includes(severity)) {
    throw new ServiceError('Gravité invalide.', 400);
  }
  const description = normalizeText(input.description, 1000);
  if (!description) {
    throw new ServiceError('Une description est obligatoire.', 400);
  }
  const assignmentId =
    input.assignmentId === null || input.assignmentId === undefined
      ? null
      : requireId(input.assignmentId, 'Affectation');
  let lotId: number | null =
    input.lotId === null || input.lotId === undefined
      ? null
      : requireId(input.lotId, 'Lot');
  let roomId: number | null =
    input.roomId === null || input.roomId === undefined
      ? null
      : requireId(input.roomId, 'Salle');
  let lineId: number | null =
    input.lineId === null || input.lineId === undefined
      ? null
      : requireId(input.lineId, 'Ligne');
  if (assignmentId) {
    const assignment = db
      .prepare(
        'SELECT lot_id, room_id, line_id FROM couture_assignments WHERE id = ?',
      )
      .get(assignmentId) as
      | { lot_id: number; room_id: number; line_id: number }
      | undefined;
    if (!assignment) throw new ServiceError('Affectation introuvable.', 404);
    lotId = assignment.lot_id;
    roomId = assignment.room_id;
    lineId = assignment.line_id;
  }
  const insert = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO couture_incidents
           (lot_id, assignment_id, room_id, line_id, incident_type, severity, description, declared_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(lotId, assignmentId, roomId, lineId, incidentType, severity, description, actor.id);
    const incidentId = Number(result.lastInsertRowid);
    if (severity === 'critique') {
      raiseAlert(db, {
        category: 'INCIDENT_CRITIQUE',
        severity: 'critical',
        objectType: 'incident',
        objectId: incidentId,
        message: `Anomalie critique déclarée : ${description}`,
        ownerRole: 'chef_couture',
      });
      if (assignmentId) {
        const status = db
          .prepare('SELECT status FROM couture_assignments WHERE id = ?')
          .get(assignmentId) as { status: string } | undefined;
        if (status && !['terminee', 'annulee', 'bloquee'].includes(status.status)) {
          db.prepare(
            "UPDATE couture_assignments SET status = 'bloquee', updated_at = datetime('now') WHERE id = ?",
          ).run(assignmentId);
          if (lotId) setLotStatus(db, lotId, 'bloque');
          addHistory(db, {
            action: 'ASSIGNMENT_BLOCKED_BY_INCIDENT',
            entityType: 'affectation',
            entityId: assignmentId,
            actorId: actor.id,
            oldValue: { status: status.status },
            newValue: { status: 'bloquee', incidentId },
          });
        }
      }
    }
    addHistory(db, {
      action: 'INCIDENT_CREATED',
      entityType: 'incident',
      entityId: incidentId,
      actorId: actor.id,
      newValue: { incidentType, severity, lotId, assignmentId, description },
    });
    return incidentId;
  });
  const incidentId = insert();
  const row = db
    .prepare(`${INCIDENT_SELECT} WHERE i.id = ?`)
    .get(incidentId) as IncidentRow;
  return mapIncident(row);
}

/** Transitions contrôlées : démarrage, résolution, clôture. */
export function patchIncident(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): IncidentDTO {
  requireCouture(actor);
  const id = requireId(rawId, 'Incident');
  const db = sessionsDb();
  const row = db
    .prepare(`${INCIDENT_SELECT} WHERE i.id = ?`)
    .get(id) as IncidentRow | undefined;
  if (!row) throw new ServiceError('Incident introuvable.', 404);
  const action = String(input.action ?? '');
  const note = normalizeText(input.note, 500);
  if (action === 'start') {
    if (row.status !== 'ouverte') {
      throw new ServiceError('Seul un incident ouvert peut passer en cours.', 409);
    }
    db.prepare(
      "UPDATE couture_incidents SET status = 'en_cours' WHERE id = ?",
    ).run(id);
  } else if (action === 'resolve') {
    if (!['ouverte', 'en_cours'].includes(row.status)) {
      throw new ServiceError('Cet incident n’est plus ouvert.', 409);
    }
    if (!note) {
      throw new ServiceError(
        'Un commentaire de résolution est obligatoire pour résoudre un incident.',
        400,
      );
    }
    db.prepare(
      `UPDATE couture_incidents
       SET status = 'resolue', ended_at = datetime('now'), resolution_note = ?
       WHERE id = ?`,
    ).run(note, id);
  } else if (action === 'close') {
    if (row.status !== 'resolue') {
      throw new ServiceError('Seul un incident résolu peut être clôturé.', 409);
    }
    db.prepare(
      "UPDATE couture_incidents SET status = 'cloturee' WHERE id = ?",
    ).run(id);
  } else {
    throw new ServiceError('Action inconnue sur l’incident.', 400);
  }
  addHistory(db, {
    action: `INCIDENT_${action.toUpperCase()}`,
    entityType: 'incident',
    entityId: id,
    actorId: actor.id,
    oldValue: { status: row.status },
    reason: note,
  });
  const updated = db
    .prepare(`${INCIDENT_SELECT} WHERE i.id = ?`)
    .get(id) as IncidentRow;
  return mapIncident(updated);
}
