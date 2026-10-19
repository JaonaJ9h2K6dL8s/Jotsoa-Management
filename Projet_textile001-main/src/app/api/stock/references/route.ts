import { NextResponse } from 'next/server';
import { listCartons } from '@/server/stock/cartons';
import { listLocations } from '@/server/stock/locations';
import {
  errorResponse,
  requireStockGuard,
} from '@/server/stock/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Références utiles aux écrans du module Stock. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      cartons: listCartons(guard.actor),
      locations: listLocations(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des références.');
  }
}
