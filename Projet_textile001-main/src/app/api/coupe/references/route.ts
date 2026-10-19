import { NextResponse } from 'next/server';
import { listCoupeReferences } from '@/server/coupe/references';
import {
  errorResponse,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const item = listCoupeReferences(guard.actor);
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des références.');
  }
}
