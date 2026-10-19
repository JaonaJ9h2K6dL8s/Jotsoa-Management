import { NextResponse } from 'next/server';
import { createTransfer, listTransfers } from '@/server/couture/transfers-cq';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoutureGuard,
} from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listTransfers(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des transferts.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const transfer = createTransfer(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: transfer }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création du transfert.');
  }
}
