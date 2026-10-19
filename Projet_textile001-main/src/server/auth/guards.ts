import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { homePathForRole } from '@/lib/permissions';
import type { RoleCode } from '@/lib/roles';
import type { SessionUser } from '@/types/auth';
import { getCurrentUser } from './current-user';

/**
 * Garde-fous d'autorisation réutilisables.
 * - Pages : redirection vers /login ou vers l'espace du rôle.
 * - API : réponses 401/403 que chaque route doit respecter.
 */

export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/** Redirige vers l'espace du rôle si l'accès n'est pas autorisé. */
export async function requirePageRole(
  ...allowed: RoleCode[]
): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!allowed.includes(user.roleCode)) {
    redirect(homePathForRole(user.roleCode));
  }
  return user;
}

export type ApiGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireApiAuth(): Promise<ApiGuardResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { status: 'error', message: 'Authentification requise.' },
        { status: 401 },
      ),
    };
  }
  return { ok: true, user };
}

export async function requireApiRole(
  ...allowed: RoleCode[]
): Promise<ApiGuardResult> {
  const guard = await requireApiAuth();
  if (!guard.ok) {
    return guard;
  }
  if (!allowed.includes(guard.user.roleCode)) {
    return {
      ok: false,
      response: NextResponse.json(
        { status: 'error', message: 'Accès refusé pour votre rôle.' },
        { status: 403 },
      ),
    };
  }
  return guard;
}

/**
 * Protection CSRF pour les requêtes mutantes : quand l'en-tête Origin
 * est présent, il doit correspondre à l'hôte de la requête. Combiné au
 * cookie SameSite=Lax, cela couvre les POST/PATCH cross-site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}
