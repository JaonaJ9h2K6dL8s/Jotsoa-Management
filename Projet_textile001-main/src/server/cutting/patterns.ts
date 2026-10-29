import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { GrainDirection, Point, Rotation } from '@/lib/cutting/types';
import {
  assertCoupeAdmin,
  assertCoupeWrite,
  inTransaction,
  requireId,
  requireText,
} from './common';
import { requireCatalogueProduct } from './catalogue';
import { requireValidatedFiche } from './fiches';
import {
  buildFamilyPieces,
  isFamilyReady,
  RULES_VERSION,
  type FicheMesures,
  type PatternComponent,
} from './pattern-rules';

/**
 * Révisions de patrons (tables `pattern_revisions` / `pattern_pieces`).
 * - Génération : depuis une fiche technique VALIDÉE + règles de
 *   patronage versionnées (R2) → révision en brouillon, jamais
 *   validée automatiquement.
 * - Import JSON : contours vectoriels vérifiés, schéma strict.
 * - Validation : administrateur uniquement, exige toutes les pièces
 *   requises configurées. Les révisions validées sont immuables
 *   (triggers SQL) et ne sont jamais modifiées.
 * Le placement n'est accessible qu'aux révisions validées.
 */

export interface RevisionPiece {
  id: number;
  code: string;
  label: string;
  component: PatternComponent;
  points: Point[];
  widthCm: number;
  heightCm: number;
  qty: number;
  grainDirection: GrainDirection;
  allowedRotations: number[];
  seamAllowanceCm: number;
  seamIncluded: boolean;
  required: boolean;
  status: 'configuree' | 'incomplete';
}

export interface RevisionItem {
  id: number;
  productId: number;
  sizeId: number;
  modelName: string;
  fabricRef: string;
  version: number;
  ficheId: number;
  ficheVersion: number;
  sourceName: string;
  status: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  pieces: RevisionPiece[];
  unconfigured?: Array<{
    code: string;
    label: string;
    missingLabels: string[];
    required: boolean;
  }>;
  createdAt: string;
}

interface RevisionRow {
  id: number;
  product_id: number;
  size_id: number;
  model_name: string;
  fabric_ref: string;
  version: number;
  fiche_id: number;
  fiche_version: number;
  source_name: string;
  status: string;
  created_at: string;
}

interface PieceRow {
  id: number;
  piece_code: string;
  piece_label: string;
  component: string;
  geometry_json: string;
  width_cm: number;
  height_cm: number;
  qty_multiplier: number;
  grain_direction: string;
  allowed_rotations: string;
  seam_allowance_cm: number;
  seam_included: number;
  marks_json: string;
}

const COMPONENTS: PatternComponent[] = ['principal', 'haut', 'short'];
const GRAINS: GrainDirection[] = ['along', 'cross', 'any'];

/** Normalise un contour JSON : {points}, [[x,y]…] ou [{x,y}…]. */
export function parsePoints(raw: string): Point[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'object' && parsed !== null && 'points' in parsed) {
    return parsePoints(JSON.stringify((parsed as { points: unknown }).points));
  }
  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new ServiceError('Contour de pièce invalide (3 points minimum).', 409);
  }
  return (parsed as unknown[]).map((item) => {
    if (Array.isArray(item) && item.length === 2) {
      return { x: Number(item[0]), y: Number(item[1]) };
    }
    const point = item as { x: unknown; y: unknown };
    return { x: Number(point.x), y: Number(point.y) };
  });
}

function toRevisionPiece(row: PieceRow): RevisionPiece {
  let marks: { required?: unknown } = {};
  try {
    marks = JSON.parse(row.marks_json) as { required?: unknown };
  } catch {
    marks = {};
  }
  return {
    id: row.id,
    code: row.piece_code,
    label: row.piece_label,
    component: row.component as PatternComponent,
    points: parsePoints(row.geometry_json),
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    qty: row.qty_multiplier,
    grainDirection: row.grain_direction as GrainDirection,
    allowedRotations: JSON.parse(row.allowed_rotations) as number[],
    seamAllowanceCm: row.seam_allowance_cm,
    seamIncluded: row.seam_included === 1,
    required: marks.required !== false,
    status: 'configuree',
  };
}

export function getRevision(
  db: Database.Database,
  revisionId: number,
): RevisionItem {
  const row = db
    .prepare('SELECT * FROM pattern_revisions WHERE id = ?')
    .get(revisionId) as RevisionRow | undefined;
  if (!row) throw new ServiceError('Révision de patron introuvable.', 404);
  const pieceRows = db
    .prepare(
      'SELECT * FROM pattern_pieces WHERE revision_id = ? ORDER BY id',
    )
    .all(revisionId) as PieceRow[];
  return {
    id: row.id,
    productId: row.product_id,
    sizeId: row.size_id,
    modelName: row.model_name,
    fabricRef: row.fabric_ref,
    version: row.version,
    ficheId: row.fiche_id,
    ficheVersion: row.fiche_version,
    sourceName: row.source_name,
    status: row.status as RevisionItem['status'],
    pieces: pieceRows.map(toRevisionPiece),
    createdAt: row.created_at,
  };
}

