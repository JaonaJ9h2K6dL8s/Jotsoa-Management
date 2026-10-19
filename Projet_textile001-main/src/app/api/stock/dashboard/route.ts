import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/stock/dashboard';
import { listAlerts, listHistory } from '@/server/stock/history';
import { errorResponse, requireStockGuard } from '@/server/stock/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      item: getDashboard(guard.actor),
      history: listHistory(guard.actor),
      alerts: listAlerts(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du tableau de bord.');
  }
}
