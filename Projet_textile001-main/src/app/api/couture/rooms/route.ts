import { NextResponse } from 'next/server';
import { listRooms } from '@/server/couture/lines';
import { errorResponse, requireCoutureGuard } from '@/server/couture/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Salles de couture et leurs lignes, lues depuis SQLite. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireCoutureGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listRooms(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des salles.');
  }
}
