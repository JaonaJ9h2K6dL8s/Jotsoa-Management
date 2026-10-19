import { NextResponse } from 'next/server';
import { getRollDetail, updateRoll } from '@/server/coupe/rolls';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await context.params;
    const roll = getRollDetail(guard.actor, id);
    return NextResponse.json({ status: 'ok', item: roll });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du rouleau.');
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const roll = updateRoll(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: roll });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification du rouleau.');
  }
}
