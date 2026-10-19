import { NextResponse } from 'next/server';
import { createOrder, listOrders } from '@/server/orders/orders';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listOrders(
      guard.actor,
      url.searchParams.get('status') ?? undefined,
      url.searchParams.get('search') ?? undefined,
    );
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des commandes.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const order = createOrder(guard.actor, {
      type: body.type === 'interne' ? 'interne' : 'externe',
      clientId: typeof body.clientId === 'number' ? body.clientId : null,
      clientNom: typeof body.clientNom === 'string' ? body.clientNom : null,
      productId: Number(body.productId),
      colorId: body.colorId ? Number(body.colorId) : null,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      lines: Array.isArray(body.lines)
        ? (body.lines as Array<Record<string, unknown>>).map((line) => ({
            sizeId: Number(line.sizeId),
            qty: Number(line.qty),
          }))
        : [],
    });
    return NextResponse.json({ status: 'ok', item: order }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création de la commande.');
  }
}
