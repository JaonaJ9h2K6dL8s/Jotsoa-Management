import { NextResponse } from 'next/server';
import {
  addOrderLine,
  cancelOrder,
  getOrder,
  listOrders,
  matchOrderLine,
  removeOrderLine,
  validateOrder,
} from '@/server/magasinier/orders';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireMagasinierGuard,
} from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listOrders(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des commandes.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    switch (action) {
      case 'get': {
        const item = getOrder(guard.actor, Number(body.orderId));
        return NextResponse.json({ status: 'ok', item });
      }
      case 'matchLine': {
        matchOrderLine(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      }
      case 'addLine': {
        addOrderLine(guard.actor, body);
        return NextResponse.json({ status: 'ok' }, { status: 201 });
      }
      case 'removeLine': {
        removeOrderLine(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      }
      case 'validate': {
        validateOrder(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      }
      case 'cancel': {
        cancelOrder(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      }
      default:
        return NextResponse.json(
          { status: 'error', message: 'Action inconnue.' },
          { status: 400 },
        );
    }
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur la commande.");
  }
}
