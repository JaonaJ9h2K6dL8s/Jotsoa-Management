import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type {
  CompletenessDTO,
  LotDTO,
  LotDetailDTO,
  LotStatus,
  TaskDTO,
  TaskResultDTO,
  TaskStatus,
} from '@/types/coupe';
import { getWasteForLot } from './waste';
import { requireCoupe, requireId } from './common';
import { getIdentifier } from './identifiers';

/**
 * Lectures du module Coupe : lots, tâches, résultats, déchets, paquets,
 * et calcul de complétude pour le suivi du transfert.
 */

export interface LotDbRow {
  id: number;
  code: string;
  product_id: number;
  product_nom: string;
  color_id: number;
  color_nom: string;
  total_planned_qty: number;
  status: LotStatus;
  responsable_id: number;
  responsable_nom: string | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export const LOT_SELECT = `
  SELECT l.*, p.nom AS product_nom, c.nom AS color_nom,
         u.nom || ' ' || u.prenom AS responsable_nom
  FROM coupe_lots l
  JOIN products p ON p.id = l.product_id
  JOIN colors c ON c.id = l.color_id
  JOIN users u ON u.id = l.responsable_id`;

export function mapLot(row: LotDbRow): LotDTO {
  return {
    id: row.id,
    code: row.code,
    productId: row.product_id,
    productNom: row.product_nom,
    colorId: row.color_id,
    colorNom: row.color_nom,
    totalPlannedQty: row.total_planned_qty,
    status: row.status,
    responsableId: row.responsable_id,
    responsableNom: row.responsable_nom,
    notes: row.notes,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function computeCompleteness(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): CompletenessDTO {
  const tasks = db
    .prepare(
      `SELECT id, code, description, status FROM coupe_tasks
       WHERE lot_id = ? AND is_mandatory = 1 ORDER BY id`,
    )
    .all(lotId) as Array<{
    id: number;
    code: string;
    description: string;
    status: TaskStatus;
  }>;
  const total = tasks.length;
  const validated = tasks.filter((t) => t.status === 'validee').length;
  const done = tasks.filter((t) => t.status === 'terminee').length;
  const inProgress = tasks.filter((t) => t.status === 'en_cours').length;
  const pendingOrBlocked = tasks.filter((t) =>
    ['a_faire', 'en_attente', 'bloquee', 'a_verifier', 'annulee'].includes(t.status),
  ).length;
  return {
    totalMandatory: total,
    done,
    validated,
    inProgress,
    pendingOrBlocked,
    remainingToValidate: total - validated,
    percent: total === 0 ? 0 : Math.round((validated / total) * 100),
    blockingTasks: tasks
      .filter((t) => t.status !== 'validee')
      .map((t) => ({ code: t.code, description: t.description, status: t.status })),
  };
}

function getResultsForTask(
  db: ReturnType<typeof sessionsDb>,
  taskId: number,
): TaskResultDTO[] {
  const rows = db
    .prepare(
      `SELECT r.size_id, s.nom AS size_label, r.planned_qty, r.cut_qty,
              r.usable_qty, r.anomaly_qty, r.waste_qty
       FROM coupe_results r
       JOIN sizes s ON s.id = r.size_id
       WHERE r.task_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(taskId) as Array<{
    size_id: number;
    size_label: string;
    planned_qty: number;
    cut_qty: number;
    usable_qty: number;
    anomaly_qty: number;
    waste_qty: number;
  }>;
  return rows.map((row) => ({
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    plannedQty: row.planned_qty,
    cutQty: row.cut_qty,
    usableQty: row.usable_qty,
    anomalyQty: row.anomaly_qty,
    wasteQty: row.waste_qty,
  }));
}

interface TaskRawRow {
  id: number;
  lot_id: number;
  code: string;
  description: string;
  is_mandatory: number;
  requires_results: number;
  status: TaskStatus;
  responsable_id: number;
  responsable_nom: string | null;
  observations: string | null;
  started_at: string | null;
  finished_at: string | null;
  validated_by: number | null;
  validator_nom: string | null;
  validated_at: string | null;
  validation_notes: string | null;
}

export function getTaskDTOs(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): TaskDTO[] {
  const rows = db
    .prepare(
      `SELECT t.*, u.nom || ' ' || u.prenom AS responsable_nom,
              v.nom || ' ' || v.prenom AS validator_nom
       FROM coupe_tasks t
       JOIN users u ON u.id = t.responsable_id
       LEFT JOIN users v ON v.id = t.validated_by
       WHERE t.lot_id = ? ORDER BY t.id`,
    )
    .all(lotId) as TaskRawRow[];
  return rows.map((row) => ({
    id: row.id,
    lotId: row.lot_id,
    code: row.code,
    description: row.description,
    isMandatory: row.is_mandatory === 1,
    requiresResults: row.requires_results === 1,
    status: row.status,
    responsableId: row.responsable_id,
    responsableNom: row.responsable_nom,
    observations: row.observations,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    validatedBy: row.validated_by,
    validatedByName: row.validator_nom,
    validatedAt: row.validated_at,
    validationNotes: row.validation_notes,
    results: getResultsForTask(db, row.id),
    rolls: (
      db
        .prepare(
          `SELECT tr.roll_id, r.code AS roll_code, tr.weight_used
           FROM coupe_task_rolls tr
           JOIN coupe_rolls r ON r.id = tr.roll_id
           WHERE tr.task_id = ? ORDER BY r.id`,
        )
        .all(row.id) as Array<{
        roll_id: number;
        roll_code: string;
        weight_used: number | null;
      }>
    ).map((roll) => ({
      rollId: roll.roll_id,
      rollCode: roll.roll_code,
      weightUsed: roll.weight_used,
    })),
  }));
}

export function getBundlesForLot(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): LotDetailDTO['bundles'] {
  const rows = db
    .prepare(
      `SELECT b.id, b.lot_id, b.size_id, s.nom AS size_label, b.qty, b.status,
              i.code, i.qr_payload
       FROM coupe_bundles b
       JOIN sizes s ON s.id = b.size_id
       LEFT JOIN coupe_identifiers i
         ON i.object_type = 'paquet' AND i.object_id = b.id
       WHERE b.lot_id = ? ORDER BY b.id`,
    )
    .all(lotId) as Array<{
    id: number;
    lot_id: number;
    size_id: number;
    size_label: string;
    qty: number;
    status: string;
    code: string | null;
    qr_payload: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    lotId: row.lot_id,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    qty: row.qty,
    status: row.status,
    code: row.code,
    qrPayload: row.qr_payload,
  }));
}

/** Charge le détail complet d'un lot (lot, tailles, tâches, déchets, paquets). */
export function loadLotDetail(actor: Actor, rawId: unknown): LotDetailDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant du lot');
  const db = sessionsDb();
  const row = db.prepare(`${LOT_SELECT} WHERE l.id = ?`).get(id) as
    | LotDbRow
    | undefined;
  if (!row) throw new ServiceError('Lot introuvable.', 404);
  const identifier = getIdentifier(db, 'lot', id);
  const reasonRow = db
    .prepare(
      `SELECT h.action, h.reason, h.created_at AS at,
              u.nom || ' ' || u.prenom AS by
       FROM coupe_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.entity_type = 'lot' AND h.entity_id = ?
         AND h.action IN ('LOT_BLOCK', 'LOT_CANCEL')
         AND h.reason IS NOT NULL
       ORDER BY h.id DESC LIMIT 1`,
    )
    .get(id) as
    | { action: string; reason: string; at: string; by: string | null }
    | undefined;
  return {
    ...mapLot(row),
    sizes: (
      db
        .prepare(
          `SELECT ls.id, ls.size_id, s.nom AS size_label, ls.planned_qty
           FROM coupe_lot_sizes ls JOIN sizes s ON s.id = ls.size_id
           WHERE ls.lot_id = ? ORDER BY s.display_order, s.id`,
        )
        .all(id) as Array<{
        id: number;
        size_id: number;
        size_label: string;
        planned_qty: number;
      }>
    ).map((size) => ({
      id: size.id,
      sizeId: size.size_id,
      sizeLabel: size.size_label,
      plannedQty: size.planned_qty,
    })),
    tasks: getTaskDTOs(db, id),
    waste: getWasteForLot(actor, id),
    bundles: getBundlesForLot(db, id),
    identifier: identifier
      ? { code: identifier.code, qrPayload: identifier.qrPayload }
      : null,
    lastStatusReason: reasonRow ?? null,
  };
}
