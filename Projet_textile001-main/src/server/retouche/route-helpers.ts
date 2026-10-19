import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { serviceErrorCode } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes aux routes du module Retouche. Toutes les opérations
 * métier sont réservées au rôle retoucheur et vérifiées côté serveur.
 */

export async function requireRetoucheGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiRole('retoucheur');
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

/** Propositions de rebut : consultation retoucheur, décision CQ. */
export async function requireRetoucheOrCqGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiRole('retoucheur', 'controleur_qualite');
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
