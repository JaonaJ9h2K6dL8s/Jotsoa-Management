import { NextResponse } from 'next/server';
import { getAssignment, patchAssignment } from '@/server/couture/assignments';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await context.params;
    return NextResponse.json({ status: 'ok', item: getAssignment(guard.actor, id) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de l’affectation.');
  }
}

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
    const assignment = patchAssignment(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: assignment });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification de l’affectation.');
  }
}
