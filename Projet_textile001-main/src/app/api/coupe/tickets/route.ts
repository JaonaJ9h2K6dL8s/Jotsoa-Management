import { NextResponse } from 'next/server';
import { createTicket, listTickets } from '@/server/coupe/tickets';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tickets de production (cahier §20) : GET liste ou recherche par
 * code (scan QR — le QR ne porte que le code, le type et la
 * référence), POST génération d'un nouveau ticket.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const code = new URL(request.url).searchParams.get('code') ?? undefined;
    const items = await listTickets(guard.actor, code ?? undefined);
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la recherche du ticket.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const body = await readJsonBody(request);
    const item = await createTicket(guard.actor, body as unknown as Parameters<typeof createTicket>[1]);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la génération du ticket.');
  }
}
