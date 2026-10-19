import { NextResponse } from 'next/server';
import { listReceptions, receiveTransfer } from '@/server/couture/receptions';
import { listPendingTransfers } from '@/server/couture/balances';
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
    return NextResponse.json({
      status: 'ok',
      items: {
        pending: listPendingTransfers(guard.actor),
        receptions: listReceptions(guard.actor),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des réceptions.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const reception = receiveTransfer(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: reception }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la réception du transfert.');
  }
}
