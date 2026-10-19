import { NextResponse } from 'next/server';
import { patchRoom } from '@/server/couture/lines';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const room = patchRoom(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: room });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification de la salle.');
  }
}
