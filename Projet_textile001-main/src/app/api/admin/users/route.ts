import { NextResponse } from 'next/server';
import { isRoleCode } from '@/lib/roles';
import { toApiError } from '@/server/api/error-response';
import { serviceErrorCode } from '@/server/api/service-error';
import { isSameOrigin, requireApiRole } from '@/server/auth/guards';
import { createUser, listUsers, type Actor } from '@/server/users/users-service';
import type { UsersListResponse } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actorFrom(user: { id: number; roleCode: unknown }): Actor {
  return {
    id: user.id,
    roleCode: isRoleCode(user.roleCode) ? user.roleCode : null,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireApiRole('admin');
  if (!guard.ok) {
    return guard.response;
  }
  try {
    const url = new URL(request.url);
    const users = listUsers({
      search: url.searchParams.get('search') ?? undefined,
      roleCode: url.searchParams.get('role') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    const body: UsersListResponse = { status: 'ok', users };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors du chargement des utilisateurs.'),
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
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
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const user = createUser(actorFrom(guard.user), {
      nom: String(body?.nom ?? ''),
      prenom: body?.prenom ? String(body.prenom) : null,
      username: String(body?.username ?? ''),
      password: String(body?.password ?? ''),
      roleCode: String(body?.roleCode ?? ''),
    });
    return NextResponse.json({ status: 'ok', user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de la création de l’utilisateur.'),
      { status: serviceErrorCode(error) },
    );
  }
}
