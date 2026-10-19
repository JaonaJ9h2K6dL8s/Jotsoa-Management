import { NextResponse } from 'next/server';
import { listAlerts, listHistory, patchAlert } from '@/server/retouche/history';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireRetoucheGuard,
} from '@/server/retouche/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource') ?? 'history';
    if (resource === 'alerts') {
      return NextResponse.json({
        status: 'ok',
        items: listAlerts(guard.actor, {
          status: url.searchParams.get('status') ?? undefined,
        }),
      });
    }
    return NextResponse.json({
      status: 'ok',
      items: listHistory(guard.actor, {
        entityType: url.searchParams.get('entityType') ?? undefined,
        entityId: url.searchParams.get('entityId') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      }),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de l’historique.');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
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
