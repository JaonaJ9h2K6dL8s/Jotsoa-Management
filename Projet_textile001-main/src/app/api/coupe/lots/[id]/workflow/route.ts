import { NextResponse } from 'next/server';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import {
  cancelLot,
  checkLotReadiness,
  confirmResults,
  confirmTransfer,
  generatePlan,
  getLot,
  getLotExtras,
  prepareTransfer,
  proposeMatelas,
  recordActual,
  startCutting,
  validatePlan,
  type RecordActualInput,
} from '@/server/coupe/lot-workflow';
import { getMarkerPlan } from '@/server/coupe/marker';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeGuard,
} from '@/server/coupe/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ServiceError('Identifiant de lot invalide.', 400);
  }
  return value;
}

/** Détail complet du lot pour l'écran central : lot, vérifications,
 * plan de placement lié, anomalies et historique. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await context.params;
    const lotId = parseId(id);
    const lot = getLot(guard.actor, lotId);
    const readiness = checkLotReadiness(guard.actor, lotId);
    const extras = getLotExtras(guard.actor, lotId);
    const plan = lot.markerPlanId
      ? getMarkerPlan(guard.actor, lot.markerPlanId)
      : null;
    return NextResponse.json({
      status: 'ok',
      item: {
        lot,
        readiness,
        plan,
        anomalies: extras.anomalies,
        history: extras.history,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement du lot.');
  }
}

/** Actions du workflow automatisé : une action = une étape métier
 * explicitement déclenchée par l'utilisateur. */
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
    const lotId = parseId(id);
    const body = await readJsonBody(request);
    const action = String(body.action ?? '');
    const result = dispatchAction(guard.actor, lotId, action, body);
    return NextResponse.json({ status: 'ok', item: result });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l’opération sur le lot.');
  }
}

function dispatchAction(
  actor: Actor,
  lotId: number,
  action: string,
  body: Record<string, unknown>,
): unknown {
  switch (action) {
    case 'check':
      return checkLotReadiness(actor, lotId);
    case 'propose_matelas':
      return proposeMatelas(actor, {
        lotId,
        rollId: body.rollId ? Number(body.rollId) : 0,
        coupeTableId: body.coupeTableId ? Number(body.coupeTableId) : null,
      });
    case 'generate_plan':
      return generatePlan(actor, {
        lotId,
        rollId: Number(body.rollId),
        usableWidthCm: Number(body.usableWidthCm),
        matelasLengthCm: Number(body.matelasLengthCm),
        layers: Number(body.layers),
        gapCm: body.gapCm === undefined ? undefined : Number(body.gapCm),
        grammageGm2:
          body.grammageGm2 === undefined ? undefined : Number(body.grammageGm2),
        coupeTableId: body.coupeTableId ? Number(body.coupeTableId) : null,
      });
    case 'validate_plan':
      return validatePlan(actor, lotId);
    case 'start_cutting':
      return startCutting(actor, lotId);
    case 'record_actual':
      return recordActual(actor, {
        lotId,
        lines: Array.isArray(body.lines)
          ? (body.lines as Array<Record<string, unknown>>).map((line) => ({
              sizeId: Number(line.sizeId),
              cutQty: Number(line.cutQty),
              usableQty:
                line.usableQty === undefined ? undefined : Number(line.usableQty),
              anomalyQty:
                line.anomalyQty === undefined
                  ? undefined
                  : Number(line.anomalyQty),
              wasteQty:
                line.wasteQty === undefined ? undefined : Number(line.wasteQty),
            }))
          : [],
        anomalies: Array.isArray(body.anomalies)
          ? (body.anomalies as Array<Record<string, unknown>>).map((row) => ({
              sizeId: row.sizeId ? Number(row.sizeId) : undefined,
              type: String(row.type) as NonNullable<RecordActualInput['anomalies']>[number]['type'],
              qty: row.qty === undefined ? undefined : Number(row.qty),
              motif: typeof row.motif === 'string' ? row.motif : undefined,
            }))
          : undefined,
      });
    case 'confirm_results':
      return confirmResults(actor, lotId);
    case 'prepare_transfer':
      return prepareTransfer(actor, lotId);
    case 'confirm_transfer':
      return confirmTransfer(actor, {
        lotId,
        lines: Array.isArray(body.lines)
          ? (body.lines as Array<Record<string, unknown>>).map((line) => ({
              sizeId: Number(line.sizeId),
              qty: Number(line.qty),
            }))
          : [],
      });
    case 'cancel':
      return cancelLot(
        actor,
        lotId,
        typeof body.reason === 'string' ? body.reason : undefined,
      );
    default:
      throw new ServiceError('Action de workflow inconnue.', 400);
  }
}
