import { NextResponse } from 'next/server';
import {
  decideAdjustment,
  listAdjustments,
} from '@/server/stock/adjustments';
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
      items: listAdjustments(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, "Erreur lors du chargement des ajustements.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    decideAdjustment(guard.actor, body);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return errorResponse(error, "Erreur lors de la décision d'ajustement.");
  }
}
