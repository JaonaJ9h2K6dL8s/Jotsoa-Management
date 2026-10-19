import { NextResponse } from 'next/server';
import type { NestingInput } from '@/server/coupe/nesting';
import {
  createMarkerPlan,
  getLatestValidatedPlanForProduct,
  getMarkerPlan,
  listMarkerPlans,
  validateMarkerPlan,
} from '@/server/coupe/marker';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/coupe/marker → liste ; ?id=N → détail ; ?latestForProduct=N → dernier plan validé. */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    const latestForProduct = Number(url.searchParams.get('latestForProduct'));
    if (Number.isFinite(id) && id > 0) {
      const item = getMarkerPlan(guard.actor, id);
      return NextResponse.json({ status: 'ok', item });
    }
    if (Number.isFinite(latestForProduct) && latestForProduct > 0) {
      const item = getLatestValidatedPlanForProduct(guard.actor, latestForProduct, Number(url.searchParams.get('ficheId')), Number(url.searchParams.get('ficheVersion')));
      return NextResponse.json({ status: 'ok', item });
    }
    const items = listMarkerPlans(guard.actor);
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des plans de marker.');
  }
}

/** POST /api/coupe/marker → calcule et enregistre une proposition. */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const plan = createMarkerPlan(guard.actor, body as unknown as NestingInput & { lotId?: number | null });
    return NextResponse.json({ status: 'ok', item: plan }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du calcul du placement.');
  }
}

/** PATCH /api/coupe/marker?id=N → validation du plan par le chef. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    const plan = validateMarkerPlan(guard.actor, id);
    return NextResponse.json({ status: 'ok', item: plan });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la validation du plan.');
  }
}
