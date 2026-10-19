import { NextResponse } from 'next/server';
import { listControls, startControl } from '@/server/securite/controles';
import { recordLineCheck, recordScan, finishControl } from '@/server/securite/count';
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
    return NextResponse.json({ status: 'ok', items: listControls(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des contrôles.');
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
      case 'start':
        return NextResponse.json({ status: 'ok', item: startControl(guard.actor, body) });
      case 'scan':
        return NextResponse.json({ status: 'ok', item: recordScan(guard.actor, body) });
      case 'lineCheck':
        recordLineCheck(guard.actor, body);
        return NextResponse.json({ status: 'ok' });
      case 'finish':
        return NextResponse.json({ status: 'ok', item: finishControl(guard.actor, body) });
      default:
        return NextResponse.json(
          { status: 'error', message: 'Action inconnue.' },
          { status: 400 },
        );
    }
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’opération de contrôle.');
  }
}
