import { NextResponse } from 'next/server';
import {
  getRequest,
  listRequests,
  listReceptions,
  receiveRequest,
} from '@/server/retouche/requests';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireRetoucheGuard,
} from '@/server/retouche/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: {
        requests: listRequests(guard.actor),
        receptions: listReceptions(guard.actor),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des demandes.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? 'receive');
    if (action === 'receive') {
      const item = receiveRequest(guard.actor, body.requestId, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    if (action === 'detail') {
      const item = getRequest(guard.actor, body.requestId);
      return NextResponse.json({ status: 'ok', item });
    }
    return errorResponse(new Error('Action inconnue sur les demandes.'), 'Action inconnue.');
  } catch (error) {
    return errorResponse(error, 'Erreur lors du traitement de la demande.');
  }
}
