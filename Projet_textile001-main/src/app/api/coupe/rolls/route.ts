import { NextResponse } from 'next/server';
import { createRoll, listRolls } from '@/server/coupe/rolls';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listRolls(guard.actor, {
      search: url.searchParams.get('search') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des rouleaux.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const roll = createRoll(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: roll }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création du rouleau.');
  }
}
