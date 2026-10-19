import { NextResponse } from 'next/server';
import { sessionsDb } from '@/server/auth/sessions';
import { listControls } from '@/server/controle-qualite/controls';
import { errorResponse, requireCqGuard } from '@/server/controle-qualite/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Références utiles à la saisie des défauts : catégories de défauts
 * configurées à l'étape 3, zones de retouche et contrôles ouverts.
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireCqGuard();
  if (!guard.ok) return guard.response;
  try {
    const db = sessionsDb();
    const defects = db
      .prepare('SELECT id, nom, category FROM defects WHERE is_active = 1 ORDER BY nom')
      .all() as Array<{ id: number; nom: string; category: string | null }>;
    const zones = db
      .prepare('SELECT id, nom FROM rework_zones WHERE is_active = 1 ORDER BY nom')
      .all() as Array<{ id: number; nom: string }>;
    return NextResponse.json({
      status: 'ok',
      items: {
        defects,
        zones,
        controls: listControls(guard.actor).filter((control) =>
          ['en_cours', 'incomplet'].includes(control.status),
        ),
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des références.');
  }
}
