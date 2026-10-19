import { NextResponse } from 'next/server';
import { patchLot } from '@/server/coupe/lots';
import { loadLotDetail } from '@/server/coupe/lot-queries';
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
    const lot = loadLotDetail(guard.actor, id);
    return NextResponse.json({ status: 'ok', item: lot });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du lot.');
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
    const lot = patchLot(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: lot });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification du lot.');
  }
}
