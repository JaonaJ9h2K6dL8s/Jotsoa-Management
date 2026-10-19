import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { toApiError } from '@/server/api/error-response';
import { serviceErrorCode } from '@/server/api/service-error';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { resetUserPassword, setUserActive } from '@/server/users/users-mutations';
import type { Actor } from '@/server/users/users-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actorFrom(user: { id: number; roleCode: unknown }): Actor {
  return {
    id: user.id,
    roleCode: isRoleCode(user.roleCode) ? user.roleCode : null,
  };
}

interface ActionBody {
  action?: unknown;
  password?: unknown;
}

/**
 * Actions ciblées sur un utilisateur : activation/désactivation
 * et réinitialisation de mot de passe.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireApiRole('admin');
  if (!guard.ok) {
    return guard.response;
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { status: 'error', message: 'Requête non autorisée.' },
      { status: 403 },
    );
  }
  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { status: 'error', message: 'Identifiant invalide.' },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as ActionBody | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'activate') {
      const user = setUserActive(actorFrom(guard.user), userId, true);
      return NextResponse.json({ status: 'ok', user });
    }
    if (action === 'deactivate') {
      const user = setUserActive(actorFrom(guard.user), userId, false);
      return NextResponse.json({ status: 'ok', user });
    }
    if (action === 'reset-password') {
      const password = typeof body?.password === 'string' && body.password.length > 0
        ? body.password
        : undefined;
      const result = resetUserPassword(actorFrom(guard.user), userId, password);
      return NextResponse.json({ status: 'ok', ...result });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue.' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de l’action demandée.'),
      { status: serviceErrorCode(error) },
    );
  }
}
