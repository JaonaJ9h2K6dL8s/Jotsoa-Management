import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/couture/dashboard';
import { errorResponse, requireCoutureGuard } from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', item: getDashboard(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du tableau de bord.');
  }
}
