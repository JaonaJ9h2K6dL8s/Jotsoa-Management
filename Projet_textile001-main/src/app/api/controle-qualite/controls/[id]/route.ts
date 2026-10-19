import { NextResponse } from 'next/server';
import { getControl } from '@/server/controle-qualite/controls';
import {
  patchControlStatus,
  requestValidation,
  submitResults,
  validateControl,
} from '@/server/controle-qualite/controls-actions';
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
    return NextResponse.json({ status: 'ok', item: getControl(guard.actor, id) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du contrôle.');
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
      submitResults(guard.actor, id, body);
      return NextResponse.json({
        status: 'ok',
        item: getControl(guard.actor, id),
      });
    }
    if (action === 'request_validation') {
      requestValidation(guard.actor, id);
      return NextResponse.json({
        status: 'ok',
        item: getControl(guard.actor, id),
      });
    }
    if (action === 'validate') {
      validateControl(guard.actor, id);
      return NextResponse.json({
        status: 'ok',
        item: getControl(guard.actor, id),
      });
    }
    const control = patchControlStatus(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: control });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la mise à jour du contrôle.');
  }
}
