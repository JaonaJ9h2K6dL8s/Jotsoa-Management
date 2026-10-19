/**
 * Socle partagé du workflow des lots de coupe : types, chargement et
 * mapping des lots, anomalies et historique. Utilisé par les modules
 * de création, de transitions et de résultats.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { requireCoupe, requireId } from './common';
import type { LotStatus } from '@/types/coupe';

export interface LotWorkflowRow {
  id: number;
  code: string;
  orderId: number | null;
  orderCode: string | null;
  orderType: 'interne' | 'externe' | null;
  clientNom: string | null;
  productId: number;
  productNom: string;
  colorId: number | null;
  colorNom: string | null;
  totalPlannedQty: number;
  totalCutQty: number;
  status: LotStatus;
  rollId: number | null;
  rollCode: string | null;
  markerPlanId: number | null;
  coupeTableId: number | null;
  coupeTableNom: string | null;
  proposedLayers: number | null;
  proposedMatelasLengthCm: number | null;
  responsableId: number;
  responsableNom: string | null;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  validatedBy: number | null;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sizes: Array<{ sizeId: number; sizeNom: string; plannedQty: number; cutQty: number }>;
}

export interface LotCheckResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface LotAnomalyDTO {
  id: number;
  sizeId: number | null;
  sizeNom: string | null;
  type: string;
  qty: number;
  motif: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface LotExtras {
  anomalies: LotAnomalyDTO[];
  history: Array<{
    id: number;
    action: string;
    reason: string | null;
    actorNom: string | null;
    createdAt: string;
  }>;
}

export const SELECT_BASE = `
  SELECT l.*, p.nom product_nom, c.nom color_nom,
         u.nom || ' ' || u.prenom responsable_nom,
         ct.nom coupe_table_nom,
         r.code roll_code, o.code order_code, o.type order_type, o.client_nom
  FROM coupe_lots l
  JOIN products p ON p.id = l.product_id
  LEFT JOIN colors c ON c.id = l.color_id
  JOIN users u ON u.id = l.responsable_id
  LEFT JOIN coupe_tables ct ON ct.id = l.coupe_table_id
  LEFT JOIN coupe_rolls r ON r.id = l.roll_id
  LEFT JOIN orders o ON o.id = l.order_id
`;

export function mapLot(
  row: Record<string, unknown>,
  sizes: LotWorkflowRow['sizes'],
): LotWorkflowRow {
  return {
    id: Number(row.id),
    code: String(row.code),
    orderId: row.order_id as number | null,
    orderCode: row.order_code as string | null,
    orderType: row.order_type as LotWorkflowRow['orderType'],
    clientNom: row.client_nom as string | null,
    productId: Number(row.product_id),
    productNom: String(row.product_nom),
    colorId: row.color_id as number | null,
    colorNom: row.color_nom as string | null,
    totalPlannedQty: Number(row.total_planned_qty),
    totalCutQty: sizes.reduce((sum, s) => sum + s.cutQty, 0),
    status: String(row.status) as LotStatus,
    rollId: row.roll_id as number | null,
    rollCode: row.roll_code as string | null,
    markerPlanId: row.marker_plan_id as number | null,
    coupeTableId: row.coupe_table_id as number | null,
    coupeTableNom: row.coupe_table_nom as string | null,
    proposedLayers: row.proposed_layers as number | null,
    proposedMatelasLengthCm: row.proposed_matelas_length_cm as number | null,
    responsableId: Number(row.responsable_id),
    responsableNom: row.responsable_nom as string | null,
    notes: row.notes as string | null,
    startedAt: row.started_at as string | null,
    finishedAt: row.finished_at as string | null,
    validatedBy: row.validated_by as number | null,
    validatedAt: row.validated_at as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    sizes,
  };
}

export function loadSizes(
  db: ReturnType<typeof sessionsDb>,
  lotId: number,
): LotWorkflowRow['sizes'] {
  return db.prepare(`
    SELECT ls.size_id sizeId, s.nom sizeNom, ls.planned_qty plannedQty, ls.cut_qty cutQty
    FROM coupe_lot_sizes ls
    JOIN sizes s ON s.id = ls.size_id
    WHERE ls.lot_id = ?
    ORDER BY s.display_order
  `).all(lotId) as LotWorkflowRow['sizes'];
}

export function listLots(
  actor: Actor,
  filters?: { status?: string; search?: string },
): LotWorkflowRow[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters?.status) {
    where.push('l.status = ?');
    params.push(filters.status);
  }
  if (filters?.search) {
    where.push('(l.code LIKE ? OR p.nom LIKE ? OR o.code LIKE ? OR o.client_nom LIKE ?)');
    const like = `%${filters.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    params.push(like, like, like, like);
  }
  const sql = `${SELECT_BASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.created_at DESC`;
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => mapLot(row, loadSizes(db, Number(row.id))));
}

export function getLot(actor: Actor, lotId: number): LotWorkflowRow {
  requireCoupe(actor);
  const db = sessionsDb();
  const row = db.prepare(`${SELECT_BASE} WHERE l.id = ?`).get(requireId(lotId, 'Lot')) as Record<string, unknown> | undefined;
  if (!row) throw new ServiceError('Lot de coupe introuvable.', 404);
  return mapLot(row, loadSizes(db, Number(row.id)));
}

/** Anomalies déclarées et historique du lot (lecture seule). */
export function getLotExtras(actor: Actor, lotId: number): LotExtras {
  requireCoupe(actor);
  const db = sessionsDb();
  const id = requireId(lotId, 'Lot');
  const anomalies = (db.prepare(`
    SELECT a.id, a.size_id, s.nom AS size_nom, a.type, a.qty, a.motif,
           u.nom || ' ' || u.prenom AS created_by_name, a.created_at
    FROM coupe_lot_anomalies a
    LEFT JOIN sizes s ON s.id = a.size_id
    JOIN users u ON u.id = a.created_by
    WHERE a.lot_id = ? ORDER BY a.id DESC
  `).all(id) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    sizeId: row.size_id == null ? null : Number(row.size_id),
    sizeNom: (row.size_nom as string | null) ?? null,
    type: String(row.type),
    qty: Number(row.qty),
    motif: (row.motif as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
  const history = (db.prepare(`
    SELECT h.id, h.action, h.reason, u.nom || ' ' || u.prenom AS actor_nom, h.created_at
    FROM coupe_history h
    LEFT JOIN users u ON u.id = h.actor_id
    WHERE h.entity_type = 'coupe_lot' AND h.entity_id = ?
    ORDER BY h.id DESC LIMIT 100
  `).all(id) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    action: String(row.action),
    reason: (row.reason as string | null) ?? null,
    actorNom: (row.actor_nom as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
  return { anomalies, history };
}
