import { NextResponse } from 'next/server';
import {
  cancelCarton,
  closeCarton,
  createCarton,
  getCarton,
  listCartons,
  reopenCarton,
  reprintLabel,
} from '@/server/stock/cartons';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireStockGuard,
} from '@/server/stock/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listCartons(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des cartons.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    switch (action) {
      case 'create': {
        const item = createCarton(guard.actor, body);
        return NextResponse.json({ status: 'ok', item }, { status: 201 });
      }
      case 'close': {
        const item = closeCarton(guard.actor, body);
        return NextResponse.json({ status: 'ok', item });
      }
      case 'reopen': {
        const item = reopenCarton(guard.actor, body);
        return NextResponse.json({ status: 'ok', item });
      }
      case 'cancel': {
        cancelCarton(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      }
      case 'get': {
        const item = getCarton(guard.actor, Number(body.cartonId));
        return NextResponse.json({ status: 'ok', item });
      }
      case 'reprint': {
        const item = reprintLabel(guard.actor, body);
        return NextResponse.json({ status: 'ok', item });
      }
      default:
        return NextResponse.json(
          { status: 'error', message: 'Action inconnue.' },
          { status: 400 },
        );
    }
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur le carton.");
  }
}
