import { NextResponse } from 'next/server';
import { confirmSortie } from '@/server/securite/sorties';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireSecuriteGuard,
} from '@/server/securite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  try {
    return NextResponse.json({ status: 'ok', item: confirmSortie(guard.actor, body) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la confirmation de la sortie.');
  }
}
