import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import {
  errorResponse,
  readJsonBody,
  rejectCrossOrigin,
  requireCoupeAdminGuard,
  requireCoupeGuard,
  requireCoupeReadGuard,
} from '@/server/api/route-helpers';
import type { Actor } from '@/server/users/users-service';
import { createRoll, updateRoll } from '@/server/cutting/rolls';
import {
  adjustRoll, setRollStatus, listMovements,
} from '@/server/cutting/roll-ops';
import {
  createCutSession, updateCutSession, savePlanRecord, finalizeCutSession,
  invalidateCutSession, replaceCutSession, listCutSessions, getCutSession,
  getBilanTolerance, setBilanTolerance,
} from '@/server/cutting/measurements';
import {
  createCatalogueProduct, updateCatalogueProduct,
} from '@/server/cutting/catalogue';
import { previewPatternForProduct } from '@/server/cutting/pattern-demo';
import { renderPatternPreview } from '@/server/cutting/pattern-preview';
import { updateTable } from '@/server/cutting/tables';
import { saveFiche, validateFiche } from '@/server/cutting/fiches';
import { generateRevision, getRevision } from '@/server/cutting/patterns';
import { importRevision } from '@/server/cutting/pattern-import';
import { validateRevision } from '@/server/cutting/pattern-validate';
import { createPlan, deleteDraftPlan, getPlan, verifyPlan } from '@/server/cutting/plans';
import { optimizePlan } from '@/server/cutting/plans-optimize';
import { autofillPlan } from '@/server/cutting/plans-autofill';
import { remetricsPlan, savePlan, validatePlan } from '@/server/cutting/plans-save';
import { createCutTicket, createCutTransfer } from '@/server/cutting/transfer';
import {
  getTransferTicket, listTransferTickets,
} from '@/server/cutting/transfer-ticket';
import {
  estimateFabricForProduct,
} from '@/server/cutting/fabric-estimate';
import { parseNumberInput } from '@/lib/coupe-validation';
import { requireId } from '@/server/cutting/common';

/**
 * Routeur d'actions de l'atelier Coupe (POST {action, input}).
 * Autorisations : opérations d'atelier et validation des plans = chef de
 * coupe ; validation des fiches/patrons et tables = administrateur.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHEF_ACTIONS = new Set([
  'roll.create',
  'roll.update',
  'roll.adjust',
  'roll.status',
  'roll.movements',
  'catalogue.create',
  'catalogue.update',
  'pattern.preview',
  'pattern.demo-preview',
  'fiche.save',
  'pattern.generate',
  'pattern.import',
  'plan.create',
  'plan.verify',
  'plan.optimize',
  'plan.autofill',
  'plan.save',
  'plan.validate',
  'plan.delete',
  'plan.get',
  'plan.remetrics',
  'pattern.get',
  'ticket.create',
  'transfer.create',
  'measurement.session-create',
  'measurement.session-update',
  'measurement.record-save',
  'measurement.session-finalize',
  'measurement.session-invalidate',
  'measurement.session-replace',
]);

const ADMIN_ACTIONS = new Set([
  'table.update',
  'fiche.validate',
  'pattern.validate',
  'measurement.set-tolerance',
]);

/** Lectures accessibles au chef de coupe ET à l'administrateur. */
const READ_ACTIONS = new Set([
  'transfer.tickets',
  'transfer.ticket',
  'estimate.fabric',
  'estimate.tshirt-theoretical',
  'estimate.sources',
  'estimate.family',
  'measurement.sessions',
  'measurement.session',
  'measurement.tolerance',
]);

