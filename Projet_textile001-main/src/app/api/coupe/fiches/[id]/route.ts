import { NextResponse } from 'next/server';
import { getFiche, validateFiche } from '@/server/coupe/fiches';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Détail d'une fiche technique (§21.B) avec patrons et versions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const item = getFiche(guard.actor, Number(id));
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Fiche introuvable.');
  }
}

/** Validation d'une fiche (bloquée sans mesures ni patrons validés). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    await readJsonBody(request);
    const { id } = await params;
    const item = validateFiche(guard.actor, Number(id));
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la validation de la fiche.');
  }
}
