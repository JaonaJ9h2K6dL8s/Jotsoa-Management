import { NextResponse } from 'next/server';
import { updateDefect } from '@/server/config/defects';
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
    const defectId = Number(id);
    if (!Number.isInteger(defectId) || defectId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Identifiant invalide.' },
        { status: 400 },
      );
    }
    const body = await readJsonBody(request);
    const item = updateDefect(guard.actor, defectId, body);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification du défaut.');
  }
}
