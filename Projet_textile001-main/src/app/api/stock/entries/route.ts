import { NextResponse } from 'next/server';
import {
  listEntries,
  listPendingCqTransfers,
  receiveCqTransfer,
} from '@/server/stock/entries';
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
      pendingTransfers: listPendingCqTransfers(guard.actor),
      items: listEntries(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des entrées.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const item = receiveCqTransfer(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la réception du transfert CQ.');
  }
}
