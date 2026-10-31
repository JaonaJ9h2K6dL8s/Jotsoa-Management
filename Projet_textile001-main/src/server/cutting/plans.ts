import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { PiecePlacement, Point, Rect, Rotation } from '@/lib/cutting/types';
import {
  grainPermittedRotations,
  insideRect,
  polygonArea,
  polygonsConflict,
  transformContour,
} from '@/lib/cutting/geometry';
import {
  assertCoupeAdmin,
  assertCoupeWrite,
  inTransaction,
  requireId,
  requireInt,
  requirePositive,
} from './common';
import { requireActiveTable } from './tables';
import { requireValidatedRevision, type RevisionPiece } from './patterns';

/**
 * Plans de placement (table `marker_plans`, statut 'proposition').
 * Le serveur recalcule TOUTES les contraintes géométriques : il ne
 * fait jamais confiance à un indicateur `valid` du navigateur.
 * - `verifyPlan` : diagnostic sans écriture.
 * - `savePlan` : sauvegarde explicite (plan invalide refusé).
 * - `validatePlan` : validation finale (administrateur), plan
 *   immuable ensuite (triggers SQL). Les gestes du canvas ne
 *   persistent jamais d'eux-mêmes.
 */

export interface PlanInput {
  revisionId: number;
  rollId: number;
  tableId: number;
  layers: number;
  gapCm: number;
  matelasLengthCm: number;
  qty: number;
  /**
   * Wastage (%) appliqué UNE fois à la consommation théorique calculée
   * à la validation du plan. Défaut 0 (estimation nette).
   */
  wastagePct?: number | null;
}

export interface PlanViolation {
  index: number;
  code: string;
  reason: string;
}

export interface PlanVerifyResult {
  ok: boolean;
  violations: PlanViolation[];
}

interface PlanRow {
  id: number;
  product_id: number;
  category: string;
  usable_width_cm: number;
  matelas_length_cm: number;
  layers: number;
  gap_cm: number;
  grammage_g_m2: number | null;
  sizes_json: string;
  pieces_json: string;
  marker_length_cm: number;
  total_pieces: number;
  placed_area_m2: number;
  available_area_m2: number;
  efficiency: number;
  waste_area_m2: number;
  status: string;
  created_by: number;
  coupe_table_id: number | null;
  roll_id: number | null;
  /** Lot Couture créé au transfert (null → plan non transféré). */
  lot_id: number | null;
  input_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CutPieceCount {
  pieceId: number;
  label: string;
  qtyPerLayer: number;
  layers: number;
  totalQty: number;
}

/** Détail théorique d'une taille du plan (formule de référence). */
export interface PlanTheoreticalSize {
  sizeId: number;
  label: string;
  /** Pièces de vêtement coupées pour cette taille (qty × couches). */
  garments: number;
  /** Consommation nette par pièce (kg). */
  netKgPerPiece: number;
  /** Consommation nette de la taille (kg), sans wastage. */
  netKgTotal: number;
}

/**
 * Consommation théorique calculée côté serveur à la validation du
 * plan, selon la famille du produit (formule de référence ORDNUR
 * « C12 » pour le tshirt, somme de panneaux dédiée pour les autres).
 * Estimation théorique : ne remplace ni le placement géométrique ni
 * la consommation physique constatée à la coupe.
 */
export interface PlanTheoreticalSummary {
  family: string;
  /** 'C12' : formule ORDNUR (tshirt) ; 'panneaux' : somme dédiée. */
  formula: 'C12' | 'panneaux';
  grammageGm2: number;
  wastagePct: number;
  /** Moyenne nette par pièce (kg) sur l'ensemble du plan. */
  netKgPerPiece: number;
  /** Total net du plan (kg), avant wastage. */
  netKgTotal: number;
  /** Total après UNE application du wastage (kg). */
  kgWithWastage: number;
  computedAt: string;
  sizes: PlanTheoreticalSize[];
}

/** Options persistées dans input_json (révision + paramètres de calcul). */
export interface PlanInputJson {
  revisionId: number;
  wastagePct?: number;
  theoretical?: PlanTheoreticalSummary | null;
  theoreticalUnavailable?: string | null;
  /** Plans dupliqués (matelas pleins) rattachés à ce plan source. */
  autofillDuplicates?: number[];
}

/** Lit input_json sans jamais lever (données anciennes ou partielles). */
export function readPlanInputJson(raw: string | null): PlanInputJson {
  if (raw === null || raw === '') return { revisionId: 0 };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { revisionId: 0 };
    }
    return parsed as PlanInputJson;
  } catch {
    return { revisionId: 0 };
  }
}

