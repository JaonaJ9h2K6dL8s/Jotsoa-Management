import { NextResponse } from 'next/server';
import { sessionsDb } from '@/server/auth/sessions';
import {
  errorResponse,
  requireMagasinierGuard,
} from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Catalogue interne pour la correspondance des lignes importées. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    const db = sessionsDb();
    return NextResponse.json({
      status: 'ok',
      item: {
        products: db
          .prepare('SELECT id, nom FROM products WHERE is_active = 1 ORDER BY nom')
          .all(),
        colors: db
          .prepare('SELECT id, nom FROM colors WHERE is_active = 1 ORDER BY nom')
          .all(),
        sizes: db
          .prepare('SELECT id, nom FROM sizes WHERE is_active = 1 ORDER BY display_order')
          .all(),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du catalogue.');
  }
}
