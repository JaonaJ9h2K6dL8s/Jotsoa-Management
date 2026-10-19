import { toSessionUser, type SessionUser } from '@/types/auth';
import { verifyPassword } from './passwords';
import { registerLoginFailure, resetLoginFailures, loginRateKey } from './rate-limit';
import {
  createSession,
  purgeExpiredSessions,
  revokeSession,
  sessionsDb,
} from './sessions';
import { writeAudit } from './audit';

/**
 * Service d'authentification : aucune dépendance à Next.js, testable
 * directement. Les échecs renvoient un message générique qui ne révèle
 * ni si l'identifiant ni si le mot de passe est en cause.
 */

export const GENERIC_LOGIN_ERROR =
  'Échec de la connexion. Vérifiez votre identifiant et votre mot de passe.';
export const RATE_LIMIT_ERROR =
  'Trop de tentatives. Réessayez dans quelques minutes.';

export interface LoginSuccess {
  ok: true;
  user: SessionUser;
  token: string;
  expiresAt: string;
}

export interface LoginFailure {
  ok: false;
  message: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

interface UserRow {
  id: number;
  nom: string;
  prenom: string | null;
  username: string;
  password_hash: string;
  is_active: number;
  must_change_password: number;
  role_code: string | null;
}

export function authenticate(
  username: string,
  password: string,
  options: { ip?: string } = {},
): LoginResult {
  const db = sessionsDb();
  const normalized = username.trim().toLowerCase();
  const rateKey = loginRateKey(username, options.ip);

  const row = db
    .prepare(
      `SELECT u.id, u.nom, u.prenom, u.username, u.password_hash,
              u.is_active, u.must_change_password, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.username = ?`,
    )
    .get(normalized) as UserRow | undefined;

  const passwordOk =
    row !== undefined && verifyPassword(password, row.password_hash);

  if (!passwordOk) {
    registerLoginFailure(rateKey);
    writeAudit(db, {
      action: 'LOGIN_FAILED',
      targetUserId: row?.id ?? null,
      details: { username: normalized },
    });
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  if (row.is_active !== 1 || row.role_code === null) {
    writeAudit(db, {
      action: 'LOGIN_FAILED',
      targetUserId: row.id,
      details: { username: normalized, inactive: true },
    });
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  const session = createSession(db, row.id);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id,
  );
  resetLoginFailures(rateKey);
  writeAudit(db, {
    action: 'LOGIN_SUCCESS',
    actorUserId: row.id,
    details: { username: row.username },
  });

  const user = toSessionUser({
    id: row.id,
    nom: row.nom,
    prenom: row.prenom,
    username: row.username,
    roleCode: row.role_code,
    mustChangePassword: row.must_change_password,
  });
  if (!user) {
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  return { ok: true, user, token: session.token, expiresAt: session.expiresAt };
}

export function logout(token: string, actorUserId?: number): void {
  const db = sessionsDb();
  purgeExpiredSessions(db);
  revokeSession(db, token);
  writeAudit(db, { action: 'LOGOUT', actorUserId: actorUserId ?? null });
}