/** Fusionne des clés dans input_json du plan (autorité serveur). */
export function patchPlanInputJson(
  db: Database.Database,
  planId: number,
  patch: Partial<PlanInputJson>,
): void {
  const row = db
    .prepare('SELECT input_json FROM marker_plans WHERE id = ?')
    .get(planId) as { input_json: string | null } | undefined;
  if (!row) throw new ServiceError('Plan introuvable.', 404);
  const current = readPlanInputJson(row.input_json);
  db.prepare('UPDATE marker_plans SET input_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...current, ...patch }), planId);
}

export interface PlanItem extends PlanRow {
  placements: PiecePlacement[];
  zone: Rect;
  cutPieces: CutPieceCount[];
  /** Estimation théorique enregistrée à la validation (null sinon). */
  theoretical: PlanTheoreticalSummary | null;
  /** Cause explicite d'absence d'estimation (null si calculée). */
  theoreticalUnavailable: string | null;
}

interface RollInfo {
  id: number;
  status: string;
  usable_width_cm: number | null;
  width_cm: number | null;
  initial_qty: number | null;
  remaining_qty: number | null;
  qty_unit: string | null;
}

function parsePlacementsRaw(raw: string): PiecePlacement[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PiecePlacement[];
  } catch {
    return [];
  }
}

function zoneOf(row: PlanRow): Rect {
  return { x: 0, y: 0, width: row.usable_width_cm, height: row.matelas_length_cm };
}

interface CutPieceCountRow {
  piece_id: number;
  label: string;
  qty_per_layer: number;
  layers: number;
}

function listPlanCutPieces(db: Database.Database, planId: number): CutPieceCount[] {
  const rows = db.prepare(
    `SELECT counts.piece_id, pieces.piece_label AS label,
            counts.qty_per_layer, counts.layers
       FROM marker_plans plans
       JOIN coupe_transfers transfers ON transfers.lot_id = plans.lot_id
       JOIN coupe_transfer_piece_counts counts ON counts.transfer_id = transfers.id
       JOIN pattern_pieces pieces ON pieces.id = counts.piece_id
      WHERE plans.id = ?
      ORDER BY pieces.id`,
  ).all(planId) as CutPieceCountRow[];
  return rows.map((row) => ({
    pieceId: row.piece_id,
    label: row.label,
    qtyPerLayer: row.qty_per_layer,
    layers: row.layers,
    totalQty: row.qty_per_layer * row.layers,
  }));
}

export function getPlan(db: Database.Database, planId: number): PlanItem {
  const row = db
    .prepare('SELECT * FROM marker_plans WHERE id = ?')
    .get(planId) as PlanRow | undefined;
  if (!row) throw new ServiceError('Plan de coupe introuvable.', 404);
  const input = readPlanInputJson(row.input_json);
  return {
    ...row,
    placements: parsePlacementsRaw(row.pieces_json),
    zone: zoneOf(row),
    cutPieces: row.lot_id === null ? [] : listPlanCutPieces(db, planId),
    theoretical: input.theoretical ?? null,
    theoreticalUnavailable: input.theoreticalUnavailable ?? null,
  };
}

export function listPlans(
  db: Database.Database,
  status?: string,
): PlanItem[] {
  const rows = (
    status
      ? db.prepare('SELECT id FROM marker_plans WHERE status = ? ORDER BY id DESC').all(status)
      : db.prepare('SELECT id FROM marker_plans ORDER BY id DESC').all()
  ) as { id: number }[];
  return rows.map((row) => getPlan(db, row.id));
}

