import { NextResponse } from 'next/server';
import { createAssignment, listAssignments } from '@/server/couture/assignments';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listAssignments(guard.actor, {
      lotId: url.searchParams.get('lotId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des affectations.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const assignment = createAssignment(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: assignment }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création de l’affectation.');
  }
}
