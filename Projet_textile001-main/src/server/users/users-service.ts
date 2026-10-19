import { isRoleCode, ROLE_LABELS, type RoleCode } from '@/lib/roles';
import type Database from 'better-sqlite3';
import {
  validateNom,
  validatePrenom,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import type { ManagedUser } from '@/types/auth';
import { writeAudit } from '@/server/auth/audit';
import { hashPassword } from '@/server/auth/passwords';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';

/**
 * Service de gestion des comptes par l'administrateur.
 * Toutes les règles sensibles (dernier admin, unicité, rôle de soi-même)
 * sont appliquées côté serveur. Aucun hachage ne sort de ce module.
 */

export interface Actor {
  id: number | null;
  roleCode: RoleCode | null;
}

interface UserRow {
  id: number;
  nom: string;
  prenom: string | null;
  username: string;
  role_code: string;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

function toManagedUser(row: UserRow): ManagedUser {
  const roleCode = isRoleCode(row.role_code) ? row.role_code : 'admin';
  return {
    id: row.id,
    nom: row.nom,
    prenom: row.prenom,
    username: row.username,
    roleCode,
    roleLabel: ROLE_LABELS[roleCode],
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function assertAdmin(actor: Actor): void {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut gérer les comptes.', 403);
  }
}

export function requireAdminActor(actor: Actor): void {
  assertAdmin(actor);
}

export { countActiveAdmins, countAdmins, getRoleId, toManagedUser };
export type { UserRow };

function getRoleId(db: Database.Database, code: RoleCode): number {
  const row = db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as
    | { id: number }
    | undefined;
  if (!row) {
    throw new ServiceError('Rôle invalide.', 400);
  }
  return row.id;
}

function countActiveAdmins(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'admin' AND u.is_active = 1`,
      )
      .get() as { n: number }
  ).n;
}

/** Nombre total de comptes administrateur (actifs ou non). */
function countAdmins(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM users u
         JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin'`,
      )
      .get() as { n: number }
  ).n;
}

/** True tant qu'aucun compte administrateur n'existe dans la base. */
export function hasAnyAdmin(): boolean {
  return countAdmins(sessionsDb()) > 0;
}

export function listUsers(
  filters: {
    search?: string;
    roleCode?: string;
    status?: string;
  } = {},
): ManagedUser[] {
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    const like = `%${filters.search.trim().toLowerCase()}%`;
    clauses.push(
      '(LOWER(u.username) LIKE ? OR LOWER(u.nom) LIKE ? OR LOWER(u.prenom) LIKE ?)',
    );
    params.push(like, like, like);
  }
  if (filters.roleCode && isRoleCode(filters.roleCode)) {
    clauses.push('r.code = ?');
    params.push(filters.roleCode);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    clauses.push('u.is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT u.id, u.nom, u.prenom, u.username, r.code AS role_code,
              u.is_active, u.created_at, u.last_login_at
       FROM users u JOIN roles r ON r.id = u.role_id
       ${where} ORDER BY u.created_at DESC, u.id DESC`,
    )
    .all(...params) as UserRow[];
  return rows.map(toManagedUser);
}

export interface CreateUserInput {
  nom: string;
  prenom?: string | null;
  username: string;
  password: string;
  roleCode: string;
}

export function createUser(actor: Actor, input: CreateUserInput): ManagedUser {
  assertAdmin(actor);
  const db = sessionsDb();
  const errors: string[] = [];
  const nomError = validateNom(input.nom);
  const prenomError = validatePrenom(input.prenom);
  const usernameError = validateUsername(input.username);
  const passwordError = validatePassword(input.password);
  for (const error of [nomError, prenomError, usernameError, passwordError]) {
    if (error) errors.push(error);
  }
  if (!isRoleCode(input.roleCode)) {
    errors.push('Rôle invalide.');
  }
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }
  const roleCode = input.roleCode as RoleCode;
  const roleId = getRoleId(db, roleCode);
  if (roleCode === 'admin' && countAdmins(db) > 0) {
    throw new ServiceError(
      'Un seul compte administrateur peut exister : la création d’un second compte admin est refusée.',
      409,
    );
  }
  const username = input.username.trim().toLowerCase();
  const duplicate = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username);
  if (duplicate) {
    throw new ServiceError('Cet identifiant est déjà utilisé.', 409);
  }
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO users (nom, prenom, username, password_hash, role_id, must_change_password)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(
        input.nom.trim(),
        input.prenom?.trim() || null,
        username,
        hashPassword(input.password),
        roleId,
      );
    writeAudit(db, {
      action: 'USER_CREATED',
      actorUserId: actor.id,
      targetUserId: Number(result.lastInsertRowid),
      details: { username, roleCode },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return listUsers().find((user) => user.id === id) as ManagedUser;
}

export interface SetupAdminInput {
  nom: string;
  prenom?: string | null;
  username: string;
  password: string;
}

/**
 * Création initiale du compte administrateur (formulaire public de
 * première installation). Refusée dès qu'un compte admin existe :
 * une seule compte administrateur peut être créée dans l'application.
 */
export function setupAdmin(input: SetupAdminInput): ManagedUser {
  const db = sessionsDb();
  if (countAdmins(db) > 0) {
    throw new ServiceError(
      'Le compte administrateur existe déjà : ce formulaire n’est plus disponible.',
      409,
    );
  }
  const errors: string[] = [];
  const nomError = validateNom(input.nom);
  const prenomError = validatePrenom(input.prenom);
  const usernameError = validateUsername(input.username);
  const passwordError = validatePassword(input.password);
  for (const error of [nomError, prenomError, usernameError, passwordError]) {
    if (error) errors.push(error);
  }
  if (errors.length > 0) {
    throw new ServiceError(errors.join(' '), 400);
  }
  const username = input.username.trim().toLowerCase();
  const roleId = getRoleId(db, 'admin');
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO users (nom, prenom, username, password_hash, role_id, must_change_password)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(
        input.nom.trim(),
        input.prenom?.trim() || null,
        username,
        hashPassword(input.password),
        roleId,
      );
    writeAudit(db, {
      action: 'ADMIN_SETUP_CREATED',
      actorUserId: null,
      targetUserId: Number(result.lastInsertRowid),
      details: { username, roleCode: 'admin' },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return listUsers().find((user) => user.id === id) as ManagedUser;
}
