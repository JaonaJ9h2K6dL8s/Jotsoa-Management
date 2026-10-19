import { NextResponse } from 'next/server';
import {
  createRebutProposal,
  decideRebutProposal,
  listRebutProposals,
} from '@/server/retouche/rebut';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireRetoucheOrCqGuard,
} from '@/server/retouche/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireRetoucheOrCqGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listRebutProposals(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des propositions de rebut.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheOrCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? 'create');
    if (action === 'create') {
      const item = createRebutProposal(guard.actor, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    if (action === 'decide') {
      decideRebutProposal(guard.actor, body);
      return NextResponse.json({ status: 'ok' });
    }
    return errorResponse(new Error('Action inconnue.'), 'Action inconnue.');
  } catch (error) {
    return errorResponse(error, 'Erreur lors du traitement du rebut.');
  }
}
