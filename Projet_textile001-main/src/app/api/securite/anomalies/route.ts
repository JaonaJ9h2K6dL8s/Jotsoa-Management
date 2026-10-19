import { NextResponse } from 'next/server';
import {
  approveCounterCheck,
  listAnomalies,
  requestCorrection,
  resolveAnomaly,
} from '@/server/securite/anomalies';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireSecuriteGuard,
} from '@/server/securite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listAnomalies(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des anomalies.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  try {
    switch (body.action) {
      case 'resolve':
        return NextResponse.json({ status: 'ok', item: resolveAnomaly(guard.actor, body) });
      case 'approveCounterCheck':
        approveCounterCheck(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      case 'requestCorrection':
        requestCorrection(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      default:
        return NextResponse.json(
          { status: 'error', message: 'Action inconnue.' },
          { status: 400 },
        );
    }
  } catch (error) {
    return errorResponse(error, 'Erreur lors du traitement de l’anomalie.');
  }
}
