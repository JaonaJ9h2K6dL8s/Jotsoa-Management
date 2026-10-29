import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { serviceErrorCode } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes aux routes du module Coupe.
 * Les lectures sont accessibles au chef de coupe et à l'administrateur.
 * Les écritures conservent leur contrôle de rôle côté serveur.
 */

export async function requireCoupeReadGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiRole('chef_coupe', 'admin');
  if (!guard.ok) return guard;
  return {
    ok: true,
    actor: {
      id: guard.user.id,
      roleCode: isRoleCode(guard.user.roleCode) ? guard.user.roleCode : null,
    },
  };
}

export async function requireCoupeGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiRole('chef_coupe');
  if (!guard.ok) {
    return guard;
  }
  return {
    ok: true,
    actor: {
      id: guard.user.id,
      roleCode: isRoleCode(guard.user.roleCode) ? guard.user.roleCode : null,
    },
  };
}

/** Actions d'administration du module Coupe (validations, tables). */
export async function requireCoupeAdminGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false, response: NextResponse }
> {
  const guard = await requireApiRole('admin');
  if (!guard.ok) {
    return guard;
  }
  return {
    ok: true,
    actor: {
      id: guard.user.id,
      roleCode: isRoleCode(guard.user.roleCode) ? guard.user.roleCode : null,
    },
  };
}

export function rejectCrossOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return NextResponse.json(
    { status: 'error', message: 'Requête non autorisée.' },
    { status: 403 },
  );
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

export function errorResponse(error: unknown, fallback: string): NextResponse {
  return NextResponse.json(
    {
      status: 'error',
      message:
        error instanceof Error && error.message ? error.message : fallback,
    },
    { status: serviceErrorCode(error) },
  );
}
