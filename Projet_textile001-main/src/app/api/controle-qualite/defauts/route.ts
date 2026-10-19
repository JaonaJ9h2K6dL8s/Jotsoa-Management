import { NextResponse } from 'next/server';
import { declareDefaut, listDefauts } from '@/server/controle-qualite/decisions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCqGuard,
} from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const items = listDefauts(guard.actor, {
      controleId: url.searchParams.get('controleId') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des défauts.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const body = await readJsonBody(request);
    const defaut = declareDefaut(guard.actor, body);
    return NextResponse.json({ status: 'ok', item: defaut }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la déclaration du défaut.');
  }
}
