import { NextResponse } from 'next/server';
import { createControl, listControls } from '@/server/controle-qualite/controls';
import { listReceptions } from '@/server/controle-qualite/receptions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: {
        receptions: listReceptions(guard.actor),
        controls: listControls(guard.actor),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des contrôles.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const control = createControl(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: control }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création du contrôle.');
  }
}
