import { NextResponse } from 'next/server';
import { requestTransferCancel } from '@/server/couture/transfers-cq';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Annulation d'un transfert confirmé : opération sensible (seconde validation). */
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
    return NextResponse.json({
      status: 'ok',
      item: requestTransferCancel(guard.actor, id, body),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la demande d’annulation.');
  }
}
