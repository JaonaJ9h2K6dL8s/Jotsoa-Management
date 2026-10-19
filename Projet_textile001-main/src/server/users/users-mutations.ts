import { isRoleCode, type RoleCode } from '@/lib/roles';
import {
  validateNom,
  validatePrenom,
  validateUsername,
} from '@/lib/validation';
import type { ManagedUser } from '@/types/auth';
import { ServiceError } from '@/server/api/service-error';
import { writeAudit } from '@/server/auth/audit';
import {
  generateTemporaryPassword,
  hashPassword,
} from '@/server/auth/passwords';
import { revokeAllUserSessions } from '@/server/auth/sessions';
import { sessionsDb } from '@/server/auth/sessions';
import {
  countActiveAdmins,
  countAdmins,
  getRoleId,
  requireAdminActor,
  toManagedUser,
  type Actor,
  type UserRow,
} from './users-service';

/**
 * Mutations administrateur : mise à jour, activation/désactivation
 * et réinitialisation de mot de passe, avec journal d'audit.
 */

type Db = ReturnType<typeof sessionsDb>;

function getUserRow(db: Db, id: number): UserRow {
  const row = db
    .prepare(
      `SELECT u.id, u.nom, u.prenom, u.username, r.code AS role_code,
              u.is_active, u.created_at, u.last_login_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    )
    .get(id) as UserRow | undefined;
  if (!row) {
    throw new ServiceError('Utilisateur introuvable.', 404);
  }
  return row;
}

export interface UpdateUserInput {
  nom?: string;
  prenom?: string | null;
  username?: string;
  roleCode?: string;
}

export function updateUser(
  actor: Actor,
  id: number,
  input: UpdateUserInput,
): ManagedUser {
  requireAdminActor(actor);
  const db = sessionsDb();
  const row = getUserRow(db, id);
  const errors: string[] = [];
  const updates: { nom?: string; prenom?: string | null; username?: string } = {};

  if (input.nom !== undefined) {
    const error = validateNom(input.nom);
    if (error) errors.push(error);
    else updates.nom = input.nom.trim();
  }
  if (input.prenom !== undefined) {
    const error = validatePrenom(input.prenom);
    if (error) errors.push(error);
    else updates.prenom = input.prenom?.trim() || null;
  }
  if (input.username !== undefined) {
    const error = validateUsername(input.username);
    if (error) {
      errors.push(error);
    } else {
      const normalized = input.username.trim().toLowerCase();
      if (normalized !== row.username.toLowerCase()) {
        const duplicate = db
          .prepare('SELECT id FROM users WHERE username = ?')
          .get(normalized);
        if (duplicate) {
          errors.push('Cet identifiant est déjà utilisé.');
        }
      }
      updates.username = normalized;
    }
  }
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }

  let newRoleId: number | null = null;
  let roleChanged = false;
  if (input.roleCode !== undefined && input.roleCode !== row.role_code) {
    if (actor.id === id) {
      throw new ServiceError(
        'Vous ne pouvez pas modifier votre propre rôle.',
        403,
      );
    }
    if (!isRoleCode(input.roleCode)) {
      throw new ServiceError('Rôle invalide.', 400);
    }
    const wasAdmin = row.role_code === 'admin';
    if (wasAdmin && row.is_active === 1 && countActiveAdmins(db) <= 1) {
      throw new ServiceError(
        'Impossible de retirer le rôle du dernier administrateur actif.',
        409,
      );
    }
    if (!wasAdmin && input.roleCode === 'admin' && countAdmins(db) > 0) {
      throw new ServiceError(
        'Un seul compte administrateur peut exister : attribuez plutôt un autre rôle.',
        409,
      );
    }
    newRoleId = getRoleId(db, input.roleCode as RoleCode);
    roleChanged = true;
  }

  const apply = db.transaction(() => {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
    if (newRoleId !== null) {
      fields.push('role_id = ?');
      params.push(newRoleId);
    }
    if (fields.length === 0) {
      return;
    }
    fields.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(
      ...params,
    );
    writeAudit(db, {
      action: roleChanged ? 'ROLE_CHANGED' : 'USER_UPDATED',
      actorUserId: actor.id,
      targetUserId: id,
      details: { ...updates, roleCode: input.roleCode },
    });
  });
  apply();
  return toManagedUser(getUserRow(db, id));
}

export function setUserActive(
  actor: Actor,
  id: number,
  isActive: boolean,
): ManagedUser {
  requireAdminActor(actor);
  const db = sessionsDb();
  const row = getUserRow(db, id);
  if (!isActive && row.role_code === 'admin' && countActiveAdmins(db) <= 1) {
    throw new ServiceError(
      'Impossible de désactiver le dernier administrateur actif.',
      409,
    );
  }
  const toggle = db.transaction(() => {
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(isActive ? 1 : 0, new Date().toISOString(), id);
    if (!isActive) {
      revokeAllUserSessions(db, id);
    }
    writeAudit(db, {
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      actorUserId: actor.id,
      targetUserId: id,
      details: { username: row.username },
    });
  });
  toggle();
  return toManagedUser(getUserRow(db, id));
}

export interface ResetPasswordResult {
  user: ManagedUser;
  temporaryPassword?: string;
}

export function resetUserPassword(
  actor: Actor,
  id: number,
  newPassword?: string,
): ResetPasswordResult {
  requireAdminActor(actor);
  const db = sessionsDb();
  const row = getUserRow(db, id);
  const temp = newPassword ?? generateTemporaryPassword();
  if (newPassword !== undefined) {
    if (newPassword.length < 8) {
      throw new ServiceError(
        'Le mot de passe doit contenir au moins 8 caractères.',
        400,
      );
    }
  }
  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1,
              updated_at = ? WHERE id = ?`,
    ).run(hashPassword(temp), new Date().toISOString(), id);
    revokeAllUserSessions(db, id);
    writeAudit(db, {
      action: 'PASSWORD_RESET',
      actorUserId: actor.id,
      targetUserId: id,
      details: { username: row.username, forced: true },
    });
  });
  apply();
  return {
    user: toManagedUser(getUserRow(db, id)),
    temporaryPassword: newPassword ? undefined : temp,
  };
}
