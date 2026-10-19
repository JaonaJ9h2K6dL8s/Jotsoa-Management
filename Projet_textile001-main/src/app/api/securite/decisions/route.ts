import { NextResponse } from 'next/server';
import { decide, listDecisions, listSorties } from '@/server/securite/decisions';
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
    return NextResponse.json({
      status: 'ok',
      items: listDecisions(guard.actor),
      sorties: listSorties(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des décisions.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  try {
    return NextResponse.json({ status: 'ok', item: decide(guard.actor, body) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’enregistrement de la décision.');
  }
}
