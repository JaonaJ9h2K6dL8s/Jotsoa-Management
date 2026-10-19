import { NextResponse } from 'next/server';
import { listProductions, recordProduction } from '@/server/couture/productions';
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
    const items = listProductions(guard.actor, {
      lotId: url.searchParams.get('lotId') ?? undefined,
      assignmentId: url.searchParams.get('assignmentId') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des productions.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const production = recordProduction(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: production }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’enregistrement de la production.');
  }
}