export function listRevisions(
  db: Database.Database,
  filter: { productId?: number; sizeId?: number; status?: string } = {},
): RevisionItem[] {
  const conditions: string[] = [];
  const params: (number | string)[] = [];
  if (filter.productId) {
    conditions.push('product_id = ?');
    params.push(filter.productId);
  }
  if (filter.sizeId) {
    conditions.push('size_id = ?');
    params.push(filter.sizeId);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id FROM pattern_revisions ${where} ORDER BY id DESC`,
    )
    .all(...params) as { id: number }[];
  return rows.map((row) => getRevision(db, row.id));
}

/** Révision VALIDÉE exigée pour tout placement (plan de coupe). */
export function requireValidatedRevision(
  db: Database.Database,
  revisionId: number,
): RevisionItem {
  const revision = getRevision(db, revisionId);
  if (revision.status !== 'valide') {
    throw new ServiceError(
      'Seule une révision de patron validée peut être placée sur la table.',
      409,
    );
  }
  return revision;
}

function nextRevisionVersion(
  db: Database.Database,
  row: { product_id: number; size_id: number; model_name: string; fabric_ref: string },
): number {
  const result = db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM pattern_revisions
        WHERE product_id = ? AND size_id = ? AND model_name = ? AND fabric_ref = ?`,
    )
    .get(row.product_id, row.size_id, row.model_name, row.fabric_ref) as {
    next: number;
  };
  return result.next;
}

export function insertRevision(
  db: Database.Database,
  actor: Actor,
  input: {
    productId: number;
    sizeId: number;
    modelName: string;
    fabricRef: string;
    ficheId: number;
    ficheVersion: number;
    sourceName: string;
    sourceUnit: 'cm' | 'mm';
  },
  pieces: Omit<RevisionPiece, 'id'>[],
): RevisionItem {
  return inTransaction(db, () => {
    const version = nextRevisionVersion(db, {
      product_id: input.productId,
      size_id: input.sizeId,
      model_name: input.modelName,
      fabric_ref: input.fabricRef,
    });
    const result = db
      .prepare(
        `INSERT INTO pattern_revisions
           (product_id, size_id, model_name, fabric_ref, version, fiche_id,
            fiche_version, source_name, source_unit, scale_verified, status,
            created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'brouillon', ?)`,
      )
      .run(
        input.productId,
        input.sizeId,
        input.modelName,
        input.fabricRef,
        version,
        input.ficheId,
        input.ficheVersion,
        input.sourceName,
        input.sourceUnit,
        actor.id,
      );
    const revisionId = Number(result.lastInsertRowid);
    const insertPiece = db.prepare(
      `INSERT INTO pattern_pieces
         (product_id, category, piece_code, piece_label, size_id, version,
          geometry_json, width_cm, height_cm, qty_multiplier, grain_direction,
          allowed_rotations, seam_allowance_cm, is_validated, revision_id,
          component, seam_included, marks_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    );
    const catalogue = requireCatalogueProduct(db, input.productId);
    for (const piece of pieces) {
      insertPiece.run(
        input.productId,
        catalogue.category,
        piece.code,
        piece.label,
        input.sizeId,
        `rev-${revisionId}`,
        JSON.stringify({ points: piece.points }),
        piece.widthCm,
        piece.heightCm,
        piece.qty,
        piece.grainDirection,
        JSON.stringify(piece.allowedRotations),
        piece.seamAllowanceCm,
        revisionId,
        piece.component,
        piece.seamIncluded ? 1 : 0,
        JSON.stringify({ required: piece.required }),
      );
    }
    return getRevision(db, revisionId);
  });
}

/** Génération : fiche validée + règles de patronage versionnées (R2). */
export function generateRevision(
  db: Database.Database,
  actor: Actor,
  ficheId: number,
): RevisionItem {
  assertCoupeWrite(actor);
  const fiche = requireValidatedFiche(db, ficheId);
  if (fiche.sizeId === null) {
    throw new ServiceError(
      'La fiche technique doit être rattachée à une taille pour produire un patron.',
      409,
    );
  }
  const catalogue = requireCatalogueProduct(db, fiche.productId);
  const built = buildFamilyPieces(catalogue.family, fiche.mesures);
  if (built.length === 0) {
    throw new ServiceError(
      `Aucune règle de patronage définie pour la famille « ${catalogue.family} ».`,
      409,
    );
  }
  // Une pièce incomplète (CHECK width_cm > 0) n'est jamais insérée :
  // elle est signalée « à configurer » et bloquera la validation.
  const configured = built.filter((piece) => piece.status === 'configuree');
  if (configured.length === 0) {
    throw new ServiceError(
      'Aucune pièce configurable : la fiche ne couvre pas les mesures requises.',
      409,
    );
  }
  const pieces: Omit<RevisionPiece, 'id'>[] = configured.map((piece) => ({
    code: piece.code,
    label: piece.label,
    component: piece.component,
    points: piece.points ?? [],
    widthCm: piece.widthCm ?? 0,
    heightCm: piece.heightCm ?? 0,
    qty: piece.qty,
    grainDirection: piece.grainDirection,
    allowedRotations: piece.allowedRotations,
    seamAllowanceCm: piece.seamAllowanceCm,
    seamIncluded: piece.seamIncluded,
    required: piece.required,
    status: piece.status,
  }));
  const revision = insertRevision(
    db,
    actor,
    {
      productId: fiche.productId,
      sizeId: fiche.sizeId,
      modelName: `${catalogue.family}-${RULES_VERSION}`,
      fabricRef: fiche.fabricType ?? 'tissu-non-precise',
      ficheId: fiche.id,
      ficheVersion: fiche.version,
      sourceName: `Règles de patronage ${RULES_VERSION} + fiche #${fiche.id}`,
      sourceUnit: 'cm',
    },
    pieces,
  );
  return {
    ...revision,
    unconfigured: built
      .filter((piece) => piece.status === 'incomplete')
      .map((piece) => ({
        code: piece.code,
        label: piece.label,
        missingLabels: piece.missingLabels,
        required: piece.required,
      })),
  };
}

export { isFamilyReady };
export type { FicheMesures };
