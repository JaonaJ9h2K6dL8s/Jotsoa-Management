import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { AssignmentDTO, AssignmentStatus } from '@/types/couture';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  getLotStatus,
  nextCode,
  normalizeText,
  requireCouture,
  requireId,
  setLotStatus,
  toNumber,
} from './common';
import { getSizeBalances } from './balances';

/**
 * Affectation des lots reçus aux salles et lignes de couture.
 * La somme des affectations ne peut jamais dépasser les quantités
 * réellement disponibles (reçues − contestées − déjà affectées).
 */

interface AssignmentRow {
  id: number;
  code: string;
  lot_id: number;
  room_id: number;
  line_id: number;
  responsable_id: number;
  status: AssignmentStatus;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  worked_seconds: number;
  updated_at: string;
  room_nom: string;
  line_nom: string;
  lot_code: string;
  product_nom: string;
  color_nom: string;
  responsable_nom: string | null;
}

const ASSIGNMENT_SELECT = `
  SELECT a.*, r.nom AS room_nom, li.nom AS line_nom, l.code AS lot_code,
         p.nom AS product_nom, c.nom AS color_nom,
         u.nom || ' ' || u.prenom AS responsable_nom
  FROM couture_assignments a
  JOIN sewing_rooms r ON r.id = a.room_id
  JOIN sewing_lines li ON li.id = a.line_id
  JOIN coupe_lots l ON l.id = a.lot_id
  JOIN products p ON p.id = l.product_id
  JOIN colors c ON c.id = l.color_id
  JOIN users u ON u.id = a.responsable_id`;

function mapAssignment(
  db: ReturnType<typeof sessionsDb>,
  row: AssignmentRow,
): AssignmentDTO {
  const sewnBySize = new Map<number, number>(
    (
      db
        .prepare(
          `SELECT size_id, COALESCE(SUM(qty), 0) AS sewn FROM couture_productions
           WHERE assignment_id = ? AND status != 'annulee' GROUP BY size_id`,
        )
        .all(row.id) as Array<{ size_id: number; sewn: number }>
    ).map((item) => [item.size_id, item.sewn]),
  );
  return {
    id: row.id,
    code: row.code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    roomId: row.room_id,
    roomNom: row.room_nom,
    lineId: row.line_id,
    lineNom: row.line_nom,
    responsableId: row.responsable_id,
    responsableNom: row.responsable_nom,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    workedSeconds: row.worked_seconds,
    updatedAt: row.updated_at,
    sizes: (
      db
        .prepare(
          `SELECT asz.size_id, s.nom AS size_label, asz.planned_qty
           FROM couture_assignment_sizes asz
           JOIN sizes s ON s.id = asz.size_id
           WHERE asz.assignment_id = ? ORDER BY s.display_order, s.id`,
        )
        .all(row.id) as Array<{ size_id: number; size_label: string; planned_qty: number }>
    ).map((size) => ({
      sizeId: size.size_id,
      sizeLabel: size.size_label,
      plannedQty: size.planned_qty,
      sewnQty: sewnBySize.get(size.size_id) ?? 0,
    })),
  };
}

