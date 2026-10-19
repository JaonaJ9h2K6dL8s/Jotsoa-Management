import { NextResponse } from 'next/server';
import { createLotFromOrder, listLots } from '@/server/coupe/lot-workflow';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liste des lots du workflow automatisé (recherche + filtre statut). */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listLots(guard.actor, {
      status: url.searchParams.get('status') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des lots.');
  }
}

/** Création automatique d'un lot depuis une commande prête pour la coupe. */
export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const lot = createLotFromOrder(guard.actor, {
      orderId: Number(body.orderId),
    });
    return NextResponse.json({ status: 'ok', lot }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création du lot.');
  }
}
