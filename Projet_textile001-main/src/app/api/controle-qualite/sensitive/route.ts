import { NextResponse } from 'next/server';
import {
  decideSensitiveRequest,
  listSensitiveRequests,
} from '@/server/controle-qualite/sensitive';
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
      items: listSensitiveRequests(guard.actor),
    });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement des secondes validations.',
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
    decideSensitiveRequest(guard.actor, body);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du traitement de la seconde validation.',
    );
  }
}
