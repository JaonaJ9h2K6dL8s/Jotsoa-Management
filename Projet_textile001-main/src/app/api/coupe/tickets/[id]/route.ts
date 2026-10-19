import { NextResponse } from 'next/server';
import { cancelTicket, reprintTicket } from '@/server/coupe/tickets';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TicketAction {
  action?: unknown;
  reason?: unknown;
}

/**
 * Actions sur un ticket (§20.D/§20.E) : réimpression — même
 * identifiant, traçabilité, impression marquée « DUPLICATA » — ou
 * annulation (le ticket reste dans l'historique).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const body = (await readJsonBody(request)) as TicketAction;
    const { id } = await params;
    const action = String(body.action ?? '');
    if (action === 'reprint') {
      const item = await reprintTicket(
        guard.actor,
        Number(id),
        body.reason == null ? null : String(body.reason),
      );
      return NextResponse.json({ status: 'ok', item });
    }
    if (action === 'cancel') {
      cancelTicket(guard.actor, Number(id), body.reason == null ? null : String(body.reason));
      return NextResponse.json({ status: 'ok' });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue (reprint ou cancel).' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’opération sur le ticket.');
  }
}
