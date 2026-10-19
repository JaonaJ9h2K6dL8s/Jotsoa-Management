import { NextResponse } from 'next/server';
import { getDashboard } from '@/server/coupe/dashboard';
import {
  errorResponse,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const item = getDashboard(guard.actor);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du tableau de bord.');
  }
}
