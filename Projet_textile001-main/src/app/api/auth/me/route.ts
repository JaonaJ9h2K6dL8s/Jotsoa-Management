import { NextResponse } from 'next/server';
import { toApiError } from '@/server/api/error-response';
import { requireApiAuth } from '@/server/auth/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Renvoie l'utilisateur courant (sans hachage ni jeton) ou 401. */
export async function GET(): Promise<NextResponse> {
  try {
    const guard = await requireApiAuth();
    if (!guard.ok) {
      return guard.response;
    }
    return NextResponse.json({ status: 'ok', user: guard.user });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de la lecture de la session.'),
      { status: 500 },
    );
  }
}
