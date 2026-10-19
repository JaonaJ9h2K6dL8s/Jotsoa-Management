import { NextResponse } from 'next/server';
import {
  listMarkerProducts,
  listPatternsByProduct,
} from '@/server/coupe/patterns';
import {
  errorResponse,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chargement automatique des patrons selon le produit sélectionné
 * (cahier §8) : GET /api/coupe/patterns            → produits du marker
 * GET /api/coupe/patterns?productId=2&category=adulte&sizeIds=3,4 → patrons
 */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get('productId');
    if (!productId) {
      const products = listMarkerProducts(guard.actor);
      return NextResponse.json({ status: 'ok', products });
    }
    const sizeIdsParam = url.searchParams.get('sizeIds');
    const sizeIds = sizeIdsParam
      ? sizeIdsParam
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((v) => Number.isInteger(v) && v > 0)
      : undefined;
    const { items, warnings } = listPatternsByProduct(
      guard.actor,
      Number(productId),
      url.searchParams.get('category') ?? undefined,
    );
    const filtered =
      sizeIds && sizeIds.length > 0
        ? items.filter((p) => sizeIds.includes(p.sizeId))
        : items;
    return NextResponse.json({ status: 'ok', items: filtered, warnings });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des patrons.');
  }
}
