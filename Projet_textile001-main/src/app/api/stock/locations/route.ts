import { NextResponse } from 'next/server';
import {
  createLocation,
  listLocations,
  toggleLocation,
} from '@/server/stock/locations';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireStockGuard,
} from '@/server/stock/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listLocations(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, "Erreur lors du chargement des emplacements.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireStockGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    if (String(body.action ?? '') === 'toggle') {
      toggleLocation(guard.actor, body);
      return NextResponse.json({ status: 'ok' });
    }
    const item = createLocation(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur l'emplacement.");
  }
}
