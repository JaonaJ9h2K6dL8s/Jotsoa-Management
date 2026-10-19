import { NextResponse } from 'next/server';
import {
  requestProductionCancel,
  requestProductionCorrection,
} from '@/server/couture/productions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Correction ou annulation d'une production : opérations sensibles qui
 * créent une demande de seconde validation (aucune écriture directe).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    if (action === 'correct') {
      return NextResponse.json({
        status: 'ok',
        item: requestProductionCorrection(guard.actor, id, body),
      });
    }
    if (action === 'cancel') {
      return NextResponse.json({
        status: 'ok',
        item: requestProductionCancel(guard.actor, id, body),
      });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue sur la production.' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la demande de correction.');
  }
}
