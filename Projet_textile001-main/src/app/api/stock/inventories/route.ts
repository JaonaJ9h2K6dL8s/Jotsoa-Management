import { NextResponse } from 'next/server';
import {
  createInventory,
  listInventories,
  submitCount,
} from '@/server/stock/inventories';
import { submitAdjustments } from '@/server/stock/adjustments';
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
    return NextResponse.json({
      status: 'ok',
      items: listInventories(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, "Erreur lors du chargement des inventaires.");
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
    if (action === 'create') {
      const item = createInventory(guard.actor, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    if (action === 'count') {
      const item = submitCount(guard.actor, body);
      return NextResponse.json({ status: 'ok', item });
    }
    if (action === 'submitAdjustments') {
      submitAdjustments(guard.actor, body);
      return NextResponse.json({ status: 'ok' });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue.' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération d'inventaire.");
  }
}
