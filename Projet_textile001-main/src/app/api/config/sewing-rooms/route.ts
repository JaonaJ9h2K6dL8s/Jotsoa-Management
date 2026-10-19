import { NextResponse } from 'next/server';
import { listSewingRooms, updateSewingRoom } from '@/server/config/sewing';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/config/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: 'ok', items: listSewingRooms() });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des salles.');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Identifiant de salle invalide.' },
        { status: 400 },
      );
    }
    const item = updateSewingRoom(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification de la salle.');
  }
}
