import { NextResponse } from 'next/server';
import { sessionsDb } from '@/server/auth/sessions';
import { errorResponse, requireRetoucheGuard } from '@/server/retouche/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Références pour l'affectation : retoucheurs actifs réellement
 * configurés (jamais de noms inventés côté client).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireRetoucheGuard();
  if (!guard.ok) return guard.response;
  try {
    const db = sessionsDb();
    const retoucheurs = db
      .prepare(
        `SELECT u.id, u.nom, u.prenom FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'retoucheur' AND u.is_active = 1
         ORDER BY u.nom, u.prenom`,
      )
      .all() as Array<{ id: number; nom: string; prenom: string | null }>;
    return NextResponse.json({ status: 'ok', items: { retoucheurs } });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des références.');
  }
}
