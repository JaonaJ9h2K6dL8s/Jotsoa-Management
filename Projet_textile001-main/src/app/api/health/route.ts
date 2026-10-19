import { NextResponse } from 'next/server';
import { getDatabasePath, initDatabase } from '@/server/db';
import { toApiError } from '@/server/api/error-response';
import type { ApiHealthResponse } from '@/types/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contrôle de santé : vérifie l'ouverture de SQLite et liste
 * les migrations appliquées. Utilisé par l'écran d'accueil.
 */
export async function GET(): Promise<NextResponse<ApiHealthResponse>> {
  try {
    const db = initDatabase();
    db.prepare('SELECT 1').get();
    const migrations = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as { id: string }[];

    return NextResponse.json({
      status: 'ok',
      database: {
        path: getDatabasePath(),
        migrationsApplied: migrations.map((row) => row.id),
      },
    });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur inconnue lors du contrôle de santé.'),
      { status: 500 },
    );
  }
}
