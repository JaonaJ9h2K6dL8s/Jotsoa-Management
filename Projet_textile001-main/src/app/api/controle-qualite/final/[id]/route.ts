import { NextResponse } from 'next/server';
import {
  getFinalControl,
  submitFinalResults,
  validateFinalControl,
} from '@/server/controle-qualite/final';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await context.params;
    return NextResponse.json({
      status: 'ok',
      item: getFinalControl(guard.actor, id),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du contrôle final.');
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    if (action === 'submit') {
      submitFinalResults(guard.actor, id, body);
    } else if (action === 'validate') {
      validateFinalControl(guard.actor, id, body);
    } else {
      throw new Error('Action inconnue sur le contrôle final.');
    }
    return NextResponse.json({
      status: 'ok',
      item: getFinalControl(guard.actor, id),
    });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors de la mise à jour du contrôle final.',
    );
  }
}
