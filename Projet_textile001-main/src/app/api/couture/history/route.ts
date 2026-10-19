import { NextResponse } from 'next/server';
import { listHistory } from '@/server/couture/history';
import { errorResponse, requireCoutureGuard } from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listHistory(guard.actor, {
      entityType: url.searchParams.get('entityType') ?? undefined,
      entityId: url.searchParams.get('entityId') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement de l’historique.');
  }
}
