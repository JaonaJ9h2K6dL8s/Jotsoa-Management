import { NextResponse } from 'next/server';
import {
  finishIntervention,
  listInterventions,
  startIntervention,
} from '@/server/retouche/interventions';
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
    return NextResponse.json({
      status: 'ok',
      items: listInterventions(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des interventions.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? 'start');
    if (action === 'start') {
      const item = startIntervention(guard.actor, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    if (action === 'finish') {
      const item = finishIntervention(guard.actor, body.interventionId, body);
      return NextResponse.json({ status: 'ok', item });
    }
    return errorResponse(new Error('Action inconnue.'), 'Action inconnue.');
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’enregistrement de l’intervention.');
  }
}
