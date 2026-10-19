import { NextResponse } from 'next/server';
import { deleteOrder, getOrder } from '@/server/orders/orders';
import {
  errorResponse,
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
    const order = getOrder(guard.actor, Number(id));
    return NextResponse.json({ status: 'ok', item: order });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de la commande.');
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    deleteOrder(guard.actor, Number(id));
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la suppression de la commande.');
  }
}
