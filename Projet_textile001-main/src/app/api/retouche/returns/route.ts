import { NextResponse } from 'next/server';
import { createReturn, listReturns } from '@/server/retouche/returns';
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
    return NextResponse.json({ status: 'ok', items: listReturns(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des retours.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const item = createReturn(guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors de la transmission au Contrôle qualité.',
    );
  }
}
