import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { toApiError } from '@/server/api/error-response';
import { serviceErrorCode } from '@/server/api/service-error';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { updateUser } from '@/server/users/users-mutations';
import type { Actor } from '@/server/users/users-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actorFrom(user: { id: number; roleCode: unknown }): Actor {
  return {
    id: user.id,
    roleCode: isRoleCode(user.roleCode) ? user.roleCode : null,
  };
}

interface PatchBody {
  nom?: unknown;
  prenom?: unknown;
  username?: unknown;
  roleCode?: unknown;
}

export async function PATCH(
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
  try {
    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Identifiant invalide.' },
        { status: 400 },
      );
    }
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    const user = updateUser(actorFrom(guard.user), userId, {
      nom: body?.nom !== undefined ? String(body.nom) : undefined,
      prenom:
        body?.prenom !== undefined
          ? body.prenom
            ? String(body.prenom)
            : null
          : undefined,
      username: body?.username !== undefined ? String(body.username) : undefined,
      roleCode: body?.roleCode !== undefined ? String(body.roleCode) : undefined,
    });
    return NextResponse.json({ status: 'ok', user });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de la modification de l’utilisateur.'),
      { status: serviceErrorCode(error) },
    );
  }
}
