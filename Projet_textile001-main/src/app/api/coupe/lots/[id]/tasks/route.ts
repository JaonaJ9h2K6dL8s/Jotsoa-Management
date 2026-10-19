import { NextResponse } from 'next/server';
import { createTask } from '@/server/coupe/tasks';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    const task = createTask(guard.actor, { ...body, lotId: id });
    return NextResponse.json({ status: 'ok', item: task }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la création de la tâche.');
  }
}
