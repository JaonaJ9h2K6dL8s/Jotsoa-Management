import { NextResponse } from 'next/server';
import { SIMPLE_ENTITIES } from '@/server/config/definitions';
import {
  setReferenceActive,
  updateReference,
} from '@/server/config/reference';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/config/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  nom?: unknown;
  description?: unknown;
  hex_code?: unknown;
  hexCode?: unknown;
  display_order?: unknown;
  displayOrder?: unknown;
  isActive?: unknown;
}

function buildInput(body: PatchBody): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (body.nom !== undefined) input.nom = body.nom;
  if (body.description !== undefined) input.description = body.description;
  if (body.hex_code !== undefined || body.hexCode !== undefined) {
    input.hex_code = body.hex_code ?? body.hexCode;
  }
  if (body.display_order !== undefined || body.displayOrder !== undefined) {
    input.display_order = body.display_order ?? body.displayOrder;
  }
  return input;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { entity, id } = await context.params;
    const def = SIMPLE_ENTITIES[entity];
    if (!def) {
      return NextResponse.json(
        { status: 'error', message: 'Entité de configuration inconnue.' },
        { status: 404 },
      );
    }
    const entityId = Number(id);
    if (!Number.isInteger(entityId) || entityId <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Identifiant invalide.' },
        { status: 400 },
      );
    }
    const body = (await readJsonBody(request)) as PatchBody;
    if (body.isActive !== undefined) {
      const item = setReferenceActive(
        def,
        guard.actor,
        entityId,
        Boolean(body.isActive),
      );
      return NextResponse.json({ status: 'ok', item });
    }
    const item = updateReference(def, guard.actor, entityId, buildInput(body));
    return NextResponse.json({ status: 'ok', item });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification.');
  }
}
