import { NextResponse } from 'next/server';
import { decideSensitiveRequest, listSensitiveRequests } from '@/server/couture/sensitive';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** File des secondes validations (opérations sensibles du module). */
export async function GET(): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listSensitiveRequests(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des demandes.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    decideSensitiveRequest(guard.actor, body);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la décision sur la demande.');
  }
}
