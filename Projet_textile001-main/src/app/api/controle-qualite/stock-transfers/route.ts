import { NextResponse } from 'next/server';
import {
  createStockTransfer,
  listStockTransfers,
} from '@/server/controle-qualite/transfers-stock';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listStockTransfers(guard.actor),
    });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement des transferts vers le stock.',
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const item = createStockTransfer(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors de la préparation du transfert vers le stock.',
    );
  }
}
