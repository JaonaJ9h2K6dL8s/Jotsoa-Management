import { isRoleCode, ROLE_LABELS, type RoleCode } from '@/lib/roles';

/**
 * Types partagés entre le serveur et le client.
 * Aucun type n'expose de hachage de mot de passe ni de jeton de session.
 */

export type { RoleCode };

/** Utilisateur tel qu'exposé au navigateur (jamais de hash). */
export interface SessionUser {
  id: number;
  nom: string;
  prenom: string | null;
  username: string;
  roleCode: RoleCode;
  roleLabel: string;
  mustChangePassword: boolean;
}

/** Ligne de la liste des utilisateurs gérée par l'administrateur. */
export interface ManagedUser {
  id: number;
  nom: string;
  prenom: string | null;
  username: string;
  roleCode: RoleCode;
  roleLabel: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginSuccessResponse {
  status: 'ok';
  user: SessionUser;
  redirectTo: string;
}

export interface ApiErrorResponse {
  status: 'error';
  message: string;
}

export type LoginResponse = LoginSuccessResponse | ApiErrorResponse;

export interface UsersListResponse {
  status: 'ok';
  users: ManagedUser[];
}

export function toSessionUser(row: {
  id: number;
  nom: string;
  prenom: string | null;
  username: string;
  roleCode: unknown;
  mustChangePassword: number | boolean;
}): SessionUser | null {
  if (!isRoleCode(row.roleCode)) {
    return null;
  }
  return {
    id: row.id,
    nom: row.nom,
    prenom: row.prenom,
    username: row.username,
    roleCode: row.roleCode,
    roleLabel: ROLE_LABELS[row.roleCode],
    mustChangePassword: Boolean(row.mustChangePassword),
  };
};
