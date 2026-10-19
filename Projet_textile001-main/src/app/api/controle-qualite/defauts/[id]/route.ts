import { NextResponse } from 'next/server';
import { requestDefautRebut } from '@/server/controle-qualite/decisions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Soumet une décision de rebut (opération sensible : seconde validation). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const result = requestDefautRebut(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la demande de rebut.');
  }
}
