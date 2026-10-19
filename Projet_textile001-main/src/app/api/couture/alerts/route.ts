import { NextResponse } from 'next/server';
import { listAlerts, patchAlert } from '@/server/couture/history';
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
    const items = listAlerts(guard.actor, {
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des alertes.');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    patchAlert(guard.actor, body.id, body);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du traitement de l’alerte.');
  }
}
