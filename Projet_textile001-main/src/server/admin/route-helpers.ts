import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { serviceErrorCode } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes aux routes de reporting admin. Lecture seule :
 * l'accès ne confère aucune permission d'écriture métier.
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

/** Résumé lisible des filtres pour les en-têtes d'export. */
export function filtersSummary(params: URLSearchParams): string {
  const keys = [
    'lotId',
    'productId',
    'colorId',
    'sizeId',
    'roomId',
    'lineId',
    'userId',
    'status',
    'severity',
    'orderRef',
    'cartonId',
    'locationId',
    'anomalyType',
  ];
  const parts: string[] = [];
  if (params.get('period')) parts.push(`période=${params.get('period')}`);
  if (params.get('from')) parts.push(`du ${params.get('from')}`);
  if (params.get('to')) parts.push(`au ${params.get('to')}`);
  for (const key of keys) {
    const value = params.get(key);
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.join(', ');
}
