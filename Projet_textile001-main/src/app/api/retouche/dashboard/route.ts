import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/retouche/dashboard';
import { errorResponse, requireRetoucheGuard } from '@/server/retouche/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', item: getDashboard(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du tableau de bord.');
  }
}
