import { NextResponse } from 'next/server';
import { listMgAlerts, listMgHistory } from '@/server/magasinier/history';
import { errorResponse, requireMagasinierGuard } from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      history: listMgHistory(guard.actor),
      alerts: listMgAlerts(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de l’historique.');
  }
}
