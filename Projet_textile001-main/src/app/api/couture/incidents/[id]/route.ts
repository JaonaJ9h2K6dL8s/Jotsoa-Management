import { NextResponse } from 'next/server';
import { patchIncident } from '@/server/couture/incidents';
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
    const incident = patchIncident(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: incident });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du traitement de l’incident.');
  }
}
