import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { requireCoupe, requireId } from './common';
import { technicalCatalogue, requireTechnicalProduct } from './technical-catalogue';
import { geometryError, type Point } from '@/lib/coupe-geometry';

export type PatternPiecePoint = Point;
export interface PatternPiece {
  id: number; productId: number; category: 'adulte' | 'enfant'; pieceCode: string; pieceLabel: string;
  sizeId: number; sizeNom: string; version: string; points: Point[]; widthCm: number; heightCm: number;
  qtyMultiplier: number; grainDirection: 'along' | 'cross' | 'any'; allowedRotations: number[];
  seamAllowanceCm: number; isValidated: boolean; notes: string | null;
  revisionId: number; component: 'principal' | 'haut' | 'short'; seamIncluded: boolean; marks: Point[];
}

interface PatternRow {
  id: number; product_id: number; category: PatternPiece['category']; piece_code: string; piece_label: string;
  size_id: number; size_nom: string; version: string; geometry_json: string; width_cm: number; height_cm: number;
  qty_multiplier: number; grain_direction: PatternPiece['grainDirection']; allowed_rotations: string; seam_allowance_cm: number;
  is_validated: number; notes: string | null; revision_id: number; component: PatternPiece['component']; seam_included: number; marks_json: string;
}

function mapRow(row: PatternRow): PatternPiece {
  const parsed = JSON.parse(row.geometry_json) as { points: number[][] };
  const points = parsed.points.map(([x,y]) => ({ x,y }));
  const error = geometryError(points);
  if (error) throw new ServiceError(`Contour invalide « ${row.piece_label} » : ${error}`, 400);
  const rotations = JSON.parse(row.allowed_rotations) as number[];
  if (!Array.isArray(rotations) || !rotations.length || rotations.some((rotation) => ![0,90,180,270].includes(rotation))) throw new ServiceError(`Rotations invalides : ${row.piece_label}.`,400);
  return { id: row.id, productId: row.product_id, category: row.category, pieceCode: row.piece_code, pieceLabel: row.piece_label,
    sizeId: row.size_id, sizeNom: row.size_nom, version: row.version, points, widthCm: row.width_cm, heightCm: row.height_cm,
    qtyMultiplier: row.qty_multiplier, grainDirection: row.grain_direction, allowedRotations: rotations, seamAllowanceCm: row.seam_allowance_cm,
    isValidated: row.is_validated === 1, notes: row.notes, revisionId: row.revision_id, component: row.component, seamIncluded: row.seam_included === 1,
    marks: (JSON.parse(row.marks_json) as number[][]).map(([x,y]) => ({x,y})) };
}

const BASE_SELECT = 'SELECT pp.*,s.nom size_nom FROM pattern_pieces pp JOIN sizes s ON s.id=pp.size_id';

export function listMarkerProducts(actor: Actor) {
  return technicalCatalogue(actor).map((product) => ({ ...product, patternCount: (sessionsDb().prepare(`SELECT COUNT(*) total FROM pattern_pieces pp
    JOIN pattern_revisions r ON r.id=pp.revision_id WHERE r.product_id=? AND r.status='valide' AND pp.is_validated=1`).get(product.id) as {total: number}).total }));
}

export function getValidatedPatterns(actor: Actor, input: {
  productId: number; category?: string; sizeIds?: number[]; revisionIds?: number[]; modelName?: string; fabricRef?: string;
}): { items: PatternPiece[]; warnings: string[] } {
  requireCoupe(actor);
  const product = requireTechnicalProduct(actor, input.productId, input.sizeIds);
  if (input.category && input.category !== product.category) throw new ServiceError('Catégorie incompatible avec le produit.',400);
  const db = sessionsDb();
  const revisions = db.prepare(`SELECT id,size_id,model_name,fabric_ref FROM pattern_revisions WHERE product_id=? AND status='valide' ORDER BY id`)
    .all(product.id) as Array<{id: number; size_id: number; model_name: string; fabric_ref: string}>;
  const selected = revisions.filter((revision) => (!input.revisionIds || input.revisionIds.includes(revision.id)) &&
    (!input.modelName || revision.model_name === input.modelName) && (!input.fabricRef || revision.fabric_ref === input.fabricRef));
  const warnings: string[] = [];
  const ids: number[] = [];
  for (const sizeId of input.sizeIds ?? product.sizes.map((size) => size.id)) {
    const candidates = selected.filter((revision) => revision.size_id === sizeId);
    const label = product.sizes.find((size) => size.id === sizeId)?.nom ?? String(sizeId);
    if (candidates.length !== 1) {
      warnings.push(candidates.length ? `Taille ${label} : plusieurs modèles ou versions validés ; choisissez une révision précise.` : `Taille ${label} : aucun patron réel approuvé pour cette sélection. Les contours de démonstration sont exclus.`);
    } else ids.push(candidates[0].id);
  }
  if (input.revisionIds && (new Set(input.revisionIds).size !== input.revisionIds.length || input.revisionIds.some((id) => !ids.includes(id)))) {
    warnings.push('Révision non validée, incompatible, dupliquée ou étrangère à la sélection.');
  }
  const items = ids.length ? (db.prepare(`${BASE_SELECT} WHERE pp.revision_id IN (${ids.map(() => '?').join(',')}) AND pp.is_validated=1 ORDER BY s.display_order,pp.id`).all(...ids) as PatternRow[]).map(mapRow) : [];
  return {items,warnings};
}

export function listPatternsByProduct(actor: Actor, productId: number, category?: string) {
  return getValidatedPatterns(actor,{productId,category});
}

export function requirePatternOfProduct(db: Database.Database, patternId: number, productId: number): PatternRow {
  const row = db.prepare(`${BASE_SELECT} WHERE pp.id=? AND pp.product_id=?`).get(requireId(patternId,'Patron'),requireId(productId,'Produit')) as PatternRow | undefined;
  if (!row) throw new ServiceError('Patron introuvable pour ce produit.',400);
  return row;
}
