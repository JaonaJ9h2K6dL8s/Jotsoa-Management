import { NextResponse } from 'next/server';
import {
  createReworkRequest,
  listReworkRequests,
} from '@/server/controle-qualite/decisions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listReworkRequests(guard.actor),
    });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement des demandes de retouche.',
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const item = createReworkRequest(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors de la création de la demande de retouche.',
    );
  }
}
