import { NextResponse } from 'next/server';
import { listFiches, saveFiche } from '@/server/coupe/fiches';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fiches techniques (cahier §3/§21) : GET liste, POST création ou
 * mise à jour (avec archivage de version si la fiche était validée).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const items = listFiches(guard.actor);
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des fiches techniques.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const body = await readJsonBody(request);
    const item = saveFiche(guard.actor, body as unknown as Parameters<typeof saveFiche>[1]);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’enregistrement de la fiche.');
  }
}
