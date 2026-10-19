import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { serviceErrorCode } from '@/server/api/service-error';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes aux routes de configuration.
 * Toutes les opérations sont réservées au rôle admin et vérifiées
 * côté serveur (jamais uniquement par le menu).
 */

export async function requireAdminGuard(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: NextResponse }
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
