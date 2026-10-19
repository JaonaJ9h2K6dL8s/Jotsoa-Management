import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CoutureLineDTO, CoutureRoomDTO } from '@/types/couture';
import {
  addHistory,
  normalizeText,
  requireCouture,
  requireId,
} from './common';

/**
 * Salles de couture et lignes de production. Les trois salles
 * initiales existent déjà en base : le service les lit depuis SQLite
 * sans jamais recréer de données au démarrage. Une ligne occupée ne
 * peut pas être désactivée sans traiter ses affectations en cours.
 */

interface LineRow {
  id: number;
  code: string;
  nom: string;
  room_id: number;
  is_active: number;
}

interface RoomRow {
  id: number;
  code: string;
  nom: string;
  is_active: number;
}

function mapLines(db: ReturnType<typeof sessionsDb>, roomId: number): CoutureLineDTO[] {
  const room = db
    .prepare('SELECT code, nom FROM sewing_rooms WHERE id = ?')
    .get(roomId) as { code: string; nom: string } | undefined;
  return (
    db
      .prepare(
        'SELECT id, code, nom, room_id, is_active FROM sewing_lines WHERE room_id = ? ORDER BY id',
      )
      .all(roomId) as LineRow[]
  ).map((line) => ({
    id: line.id,
    code: line.code,
    nom: line.nom,
    roomId: line.room_id,
    roomNom: room?.nom ?? '',
    roomCode: room?.code ?? '',
    isActive: line.is_active === 1,
  }));
}

export function listRooms(actor: Actor): CoutureRoomDTO[] {
  requireCouture(actor);
  const db = sessionsDb();
  const rooms = db
    .prepare('SELECT id, code, nom, is_active FROM sewing_rooms ORDER BY id')
    .all() as RoomRow[];
  return rooms.map((room) => ({
    id: room.id,
    code: room.code,
    nom: room.nom,
    isActive: room.is_active === 1,
    lines: mapLines(db, room.id),
  }));
}

/** Affectations actives d'une ligne (empêchent sa désactivation). */
function activeAssignmentsOnLine(
  db: ReturnType<typeof sessionsDb>,
  lineId: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM couture_assignments
       WHERE line_id = ? AND status IN ('affecte', 'en_cours', 'en_pause', 'bloquee')`,
    )
    .get(lineId) as { total: number };
  return row.total;
}

export function createLine(
  actor: Actor,
  input: Record<string, unknown>,
): CoutureRoomDTO {
  requireCouture(actor);
  const db = sessionsDb();
  const roomId = requireId(input.roomId, 'Salle');
  const code = normalizeText(input.code, 40);
  const nom = normalizeText(input.nom, 80);
  if (!code || !nom) {
    throw new ServiceError('Le code et le nom de la ligne sont obligatoires.', 400);
  }
  const room = db
    .prepare('SELECT id, is_active FROM sewing_rooms WHERE id = ?')
    .get(roomId) as { id: number; is_active: number } | undefined;
  if (!room) throw new ServiceError('Salle introuvable.', 404);
  if (!room.is_active) {
    throw new ServiceError('Impossible de créer une ligne dans une salle désactivée.', 409);
  }
  const duplicate = db
    .prepare('SELECT id FROM sewing_lines WHERE code = ?')
    .get(code) as { id: number } | undefined;
  if (duplicate) {
    throw new ServiceError('Ce code de ligne existe déjà.', 409);
  }
  const insert = db.transaction((): void => {
    const result = db
      .prepare('INSERT INTO sewing_lines (code, nom, room_id, is_active) VALUES (?, ?, ?, 1)')
      .run(code, nom, roomId);
    const lineId = Number(result.lastInsertRowid);
    addHistory(db, {
      action: 'LINE_CREATED',
      entityType: 'ligne_couture',
      entityId: lineId,
      actorId: actor.id,
      newValue: { code, nom, roomId },
    });
  });
  insert();
  const created = db
    .prepare('SELECT id FROM sewing_lines WHERE code = ?')
    .get(code) as { id: number };
  const roomRow = db
    .prepare('SELECT id, code, nom, is_active FROM sewing_rooms WHERE id = ?')
    .get(roomId) as RoomRow;
  return {
    id: roomRow.id,
    code: roomRow.code,
    nom: roomRow.nom,
    isActive: roomRow.is_active === 1,
    lines: mapLines(db, roomId).filter((line) => line.id === created.id),
  };
}

export function patchLine(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): CoutureLineDTO {
  requireCouture(actor);
  const id = requireId(rawId, 'Ligne');
  const db = sessionsDb();
  const line = db
    .prepare('SELECT id, code, nom, room_id, is_active FROM sewing_lines WHERE id = ?')
    .get(id) as LineRow | undefined;
  if (!line) throw new ServiceError('Ligne introuvable.', 404);
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  if (action === 'rename') {
    const nom = normalizeText(input.nom, 80);
    if (!nom) throw new ServiceError('Le nom de la ligne est obligatoire.', 400);
    db.prepare("UPDATE sewing_lines SET nom = ?, updated_at = datetime('now') WHERE id = ?").run(nom, id);
    addHistory(db, {
      action: 'LINE_RENAMED',
      entityType: 'ligne_couture',
      entityId: id,
      actorId: actor.id,
      oldValue: { nom: line.nom },
      newValue: { nom },
      reason,
    });
  } else if (action === 'deactivate') {
    const active = activeAssignmentsOnLine(db, id);
    if (active > 0) {
      throw new ServiceError(
        `Désactivation refusée : ${active} affectation(s) active(s) sur cette ligne. Traitez-les d'abord.`,
        409,
      );
    }
    db.prepare(
      "UPDATE sewing_lines SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    addHistory(db, {
      action: 'LINE_DEACTIVATED',
      entityType: 'ligne_couture',
      entityId: id,
      actorId: actor.id,
      reason,
    });
  } else if (action === 'activate') {
    const room = db
      .prepare('SELECT is_active FROM sewing_rooms WHERE id = ?')
      .get(line.room_id) as { is_active: number } | undefined;
    if (room && !room.is_active) {
      throw new ServiceError('Impossible d’activer une ligne d’une salle désactivée.', 409);
    }
    db.prepare(
      "UPDATE sewing_lines SET is_active = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    addHistory(db, {
      action: 'LINE_ACTIVATED',
      entityType: 'ligne_couture',
      entityId: id,
      actorId: actor.id,
      reason,
    });
  } else {
    throw new ServiceError('Action inconnue sur la ligne.', 400);
  }
  const updated = db
    .prepare('SELECT id, code, nom, room_id, is_active FROM sewing_lines WHERE id = ?')
    .get(id) as LineRow;
  const room = db
    .prepare('SELECT code, nom FROM sewing_rooms WHERE id = ?')
    .get(updated.room_id) as { code: string; nom: string };
  return {
    id: updated.id,
    code: updated.code,
    nom: updated.nom,
    roomId: updated.room_id,
    roomNom: room.nom,
    roomCode: room.code,
    isActive: updated.is_active === 1,
  };
}

