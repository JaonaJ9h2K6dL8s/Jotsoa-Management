import { NextResponse } from 'next/server';
import { toApiError } from '@/server/api/error-response';
import { serviceErrorCode } from '@/server/api/service-error';
import { isSameOrigin } from '@/server/auth/guards';
import { setupAdmin } from '@/server/users/users-service';
import type { ManagedUser } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Création initiale du compte administrateur. Refusée (409) dès
 * qu'un compte admin existe : un seul compte admin peut être créé.
 */
export async function POST(request: Request): Promise<NextResponse> {
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
    const user = setupAdmin({
      nom: String(body?.nom ?? ''),
      prenom: body?.prenom ? String(body.prenom) : null,
      username: String(body?.username ?? ''),
      password: String(body?.password ?? ''),
    });
    const payload: { status: 'ok'; user: ManagedUser } = { status: 'ok', user };
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de la création du compte administrateur.'),
      { status: serviceErrorCode(error) },
    );
  }
}
