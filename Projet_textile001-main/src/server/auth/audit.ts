import type Database from 'better-sqlite3';

/**
 * Journal d'audit des opérations sensibles.
 * Interdiction absolue d'y écrire des mots de passe, des hachages
 * de mots de passe ou des jetons de session.
 */

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATED'
  | 'ADMIN_SETUP_CREATED'
  | 'USER_UPDATED'
  | 'ROLE_CHANGED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'ADMIN_BOOTSTRAP'
  | 'CONFIG_CREATED'
  | 'CONFIG_UPDATED'
  | 'CONFIG_ACTIVATED'
  | 'CONFIG_DEACTIVATED'
  | 'SETTINGS_UPDATED';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: number | null;
  targetUserId?: number | null;
  details?: Record<string, unknown>;
}

/** Clés interdites dans les détails, par défense en profondeur. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'token_hash',
  'tokenHash',
  'currentPassword',
  'newPassword',
]);

function sanitizeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!FORBIDDEN_KEYS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

export function writeAudit(db: Database.Database, entry: AuditEntry): void {
  const details = entry.details ? sanitizeDetails(entry.details) : {};
  db.prepare(
    `INSERT INTO audit_logs (actor_user_id, action, target_user_id, details)
     VALUES (?, ?, ?, ?)`,
  ).run(
    entry.actorUserId ?? null,
    entry.action,
    entry.targetUserId ?? null,
    JSON.stringify(details),
  );
}
