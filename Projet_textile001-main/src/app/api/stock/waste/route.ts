import { NextResponse } from 'next/server';
import {
  listWasteMovements,
  listWasteStock,
  recordWasteMovement,
} from '@/server/stock/waste';
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
      stock: listWasteStock(guard.actor),
      items: listWasteMovements(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du stock de déchets.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    recordWasteMovement(guard.actor, body);
    return NextResponse.json({ status: 'ok' }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur les déchets.");
  }
}
