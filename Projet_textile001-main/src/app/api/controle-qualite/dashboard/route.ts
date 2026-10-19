import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/controle-qualite/dashboard';
import { errorResponse, requireCqGuard } from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', item: getDashboard(guard.actor) });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement du tableau de bord.',
    );
  }
}
