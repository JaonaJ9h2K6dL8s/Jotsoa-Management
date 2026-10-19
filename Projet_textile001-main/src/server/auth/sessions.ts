import type Database from 'better-sqlite3';
import { initDatabase } from '@/server/db';
import { toSessionUser, type SessionUser } from '@/types/auth';
import { generateSessionToken, hashSessionToken } from './tokens';

/**
 * Gestion des sessions côté serveur.
 * Le jeton en clair n'existe que dans le cookie HttpOnly ; la base ne
 * conserve que son empreinte SHA-256. Les sessions expirées ou rattachées
 * à un compte désactivé sont supprimées.
 */

export const SESSION_COOKIE = 'jo_session';

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export function getSessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? '12');
  const valid = Number.isFinite(hours) && hours > 0 && hours <= 24 * 30;
  return (valid ? hours : 12) * 60 * 60 * 1000;
}

export interface CreatedSession {
  token: string;
  expiresAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function purgeExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function createSession(
  db: Database.Database,
  userId: number,
): CreatedSession {
  purgeExpiredSessions(db);
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, hashSessionToken(token), expiresAt, nowIso(), nowIso());
  return { token, expiresAt };
}

interface SessionRow {
  session_id: number;
  token_hash: string;
  expires_at: string;
  last_seen_at: string | null;
  user_id: number;
  nom: string;
  prenom: string | null;
  username: string;
  is_active: number;
  must_change_password: number;
  role_code: string;
}

const SELECT_BY_TOKEN = `
  SELECT s.id AS session_id, s.token_hash, s.expires_at, s.last_seen_at,
         u.id AS user_id, u.nom, u.prenom, u.username, u.is_active,
         u.must_change_password, r.code AS role_code
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  JOIN roles r ON r.id = u.role_id
  WHERE s.token_hash = ?`;

export function revokeSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(
    hashSessionToken(token),
  );
}

export function revokeAllUserSessions(
  db: Database.Database,
  userId: number,
): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Retourne l'utilisateur si la session est valide, sinon nettoie et retourne null. */
export function findUserBySessionToken(
  db: Database.Database,
  token: string,
): SessionUser | null {
  const row = db.prepare(SELECT_BY_TOKEN).get(hashSessionToken(token)) as
    | SessionRow
    | undefined;
  if (!row) {
    return null;
  }
  const now = Date.now();
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  if (!row.is_active) {
    revokeAllUserSessions(db, row.user_id);
    return null;
  }
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!Number.isFinite(lastSeen) || now - lastSeen > LAST_SEEN_THROTTLE_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(
      nowIso(),
      row.session_id,
    );
  }
  return toSessionUser({
    id: row.user_id,
    nom: row.nom,
    prenom: row.prenom,
    username: row.username,
    roleCode: row.role_code,
    mustChangePassword: row.must_change_password,
  });
}

/** Raccourci utilisé par les services serveur pour obtenir la base initialisée. */
export function sessionsDb(): Database.Database {
  return initDatabase();
}
