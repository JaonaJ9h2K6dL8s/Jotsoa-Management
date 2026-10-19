import { NextResponse } from 'next/server';
import { createCadence, listCadences } from '@/server/config/cadences';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/config/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const productTypeId = url.searchParams.get('productTypeId');
    const roomId = url.searchParams.get('roomId');
    const items = listCadences({
      productTypeId: productTypeId ? Number(productTypeId) : undefined,
      roomId: roomId ? Number(roomId) : undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des cadences.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const item = createCadence(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création de la cadence.');
  }
}