export function createPlan(
  db: Database.Database,
  actor: Actor,
  input: PlanInput,
): PlanItem {
  assertCoupeWrite(actor);
  const revisionId = requireId(input.revisionId, 'La révision de patron');
  const revision = requireValidatedRevision(db, revisionId);
  const table = requireActiveTable(db, requireId(input.tableId, 'La table'));
  const rollId = requireId(input.rollId, 'Le rouleau');
  const roll = db
    .prepare(
      `SELECT id, status, usable_width_cm, width_cm, initial_qty,
              remaining_qty, qty_unit
         FROM coupe_rolls WHERE id = ?`,
    )
    .get(rollId) as RollInfo | undefined;
  if (!roll) throw new ServiceError('Rouleau introuvable.', 404);
  if (roll.status !== 'disponible') {
    throw new ServiceError('Le rouleau n\'est pas disponible.', 409);
  }
  const layers = requireInt(input.layers, 'Le nombre de couches', 1, Math.min(40, table.couchesMax));
  const gap = requirePositive(input.gapCm, 'L\'écart entre pièces', false);
  // Disponibilité du rouleau : le MÉTRAGE RESTANT quand il est connu et
  // fiable (qty_unit 'm'), jamais l'initial. Rouleau suivi en kg ou au
  // métrage inconnu : pas de longueur certaine → seule la limite de la
  // table s'applique (la cohérence kg est revérifiée au transfert).
  const rollLength = roll.qty_unit === 'm' && roll.remaining_qty !== null
    ? roll.remaining_qty * 100
    : null;
  const matelas = requirePositive(input.matelasLengthCm, 'La longueur du matelas');
  if (matelas > table.longueurMaxCm) {
    throw new ServiceError(
      `La longueur du matelas dépasse la longueur de la table (${table.longueurMaxCm} cm).`,
      400,
    );
  }
  if (rollLength !== null && matelas * layers > rollLength) {
    throw new ServiceError(
      `Le matelas (${matelas} cm) × ${layers} couche(s) dépasse la longueur `
      + `disponible du rouleau (${rollLength / 100} m restants).`,
      400,
    );
  }
  const rollWidth = roll.usable_width_cm ?? roll.width_cm ?? null;
  const usableWidth = rollWidth !== null
    ? Math.min(rollWidth, table.largeurUtileCm)
    : table.largeurUtileCm;
  const qty = requireInt(input.qty ?? 1, 'La quantité par couche', 1, 999);
  // Wastage théorique : pourcentage borné, appliqué UNE fois à la
  // validation. Absent → 0 (estimation nette).
  const wastageRaw = input.wastagePct ?? 0;
  const wastagePct = typeof wastageRaw === 'number' ? wastageRaw : Number(wastageRaw);
  if (!Number.isFinite(wastagePct) || wastagePct < 0 || wastagePct > 100) {
    throw new ServiceError(
      'Le wastage doit être un nombre entre 0 et 100.',
      400,
    );
  }
  const available = (usableWidth * matelas) / 10000;
  return inTransaction(db, () => {
    const result = db.prepare(
      `INSERT INTO marker_plans
         (product_id, category, usable_width_cm, matelas_length_cm, layers,
          gap_cm, sizes_json, pieces_json, marker_length_cm, total_pieces,
          placed_area_m2, available_area_m2, efficiency, waste_area_m2,
          status, created_by, coupe_table_id, roll_id, input_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 0, 0, ?, 0, ?,
               'proposition', ?, ?, ?, ?)`,
    ).run(
      revision.productId,
      tableCategory(db, revision.productId),
      usableWidth,
      matelas,
      layers,
      gap,
      JSON.stringify([{ sizeId: revision.sizeId, qty }]),
      matelas,
      available,
      available,
      actor.id,
      table.id,
      rollId,
      JSON.stringify({ revisionId, wastagePct }),
    );
    return getPlan(db, Number(result.lastInsertRowid));
  });
}

function tableCategory(db: Database.Database, productId: number): string {
  const row = db
    .prepare('SELECT category FROM coupe_catalogue WHERE product_id = ?')
    .get(productId) as { category: string } | undefined;
  return row?.category === 'enfant' ? 'enfant' : 'adulte';
}

/**
 * Suppression d'un plan BROUILLON uniquement (statut « proposition »,
 * jamais transféré vers un lot). Sert au recalcul du nombre de matelas :
 * les duplicatas en trop sont retirés, les plans validés restent immuables.
 */
