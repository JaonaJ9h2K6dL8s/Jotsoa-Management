import { NextResponse } from 'next/server';
import { listDossiers, submitDossier, verifyPreparation } from '@/server/magasinier/dossiers';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireMagasinierGuard,
} from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listDossiers(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des dossiers.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    if (action === 'verify') {
      const result = verifyPreparation(guard.actor, body);
      return NextResponse.json({ status: 'ok', item: result });
    }
    if (action === 'submit') {
      const item = submitDossier(guard.actor, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue.' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur le dossier.");
  }
}
