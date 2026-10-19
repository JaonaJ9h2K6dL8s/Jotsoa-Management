import { NextResponse } from 'next/server';
import {
  getOrderPreparation,
  listReservations,
  releaseReservation,
  reserveStock,
} from '@/server/magasinier/preparations';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireMagasinierGuard,
} from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');
    if (orderId) {
      const item = getOrderPreparation(guard.actor, Number(orderId));
      return NextResponse.json({ status: 'ok', item });
    }
    return NextResponse.json({
      status: 'ok',
      items: listReservations(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de la préparation.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    if (String(body.action ?? '') === 'release') {
      releaseReservation(guard.actor, body);
      return NextResponse.json({ status: 'ok' });
    }
    reserveStock(guard.actor, body);
    return NextResponse.json({ status: 'ok' }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la réservation du stock.');
  }
}
