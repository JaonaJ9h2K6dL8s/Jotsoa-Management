import { NextResponse } from 'next/server';
import { createLine } from '@/server/couture/lines';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const room = createLine(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: room }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création de la ligne.');
  }
}
