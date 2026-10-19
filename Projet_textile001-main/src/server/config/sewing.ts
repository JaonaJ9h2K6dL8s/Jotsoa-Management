import {
  normalizeName,
  validateCode,
  validateDescription,
  validateLibelle,
} from '@/lib/config-validation';
import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SewingLineRow, SewingRoomRow } from '@/types/config';

/**
 * Salles de couture (exactement trois, créées par migration) et
 * lignes de couture rattachées. Aucune suppression physique : les
 * lignes utilisées en production restent traçables.
 */

interface RoomDbRow {
  id: number;
  code: string;
  nom: string;
  description: string;
  isActive: number;
  lineCount: number;
}

interface LineDbRow {
  id: number;
  code: string;
  nom: string;
  roomId: number;
  roomNom: string;
  isActive: number;
}

export function listSewingRooms(): SewingRoomRow[] {
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT r.id, r.code, r.nom, r.description, r.is_active AS isActive,
              (SELECT COUNT(*) FROM sewing_lines l WHERE l.room_id = r.id) AS lineCount
       FROM sewing_rooms r ORDER BY r.code`,
    )
    .all() as RoomDbRow[];
  return rows.map((row) => ({ ...row, isActive: row.isActive === 1 }));
}

function requireAdmin(actor: Actor): void {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier la configuration.', 403);
  }
}

export function updateSewingRoom(
  actor: Actor,
  id: number,
  input: { nom?: unknown; description?: unknown; isActive?: unknown },
): SewingRoomRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const room = db.prepare('SELECT id FROM sewing_rooms WHERE id = ?').get(id);
  if (!room) {
    throw new ServiceError('Salle de couture introuvable.', 404);
  }
  const errors: string[] = [];
  let nom: string | undefined;
  if (input.nom !== undefined) {
    const error = validateLibelle(input.nom, 'Le nom');
    if (error) errors.push(error);
    else nom = String(input.nom).trim();
  }
  const descriptionError = validateDescription(input.description ?? '');
  if (descriptionError) errors.push(descriptionError);
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }
  const isActive = input.isActive === undefined ? undefined : input.isActive ? 1 : 0;
  const apply = db.transaction(() => {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (nom !== undefined) { fields.push('nom = ?'); params.push(nom); }
    if (input.description !== undefined) {
      fields.push('description = ?');
      params.push(String(input.description ?? '').trim());
    }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive); }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE sewing_rooms SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    writeAudit(db, {
      action: isActive === 0 ? 'CONFIG_DEACTIVATED' : 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: 'sewing_room', id, nom },
    });
  });
  apply();
  return listSewingRooms().find((row) => row.id === id) as SewingRoomRow;
}

export function listSewingLines(filters: { roomId?: number; status?: string } = {}): SewingLineRow[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.roomId) {
    clauses.push('l.room_id = ?');
    params.push(filters.roomId);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('l.is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT l.id, l.code, l.nom, l.room_id AS roomId, r.nom AS roomNom,
              l.is_active AS isActive
       FROM sewing_lines l JOIN sewing_rooms r ON r.id = l.room_id
       ${where} ORDER BY r.code, l.code`,
    )
    .all(...params) as LineDbRow[];
  return rows.map((row) => ({ ...row, isActive: row.isActive === 1 }));
}

export interface LineInput {
  code?: unknown;
  nom?: unknown;
  roomId?: unknown;
}

function validateRoom(db: ReturnType<typeof sessionsDb>, roomId: unknown): number {
  const id = Number(roomId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServiceError('La salle de couture est requise.', 400);
  }
  const room = db
    .prepare('SELECT id, is_active FROM sewing_rooms WHERE id = ?')
    .get(id) as { id: number; is_active: number } | undefined;
  if (!room) {
    throw new ServiceError('La salle de couture sélectionnée est introuvable.', 400);
  }
  if (room.is_active !== 1) {
    throw new ServiceError(
      'La salle de couture sélectionnée est désactivée.',
      400,
    );
  }
  return id;
}

function checkLineCode(
  db: ReturnType<typeof sessionsDb>,
  roomId: number,
  code: string,
  excludeId?: number,
): void {
  const condition = excludeId ? 'AND id != ?' : '';
  const params: unknown[] = excludeId
    ? [roomId, normalizeName(code), excludeId]
    : [roomId, normalizeName(code)];
  if (
    db
      .prepare(
        `SELECT id FROM sewing_lines WHERE room_id = ? AND LOWER(TRIM(code)) = ? ${condition}`,
      )
      .get(...params)
  ) {
    throw new ServiceError('Ce code de ligne existe déjà dans cette salle.', 409);
  }
}

export function createSewingLine(actor: Actor, input: LineInput): SewingLineRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const codeError = validateCode(input.code, 'Le code de ligne');
  if (codeError) throw new ServiceError(codeError, 400);
  const nomError = validateLibelle(input.nom, 'Le nom de la ligne');
  if (nomError) throw new ServiceError(nomError, 400);
  const roomId = validateRoom(db, input.roomId);
  const code = String(input.code).trim().toUpperCase();
  checkLineCode(db, roomId, code);
  const insert = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO sewing_lines (code, nom, room_id) VALUES (?, ?, ?)')
      .run(code, String(input.nom).trim(), roomId);
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: { entity: 'sewing_line', id: Number(result.lastInsertRowid), code, roomId },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return listSewingLines().find((line) => line.id === id) as SewingLineRow;
}

export function updateSewingLine(
  actor: Actor,
  id: number,
  input: LineInput & { isActive?: unknown },
): SewingLineRow {
  requireAdmin(actor);
  const db = sessionsDb();
  const existing = db
    .prepare('SELECT id, room_id FROM sewing_lines WHERE id = ?')
    .get(id) as { id: number; room_id: number } | undefined;
  if (!existing) {
    throw new ServiceError('Ligne de couture introuvable.', 404);
  }
  const errors: string[] = [];
  let code: string | undefined;
  let nom: string | undefined;
  if (input.code !== undefined) {
    const error = validateCode(input.code, 'Le code de ligne');
    if (error) errors.push(error);
    else code = String(input.code).trim().toUpperCase();
  }
  if (input.nom !== undefined) {
    const error = validateLibelle(input.nom, 'Le nom de la ligne');
    if (error) errors.push(error);
    else nom = String(input.nom).trim();
  }
  if (errors.length > 0) throw new ServiceError(errors.join(' '), 400);
  if (input.roomId !== undefined && Number(input.roomId) !== existing.room_id) {
    throw new ServiceError(
      "Une ligne appartient à une seule salle : désactivez-la et créez-en une nouvelle pour changer de salle.",
      400,
    );
  }
  if (code) checkLineCode(db, existing.room_id, code, id);
  const isActive = input.isActive === undefined ? undefined : input.isActive ? 1 : 0;
  const apply = db.transaction(() => {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (code !== undefined) { fields.push('code = ?'); params.push(code); }
    if (nom !== undefined) { fields.push('nom = ?'); params.push(nom); }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive); }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE sewing_lines SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    writeAudit(db, {
      action: isActive === 0 ? 'CONFIG_DEACTIVATED' : 'CONFIG_UPDATED',
      actorUserId: actor.id,
      details: { entity: 'sewing_line', id, code },
    });
  });
  apply();
  return listSewingLines().find((line) => line.id === id) as SewingLineRow;
}
