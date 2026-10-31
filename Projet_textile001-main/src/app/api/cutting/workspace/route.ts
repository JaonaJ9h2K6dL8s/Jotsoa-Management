import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import {
  errorResponse,
  requireCoupeReadGuard,
} from '@/server/api/route-helpers';
import { listRolls } from '@/server/cutting/rolls';
import { listRollsDetailed } from '@/server/cutting/roll-ops';
import { listTables } from '@/server/cutting/tables';
import { listCatalogueProducts } from '@/server/cutting/catalogue';
import { listFiches } from '@/server/cutting/fiches';
import { listRevisions } from '@/server/cutting/patterns';
import { listPlans } from '@/server/cutting/plans';
import { buildFamilyPieces, PATTERN_FAMILIES, ruleMeasurementLabels } from '@/server/cutting/pattern-rules';

/**
 * Contexte complet de l'atelier Coupe en un seul appel.
 * Consultation uniquement (chef de coupe) : aucune écriture, aucun
 * rouleau consommé, aucun état modifié.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ColorRow {
  id: number;
  nom: string;
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireCoupeReadGuard();
  if (!guard.ok) return guard.response;
  try {
    const db = getDb();
    const colors = db
      .prepare('SELECT id, nom FROM colors WHERE is_active = 1 ORDER BY nom')
      .all() as ColorRow[];
    const sizes = db
      .prepare('SELECT id, nom FROM sizes WHERE is_active = 1 ORDER BY display_order, nom')
      .all() as ColorRow[];
    return NextResponse.json({
      status: 'ok',
      workspace: {
        canValidatePlan: true,
        rolls: listRolls(db),
        rollsAll: listRollsDetailed(db),
        tables: listTables(db),
        catalogue: listCatalogueProducts(db),
        colors,
        sizes,
        fiches: listFiches(db),
        revisions: listRevisions(db),
        plans: listPlans(db),
        familyRules: PATTERN_FAMILIES.map((family) => {
          const pieces = buildFamilyPieces(family, {});
          return {
            family,
            requiredPieces: pieces
              .filter((piece) => piece.required)
              .map((piece) => piece.label),
            optionalPieces: pieces
              .filter((piece) => !piece.required)
              .map((piece) => piece.label),
            measurementLabels: ruleMeasurementLabels(family),
          };
        }),
      },
    });
  } catch (error) {
    return errorResponse(
      error,
      'Erreur lors du chargement de l\'atelier de coupe.',
    );
  }
}
