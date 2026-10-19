import { NextResponse } from 'next/server';
import { toApiError } from '@/server/api/error-response';
import {
  SIMPLE_ENTITIES,
} from '@/server/config/definitions';
import {
  createReference,
  listReference,
} from '@/server/config/reference';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/config/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveEntity(params: Promise<{ entity: string }>) {
  return params.then(({ entity }) => SIMPLE_ENTITIES[entity] ?? null);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  try {
    const def = await resolveEntity(context.params);
    if (!def) {
      return NextResponse.json(
        { status: 'error', message: 'Entité de configuration inconnue.' },
        { status: 404 },
      );
    }
    const url = new URL(request.url);
    const items = listReference(def, {
      search: url.searchParams.get('search') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ status: 'ok', items });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement.');
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const def = await resolveEntity(context.params);
    if (!def) {
      return NextResponse.json(
        { status: 'error', message: 'Entité de configuration inconnue.' },
        { status: 404 },
      );
    }
    const body = await readJsonBody(request);
    const item = createReference(def, guard.actor, body);
    return NextResponse.json({ status: 'ok', item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, toApiError(error, 'Erreur lors de la création.').message);
  }
}