async function handle(
  actor: Actor,
  action: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = getDb();
  switch (action) {
    case 'roll.create':
      return { item: createRoll(db, actor, {
        code: input.code,
        fabricRef: input.fabricRef,
        colorId: input.colorId ?? null,
        weightKg: input.weightKg,
        lengthM: input.lengthM,
        widthCm: input.widthCm ?? null,
        usableWidthCm: input.usableWidthCm ?? null,
        grammageGm2: input.grammageGm2 ?? null,
      }) };
    case 'roll.update':
      return { item: updateRoll(db, actor, {
        rollId: input.rollId,
        fabricRef: input.fabricRef,
        colorId: input.colorId,
        lengthM: input.lengthM,
        widthCm: input.widthCm,
        usableWidthCm: input.usableWidthCm,
        grammageGm2: input.grammageGm2,
      }) };
    case 'roll.adjust':
      return { item: adjustRoll(db, actor, {
        rollId: input.rollId,
        newRemainingM: input.newRemainingM,
        newRemainingKg: input.newRemainingKg,
        reason: input.reason,
      }) };
    case 'roll.status':
      return { item: setRollStatus(db, actor, {
        rollId: input.rollId,
        status: input.status,
        reason: input.reason,
      }) };
    case 'roll.movements':
      return { result: { movements: listMovements(
        db, requireId(input.rollId, 'Le rouleau'),
      ) } };
    case 'catalogue.create':
      return { item: createCatalogueProduct(db, actor, {
        nom: input.nom,
        family: input.family,
        category: input.category,
        sizeNames: input.sizeNames,
      }) };
    case 'catalogue.update':
      return { item: updateCatalogueProduct(db, actor, {
        productId: input.productId,
        nom: input.nom,
        sizeNames: input.sizeNames,
        isActive: input.isActive,
      }) };
    case 'pattern.preview':
      return { result: renderPatternPreview(db, actor, input.revisionId) };
    case 'pattern.demo-preview':
      return { result: previewPatternForProduct(db, input.productId) };
    case 'table.update':
      return { item: updateTable(db, actor, {
        tableId: Number(input.tableId),
        largeurCm: input.largeurCm,
        longueurMaxCm: input.longueurMaxCm,
        largeurUtileCm: input.largeurUtileCm,
        couchesMax: input.couchesMax,
      }) };
    case 'fiche.save':
      return { item: saveFiche(db, actor, {
        ficheId: input.ficheId === undefined ? undefined : Number(input.ficheId),
        productId: Number(input.productId),
        sizeId: input.sizeId ?? null,
        fabricType: input.fabricType ?? null,
        colorNom: input.colorNom ?? null,
        mesures: input.mesures,
      }) };
    case 'fiche.validate': {
      const fiche = validateFiche(db, actor, Number(input.ficheId));
      // Génération automatique du patron : la fiche vient d'être validée,
      // le plan est immédiatement disponible dans l'atelier.
      const revision = generateRevision(db, actor, Number(input.ficheId));
      return { item: fiche, revision };
    }
    case 'pattern.generate':
      return { item: generateRevision(db, actor, Number(input.ficheId)) };
    case 'pattern.import':
      return { item: importRevision(db, actor, {
        ficheId: Number(input.ficheId),
        sourceName: input.sourceName,
        sourceUnit: input.sourceUnit === 'mm' ? 'mm' : 'cm',
        pieces: input.pieces,
      }) };
    case 'pattern.get':
      return { item: getRevision(db, Number(input.revisionId)) };
    case 'pattern.validate':
      return { item: validateRevision(db, actor, Number(input.revisionId)) };
    case 'plan.create':
      return { item: createPlan(db, actor, {
        revisionId: Number(input.revisionId),
        rollId: Number(input.rollId),
        tableId: Number(input.tableId),
        layers: Number(input.layers ?? 1),
        gapCm: Number(input.gapCm ?? 1),
        matelasLengthCm: Number(input.matelasLengthCm),
        qty: Number(input.qty ?? 1),
        wastagePct: parseNumberInput(input.wastagePct),
      }) };
    case 'plan.verify':
      return { result: verifyPlan(db, Number(input.planId), input.placements) };
    case 'plan.optimize':
      return { result: optimizePlan(db, actor, Number(input.planId)) };
    case 'plan.autofill':
      return { result: autofillPlan(db, actor, Number(input.planId),
        input.targetMatelas !== undefined
          ? { targetMatelas: Number(input.targetMatelas) }
          : {}) };
    case 'plan.save':
      return { item: savePlan(db, actor, Number(input.planId), input.placements) };
    case 'plan.validate':
      return { item: validatePlan(db, actor, Number(input.planId)) };
    case 'plan.delete':
      return { result: deleteDraftPlan(db, actor, Number(input.planId)) };
    case 'plan.get':
      return { item: getPlan(db, Number(input.planId)) };
    case 'plan.remetrics':
      return { result: remetricsPlan(db, actor, Number(input.planId)) };
    case 'ticket.create':
      return { item: createCutTicket(db, actor, Number(input.planId)) };
    case 'transfer.create':
      return { item: createCutTransfer(db, actor, {
        planId: input.planId,
        ticketCode: input.ticketCode,
        cutPieces: input.cutPieces,
        confirmCut: input.confirmCut,
        notes: input.notes,
      }) };
    case 'transfer.tickets':
      return { result: { tickets: listTransferTickets(db) } };
    case 'transfer.ticket':
      return { item: getTransferTicket(db, requireId(input.transferId, 'Le transfert')) };
    case 'estimate.fabric':
      return { item: estimateFabricForProduct(db, input.productId, input.sizeId, {
        qty: Number(input.qty),
        grammageGm2: parseNumberInput(input.grammageGm2),
        usableWidthCm: parseNumberInput(input.usableWidthCm),
        wastagePct: parseNumberInput(input.wastagePct) ?? 0,
        lengthAllowanceCm: parseNumberInput(input.lengthAllowanceCm),
        chestAllowanceCm: parseNumberInput(input.chestAllowanceCm),
      }) };
    case 'measurement.session-create':
      return { item: createCutSession(db, actor, {
        rollId: input.rollId,
        rollWeightBeforeKg: input.rollWeightBeforeKg,
        instrument: input.instrument,
        notes: input.notes,
      }) };
    case 'measurement.session-update':
      return { item: updateCutSession(db, actor, {
        sessionId: input.sessionId,
        rollWeightBeforeKg: input.rollWeightBeforeKg,
        measuredGsm: input.measuredGsm,
        measuredWidthCm: input.measuredWidthCm,
        instrument: input.instrument,
        notes: input.notes,
      }) };
    case 'measurement.record-save':
      return { item: savePlanRecord(db, actor, {
        sessionId: input.sessionId,
        planId: input.planId,
        lengthUsedM: input.lengthUsedM,
        chutesKg: input.chutesKg,
        piecesKg: input.piecesKg,
      }) };
    case 'measurement.session-finalize':
      return { item: finalizeCutSession(db, actor, {
        sessionId: input.sessionId,
        rollWeightAfterKg: input.rollWeightAfterKg,
        measuredGsm: input.measuredGsm,
        measuredWidthCm: input.measuredWidthCm,
        bilanComment: input.bilanComment,
      }) };
    case 'measurement.session-invalidate':
      return { item: invalidateCutSession(db, actor, {
        sessionId: input.sessionId,
        reason: input.reason,
      }) };
    case 'measurement.session-replace':
      return { item: replaceCutSession(db, actor, input.sessionId) };
    case 'measurement.set-tolerance':
      return { item: setBilanTolerance(db, actor, {
        uncertaintyKg: input.uncertaintyKg,
        floorKg: input.floorKg,
      }) };
    case 'measurement.sessions':
      return { result: { sessions: listCutSessions(db) } };
    case 'measurement.session':
      return { item: getCutSession(db, input.sessionId) };
    case 'measurement.tolerance':
      return { item: getBilanTolerance(db) };
    default:
      throw Object.assign(new Error(`Action inconnue : ${action}`), { status: 400 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Corps de requête illisible.' },
      { status: 400 },
    );
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const input = (typeof body.input === 'object' && body.input !== null
    ? body.input
    : {}) as Record<string, unknown>;
  const isAdminAction = ADMIN_ACTIONS.has(action);
  const isChefAction = CHEF_ACTIONS.has(action);
  const isReadAction = READ_ACTIONS.has(action);
  if (!isAdminAction && !isChefAction && !isReadAction) {
    return NextResponse.json(
      { status: 'error', message: `Action inconnue : ${action}` },
      { status: 400 },
    );
  }
  const guard = isAdminAction
    ? await requireCoupeAdminGuard()
    : action === 'plan.validate' || isReadAction
      ? await requireCoupeReadGuard()
      : await requireCoupeGuard();
  if (!guard.ok) return guard.response;
  try {
    const result = await handle(guard.actor, action, input);
    return NextResponse.json({ status: 'ok', ...result });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de l\'action de coupe.');
  }
}
