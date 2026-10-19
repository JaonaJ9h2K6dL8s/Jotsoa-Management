import { NextResponse } from 'next/server';
import { updateSewingLine } from '@/server/config/sewing';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/config/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const lineId = Number(id);
    if (!Number.isInteger(lineId) || lineId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Identifiant invalide.' },
        { status: 400 },
      );
    }
    const body = await readJsonBody(request);
    const item = updateSewingLine(guard.actor, lineId, body);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification de la ligne.');
  }
}
