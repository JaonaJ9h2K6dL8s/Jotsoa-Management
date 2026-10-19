import { NextResponse } from 'next/server';
import { createIncident, listIncidents } from '@/server/couture/incidents';
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
    const items = listIncidents(guard.actor, {
      status: url.searchParams.get('status') ?? undefined,
      severity: url.searchParams.get('severity') ?? undefined,
      lotId: url.searchParams.get('lotId') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des incidents.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const incident = createIncident(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: incident }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la déclaration de l’incident.');
  }
}
