import { NextResponse } from 'next/server';
import { listCoupeTables } from '@/server/coupe/marker';
import {
  errorResponse,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tables de coupe (cahier §7) : GET /api/coupe/tables → ressources
 * actives avec leurs capacités (largeur, longueur max, couches max).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const tables = listCoupeTables(guard.actor);
    return NextResponse.json({ status: 'ok', items: tables });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des tables de coupe.');
  }
}
