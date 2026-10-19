import { NextResponse } from 'next/server';
import { getSecDossier, listDossiers } from '@/server/securite/dossiers';
import {
  errorResponse,
  rejectCrossOrigin,
  requireSecuriteGuard,
} from '@/server/securite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireSecuriteGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const dossierId = url.searchParams.get('dossierId');
    if (dossierId) {
      return NextResponse.json({
        status: 'ok',
        item: getSecDossier(guard.actor, Number(dossierId)),
      });
    }
    return NextResponse.json({ status: 'ok', items: listDossiers(guard.actor) });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des dossiers.');
  }
}
