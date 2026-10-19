import { NextResponse } from 'next/server';
import {
  patchTask,
  refuseTask,
  setTaskResults,
  validateTask,
} from '@/server/coupe/task-actions';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESULT_ACTIONS = new Set(['set_results']);
const VALIDATION_ACTIONS = new Set(['validate', 'refuse']);
const PATCH_ACTIONS = new Set([
  'start',
  'finish',
  'set_attente',
  'block',
  'unblock',
  'cancel',
  'set_observations',
  'set_rolls',
]);

export async function PATCH(
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
    const action = String(body.action ?? '');
    if (RESULT_ACTIONS.has(action)) {
      const task = await setTaskResults(guard.actor, id, body);
      return NextResponse.json({ status: 'ok', item: task });
    }
    if (VALIDATION_ACTIONS.has(action)) {
      const task =
        action === 'validate'
          ? await validateTask(guard.actor, id, body)
          : await refuseTask(guard.actor, id, body);
      return NextResponse.json({ status: 'ok', item: task });
    }
    if (!PATCH_ACTIONS.has(action)) {
      return NextResponse.json(
        { status: 'error', message: 'Action inconnue sur la tâche.' },
        { status: 400 },
      );
    }
    const task = await patchTask(guard.actor, id, body);
    return NextResponse.json({ status: 'ok', item: task });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la modification de la tâche.');
  }
}