export function patchRoom(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): CoutureRoomDTO {
  requireCouture(actor);
  const id = requireId(rawId, 'Salle');
  const db = sessionsDb();
  const room = db
    .prepare('SELECT id, code, nom, is_active FROM sewing_rooms WHERE id = ?')
    .get(id) as RoomRow | undefined;
  if (!room) throw new ServiceError('Salle introuvable.', 404);
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  if (action === 'deactivate') {
    const lines = db
      .prepare('SELECT id FROM sewing_lines WHERE room_id = ?')
      .all(id) as Array<{ id: number }>;
    const active = lines.reduce(
      (acc, line) => acc + activeAssignmentsOnLine(db, line.id),
      0,
    );
    if (active > 0) {
      throw new ServiceError(
        `Désactivation refusée : ${active} affectation(s) active(s) dans cette salle.`,
        409,
      );
    }
    db.prepare(
      "UPDATE sewing_rooms SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    db.prepare(
      "UPDATE sewing_lines SET is_active = 0, updated_at = datetime('now') WHERE room_id = ?",
    ).run(id);
    addHistory(db, {
      action: 'ROOM_DEACTIVATED',
      entityType: 'salle_couture',
      entityId: id,
      actorId: actor.id,
      reason,
    });
  } else if (action === 'activate') {
    db.prepare(
      "UPDATE sewing_rooms SET is_active = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    addHistory(db, {
      action: 'ROOM_ACTIVATED',
      entityType: 'salle_couture',
      entityId: id,
      actorId: actor.id,
      reason,
    });
  } else if (action === 'rename') {
    const nom = normalizeText(input.nom, 80);
    if (!nom) throw new ServiceError('Le nom de la salle est obligatoire.', 400);
    db.prepare("UPDATE sewing_rooms SET nom = ?, updated_at = datetime('now') WHERE id = ?").run(nom, id);
    addHistory(db, {
      action: 'ROOM_RENAMED',
      entityType: 'salle_couture',
      entityId: id,
      actorId: actor.id,
      oldValue: { nom: room.nom },
      newValue: { nom },
      reason,
    });
  } else {
    throw new ServiceError('Action inconnue sur la salle.', 400);
  }
  const updated = db
    .prepare('SELECT id, code, nom, is_active FROM sewing_rooms WHERE id = ?')
    .get(id) as RoomRow;
  return {
    id: updated.id,
    code: updated.code,
    nom: updated.nom,
    isActive: updated.is_active === 1,
    lines: mapLines(db, updated.id),
  };
}