export function listAssignments(
  actor: Actor,
  filters: { lotId?: string; status?: string } = {},
): AssignmentDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.lotId && Number.isInteger(Number(filters.lotId))) {
    clauses.push('a.lot_id = ?');
    params.push(Number(filters.lotId));
  }
  if (filters.status) {
    clauses.push('a.status = ?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${ASSIGNMENT_SELECT} ${where} ORDER BY a.id DESC`)
    .all(...params) as AssignmentRow[];
  return rows.map((row) => mapAssignment(db, row));
}

export function getAssignment(actor: Actor, rawId: unknown): AssignmentDTO {
  requireCouture(actor);
  const id = requireId(rawId, 'Affectation');
  const db = sessionsDb();
  const row = db
    .prepare(`${ASSIGNMENT_SELECT} WHERE a.id = ?`)
    .get(id) as AssignmentRow | undefined;
  if (!row) throw new ServiceError('Affectation introuvable.', 404);
  return mapAssignment(sessionsDb(), row);
}

/** Vérifie salle/ligne actives et cohérence salle↔ligne. */
function requireActiveLine(
  db: ReturnType<typeof sessionsDb>,
  roomId: number,
  lineId: number,
): void {
  const line = db
    .prepare(
      `SELECT li.id, li.is_active, li.room_id, r.is_active AS room_active
       FROM sewing_lines li JOIN sewing_rooms r ON r.id = li.room_id
       WHERE li.id = ?`,
    )
    .get(lineId) as
    | { id: number; is_active: number; room_id: number; room_active: number }
    | undefined;
  if (!line || !line.is_active || !line.room_active) {
    throw new ServiceError(
      'La ligne choisie est inexistante ou désactivée : aucune nouvelle affectation possible.',
      400,
    );
  }
  if (line.room_id !== roomId) {
    throw new ServiceError(
      'La ligne choisie n’appartient pas à la salle indiquée.',
      400,
    );
  }
}

export function createAssignment(
  actor: Actor,
  input: Record<string, unknown>,
): AssignmentDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const lotId = requireId(input.lotId, 'Lot');
  const roomId = requireId(input.roomId, 'Salle');
  const lineId = requireId(input.lineId, 'Ligne');
  const status = getLotStatus(db, lotId);
  if (!['a_affecter', 'reception_partielle', 'affecte', 'en_cours'].includes(status ?? '')) {
    throw new ServiceError(
      'Ce lot n’a pas de réception couture exploitable : réceptionnez d’abord un transfert Coupe confirmé.',
      409,
    );
  }
  requireActiveLine(db, roomId, lineId);
  const rawSizes = Array.isArray(input.sizes) ? input.sizes : [];
  if (rawSizes.length === 0) {
    throw new ServiceError('Au moins une taille avec une quantité est requise.', 400);
  }
  const plannedBySize = new Map<number, number>();
  for (const entry of rawSizes) {
    const record = entry as Record<string, unknown>;
    const sizeId = requireId(record.sizeId, 'Taille');
    const qty = toNumber(record.plannedQty, 'La quantité prévue');
    if (qty <= 0) {
      throw new ServiceError('Chaque quantité prévue doit être supérieure à 0.', 400);
    }
    if (plannedBySize.has(sizeId)) {
      throw new ServiceError('Chaque taille ne peut apparaître qu’une fois.', 400);
    }
    plannedBySize.set(sizeId, qty);
  }
  const notes = normalizeText(input.notes, 500);
  // Pré-validation hors transaction : l'alerte doit survivre au refus
  // (une transaction annulée effacerait une alerte écrite à l'intérieur).
  const balances = getSizeBalances(db, lotId);
  for (const [sizeId, qty] of plannedBySize.entries()) {
    const size = balances.find((item) => item.sizeId === sizeId);
    if (!size) {
      throw new ServiceError(
        'Une taille saisie ne correspond à aucune pièce reçue pour ce lot.',
        400,
      );
    }
    const available = Math.max(0, size.received - size.contested - size.assigned);
    if (qty > available) {
      raiseAlert(db, {
        category: 'AFFECTATION_EXCEDENT',
        severity: 'warning',
        objectType: 'lot_couture',
        objectId: lotId,
        message: `Tentative d'affectation de ${qty} pièce(s) en taille ${sizeId} alors que le solde disponible est de ${available}.`,
        ownerRole: 'chef_couture',
      });
      throw new ServiceError(
        `Affectation refusée : disponible en taille ${sizeId} = ${available} pièce(s) (reçu − contesté − déjà affecté).`,
        409,
      );
    }
  }
  const insert = db.transaction((): number => {
    const balancesInTx = getSizeBalances(db, lotId);
    for (const [sizeId, qty] of plannedBySize.entries()) {
      const size = balancesInTx.find((item) => item.sizeId === sizeId);
      const available = size
        ? Math.max(0, size.received - size.contested - size.assigned)
        : -1;
      if (!size || qty > available) {
        throw new ServiceError(
          `Affectation refusée : disponible en taille ${sizeId} = ${available} pièce(s) (reçu − contesté − déjà affecté).`,
          409,
        );
      }
    }
    const code = nextCode(db, 'couture_assignments', 'AF-');
    const result = db
      .prepare(
        `INSERT INTO couture_assignments
           (code, lot_id, room_id, line_id, responsable_id, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, lotId, roomId, lineId, actor.id, notes);
    const assignmentId = Number(result.lastInsertRowid);
    for (const [sizeId, qty] of plannedBySize.entries()) {
      db.prepare(
        'INSERT INTO couture_assignment_sizes (assignment_id, size_id, planned_qty) VALUES (?, ?, ?)',
      ).run(assignmentId, sizeId, qty);
    }
    if (['a_affecter', 'reception_partielle'].includes(getLotStatus(db, lotId) ?? '')) {
      setLotStatus(db, lotId, 'affecte');
    }
    addHistory(db, {
      action: 'ASSIGNMENT_CREATED',
      entityType: 'affectation',
      entityId: assignmentId,
      actorId: actor.id,
      newValue: { code, lotId, roomId, lineId, sizes: [...plannedBySize.entries()] },
    });
    return assignmentId;
  });
  const assignmentId = insert();
  return getAssignment(actor, assignmentId);
}

/**
 * Transitions contrôlées d'une affectation. Une réaffectation de ligne
 * est possible : l'ancien état, le nouvel état, l'auteur et le motif
 * sont enregistrés dans l'historique.
 */
export function patchAssignment(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): AssignmentDTO {
  requireCouture(actor);
  const id = requireId(rawId, 'Affectation');
  const db = sessionsDb();
  const row = db
    .prepare(`${ASSIGNMENT_SELECT} WHERE a.id = ?`)
    .get(id) as AssignmentRow | undefined;
  if (!row) throw new ServiceError('Affectation introuvable.', 404);
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  const apply = db.transaction(() => {
    // Suivi horaire : worked_seconds cumule les segments « en_cours »
    // (l'ancre du segment est updated_at, posée à chaque transition).
    const accrueWorked = "worked_seconds = worked_seconds "
      + "+ CAST((julianday('now') - julianday(updated_at)) * 86400 AS INTEGER)";
    if (action === 'start') {
      if (!['affecte', 'en_pause', 'attente_reprise'].includes(row.status)) {
        throw new ServiceError('Cette affectation ne peut pas démarrer.', 409);
      }
      db.prepare(
        "UPDATE couture_assignments SET status = 'en_cours', "
        + "started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
      setLotStatus(db, row.lot_id, 'en_cours');
    } else if (action === 'pause') {
      if (row.status !== 'en_cours') {
        throw new ServiceError('Seule une affectation en cours peut être mise en pause.', 409);
      }
      db.prepare(
        `UPDATE couture_assignments SET status = 'en_pause', ${accrueWorked}, `
        + "updated_at = datetime('now') WHERE id = ?",
      ).run(id);
      setLotStatus(db, row.lot_id, 'en_pause');
    } else if (action === 'resume') {
      if (!['en_pause', 'attente_reprise'].includes(row.status)) {
        throw new ServiceError('Cette affectation n’est pas en pause.', 409);
      }
      db.prepare(
        "UPDATE couture_assignments SET status = 'en_cours', "
        + "started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
      setLotStatus(db, row.lot_id, 'en_cours');
    } else if (action === 'block') {
      if (['terminee', 'annulee'].includes(row.status)) {
        throw new ServiceError('Cette affectation ne peut plus être bloquée.', 409);
      }
      if (!reason) {
        throw new ServiceError('Un motif est obligatoire pour bloquer.', 400);
      }
      if (row.status === 'en_cours') {
        db.prepare(
          `UPDATE couture_assignments SET status = 'bloquee', ${accrueWorked}, `
          + "updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      } else {
        db.prepare(
          "UPDATE couture_assignments SET status = 'bloquee', updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      }
      setLotStatus(db, row.lot_id, 'bloque');
    } else if (action === 'unblock') {
      if (row.status !== 'bloquee') {
        throw new ServiceError('Cette affectation n’est pas bloquée.', 409);
      }
      db.prepare(
        "UPDATE couture_assignments SET status = 'en_pause', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
      setLotStatus(db, row.lot_id, 'en_pause');
    } else if (action === 'finish') {
      if (!['en_cours', 'en_pause'].includes(row.status)) {
        throw new ServiceError('Seule une affectation active peut être terminée.', 409);
      }
      if (row.status === 'en_cours') {
        db.prepare(
          `UPDATE couture_assignments SET status = 'terminee', ${accrueWorked}, `
          + "ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      } else {
        db.prepare(
          "UPDATE couture_assignments SET status = 'terminee', "
          + "ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      }
    } else if (action === 'cancel') {
      if (row.status === 'annulee') {
        throw new ServiceError('Affectation déjà annulée.', 409);
      }
      if (!reason) {
        throw new ServiceError('Un motif est obligatoire pour annuler.', 400);
      }
      if (row.status === 'en_cours') {
        db.prepare(
          `UPDATE couture_assignments SET status = 'annulee', ${accrueWorked}, `
          + "ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      } else {
        db.prepare(
          "UPDATE couture_assignments SET status = 'annulee', "
          + "ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      }
    } else if (action === 'reassign') {
      const newLineId = requireId(input.lineId, 'Nouvelle ligne');
      const newRoomId = requireId(input.roomId, 'Nouvelle salle');
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour une réaffectation.', 400,
        );
      }
      if (['terminee', 'annulee'].includes(row.status)) {
        throw new ServiceError(
          'Une affectation terminée ou annulée ne peut pas être réaffectée.', 409,
        );
      }
      requireActiveLine(db, newRoomId, newLineId);
      db.prepare(
        "UPDATE couture_assignments SET room_id = ?, line_id = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(newRoomId, newLineId, id);
      addHistory(db, {
        action: 'ASSIGNMENT_REASSIGNED',
        entityType: 'affectation',
        entityId: id,
        actorId: actor.id,
        oldValue: { roomId: row.room_id, lineId: row.line_id },
        newValue: { roomId: newRoomId, lineId: newLineId },
        reason,
      });
      return;
    } else if (action === 'set_notes') {
      const notes = normalizeText(input.notes, 500);
      db.prepare(
        "UPDATE couture_assignments SET notes = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(notes, id);
      return;
    } else {
      throw new ServiceError('Action inconnue sur l’affectation.', 400);
    }
    addHistory(db, {
      action: `ASSIGNMENT_${action.toUpperCase()}`,
      entityType: 'affectation',
      entityId: id,
      actorId: actor.id,
      oldValue: { status: row.status },
      reason,
    });
  });
  apply();
  return getAssignment(actor, id);
}
