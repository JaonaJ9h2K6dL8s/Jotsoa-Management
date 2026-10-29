import { NextResponse } from 'next/server';
import { requireApiAuth, isSameOrigin } from '@/server/auth/guards';
import { errorResponse } from '@/server/config/route-helpers';
import { getMascotConfig, updateMascotConfig } from '@/server/mascots/mascots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Préférences de mascotte de l'utilisateur connecté.
 * GET : configuration personnelle (ou défaut par rôle).
 * PUT : mise à jour de SA configuration — l'identifiant utilisé est
 * toujours celui de la session, jamais une valeur du corps de requête.
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireApiAuth();
  if (!guard.ok) return guard.response;
  try {
    const config = getMascotConfig(guard.user.id, guard.user.roleCode);
    return NextResponse.json({ status: 'ok', config });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement de la mascotte.',
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await requireApiAuth();
  if (!guard.ok) return guard.response;
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { status: 'error', message: 'Requête non autorisée.' },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const config = updateMascotConfig(
      guard.user.id,
      guard.user.roleCode,
      body,
    );
    return NextResponse.json({ status: 'ok', config });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors de la mise à jour de la mascotte.',
    );
  }
}