export function deleteDraftPlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
): { deleted: true } {
  assertCoupeWrite(actor);
  const plan = getPlan(db, Number(planId));
  if (plan.status !== 'proposition') {
    throw new ServiceError(
      `Plan #${planId} ${plan.status === 'valide' ? 'validé (immuable)' : plan.status} `
        + ': seuls les brouillons peuvent être supprimés.',
      409,
    );
  }
  if (plan.lot_id !== null) {
    throw new ServiceError(
      `Plan #${planId} déjà transféré vers un lot : suppression impossible.`,
      409,
    );
  }
  try {
    const result = db
      .prepare("DELETE FROM marker_plans WHERE id = ? AND status = 'proposition' AND lot_id IS NULL")
      .run(plan.id);
    if (result.changes !== 1) {
      throw new ServiceError(`Plan #${planId} n'a pas pu être supprimé.`, 409);
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      `Plan #${planId} référencé par d'autres données : suppression impossible.`,
      409,
    );
  }
  return { deleted: true };
}

/** Recontrôle géométrique complet côté serveur. */
export function verifyPlan(
  db: Database.Database,
  planId: number,
  placements: unknown,
): PlanVerifyResult {
  const plan = getPlan(db, planId);
  const revisionId = readRevisionId(plan.input_json);
  if (revisionId === null) {
    throw new ServiceError('Plan sans révision de patron associée.', 409);
  }
  const revision = requireValidatedRevision(db, revisionId);
  const pieces = new Map<number, RevisionPiece>();
  for (const piece of revision.pieces) pieces.set(piece.id, piece);
  const zone = plan.zone;
  const parsed = parsePlacementInput(placements);
  const violations: PlanViolation[] = [];
  const contours: Point[][] = [];
  parsed.forEach((placement, index) => {
    const piece = pieces.get(placement.pieceId);
    if (!piece) {
      violations.push({ index, code: '?', reason: 'Pièce inconnue pour ce plan.' });
      contours.push([]);
      return;
    }
    const permitted = grainPermittedRotations(piece.grainDirection, piece.allowedRotations);
    if (!permitted.includes(placement.rotation)) {
      violations.push({
        index,
        code: piece.code,
        reason: `Rotation ${placement.rotation}° interdite pour ${piece.label}.`,
      });
      contours.push([]);
      return;
    }
    const contour = transformContour(
      piece.points,
      placement.rotation as Rotation,
      placement.x,
      placement.y,
    );
    if (!insideRect(contour, zone)) {
      violations.push({
        index,
        code: piece.code,
        reason: `${piece.label} dépasse la zone utilisable du tissu.`,
      });
    }
    contours.push(contour);
  });
  const gap = plan.gap_cm;
  for (let i = 0; i < contours.length; i += 1) {
    for (let j = i + 1; j < contours.length; j += 1) {
      if (contours[i].length < 3 || contours[j].length < 3) continue;
      if (polygonsConflict(contours[i], contours[j], gap)) {
        violations.push({
          index: j,
          code: parsed[j].pieceCode ?? '?',
          reason: 'Chevauchement (ou écart insuffisant) avec une autre pièce.',
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

interface ParsedPlacement {
  pieceId: number;
  x: number;
  y: number;
  rotation: Rotation;
  pieceCode?: string;
}

function parsePlacementInput(raw: unknown): ParsedPlacement[] {
  if (!Array.isArray(raw)) {
    throw new ServiceError('Le placement doit être une liste de pièces.', 400);
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new ServiceError('Placement invalide.', 400);
    }
    const record = item as Record<string, unknown>;
    const pieceId = requireId(record.pieceId, 'La pièce');
    const x = Number(record.x);
    const y = Number(record.y);
    const rotation = Number(record.rotation ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new ServiceError(
        `Position invalide pour la pièce ${pieceId} (coordonnées en cm).`,
        400,
      );
    }
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new ServiceError(`Rotation invalide (${rotation}).`, 400);
    }
    const pieceCode = typeof record.code === 'string' ? record.code : undefined;
    return { pieceId, x, y, rotation: rotation as Rotation, pieceCode };
  });
}

function readRevisionId(inputJson: string | null): number | null {
  const value = Number(readPlanInputJson(inputJson).revisionId);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export { parsePlacementInput, readRevisionId };
export type { ParsedPlacement };
