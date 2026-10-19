import { NextResponse } from 'next/server';
import { getLotBalances, getLotSizeBalances } from '@/server/controle-qualite/balances';
import { errorResponse, requireCqGuard } from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const lotId = url.searchParams.get('lotId');
    if (lotId) {
      return NextResponse.json({
        status: 'ok',
        items: getLotSizeBalances(guard.actor, lotId),
      });
    }
    return NextResponse.json({
      status: 'ok',
      items: getLotBalances(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des soldes.');
  }
}
