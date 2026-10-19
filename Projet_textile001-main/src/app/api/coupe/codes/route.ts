import { NextResponse } from 'next/server';
import { lookupByCode, reprintLabel } from '@/server/coupe/identifiers';
import type { IdentifierType } from '@/types/coupe';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recherche par code manuel ou par contenu de QR code. */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') ?? '';
    if (!code.trim()) {
      return NextResponse.json(
        { status: 'error', message: 'Veuillez saisir ou scanner un code.' },
        { status: 400 },
      );
    }
    const item = lookupByCode(guard.actor, code);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la recherche du code.');
  }
}

/** Réimpression d'une étiquette : l'identifiant stable reste le même. */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const objectType = String(body.objectType ?? '') as IdentifierType;
    if (!['rouleau', 'lot', 'paquet'].includes(objectType)) {
      return NextResponse.json(
        { status: 'error', message: 'Type d’objet inconnu.' },
        { status: 400 },
      );
    }
    const item = reprintLabel(
      guard.actor,
      objectType,
      Number(body.objectId),
    );
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la réimpression.');
  }
}
