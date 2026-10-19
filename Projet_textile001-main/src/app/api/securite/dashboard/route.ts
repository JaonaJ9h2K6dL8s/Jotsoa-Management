import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/securite/dashboard';
import { errorResponse, requireSecuriteGuard } from '@/server/securite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', item: getDashboard(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du tableau de bord.');
  }
}
