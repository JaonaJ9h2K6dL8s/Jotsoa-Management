import { NextResponse } from 'next/server';
import { listReceptions, receiveTransfer } from '@/server/controle-qualite/receptions';
import { listPendingCqTransfers } from '@/server/controle-qualite/balances';
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
      items: {
        pending: listPendingCqTransfers(guard.actor),
        receptions: listReceptions(guard.actor),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des réceptions.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
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
