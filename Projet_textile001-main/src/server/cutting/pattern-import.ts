import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { GrainDirection, Point } from '@/lib/cutting/types';
import { validateContourDefects } from '@/lib/cutting/contour-validate';
import { assertCoupeWrite, requireId, requireText } from './common';
import { requireCatalogueProduct } from './catalogue';
import { requireValidatedFiche } from './fiches';
import {
  insertRevision,
  type RevisionItem,
  type RevisionPiece,
} from './patterns';
import type { PatternComponent } from './pattern-rules';

/**
 * Import JSON de contours vectoriels vérifiés (r1 import).
 * Chaque pièce est validée strictement avant acceptation : schéma,
 * unités (cm ou mm convertis), contour fermé de 3 points minimum,
 * dimensions cohérentes avec l'enveloppe, quantités et rotations
 * plausibles. Aucun contournement des contrôles de géométrie.
 */

const COMPONENTS: PatternComponent[] = ['principal', 'haut', 'short'];
const GRAINS: GrainDirection[] = ['along', 'cross', 'any'];

interface ImportPieceInput {
  code: string;
  label: string;
  component: string;
  qty: number;
  grainDirection: string;
  allowedRotations: number[];
  seamAllowanceCm: number;
  seamIncluded: boolean;
  required: boolean;
  points: Array<{ x: number; y: number }>;
}

function finiteNumber(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ServiceError(`Import : ${label} doit être numérique.`, 400);
  }
  return num;
}

function parseImportPoints(raw: unknown): Point[] {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new ServiceError(
      'Import : chaque contour doit comporter au moins 3 points.',
      400,
    );
  }
  const points: Point[] = raw.map((item, index) => {
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      return {
        x: finiteNumber(record.x, `point ${index + 1} (x)`),
        y: finiteNumber(record.y, `point ${index + 1} (y)`),
      };
    }
    throw new ServiceError(
      'Import : chaque point doit être un objet {x, y}.',
      400,
    );
  });
  return points;
}

function validateImportPiece(raw: unknown, index: number): Omit<RevisionPiece, 'id'> {
  if (typeof raw !== 'object' || raw === null) {
    throw new ServiceError(`Import : pièce ${index + 1} invalide.`, 400);
  }
  const input = raw as Record<string, unknown>;
  const code = requireText(input.code, `Import pièce ${index + 1} : code`, 60)
    .replace(/\s+/g, '_');
  const label = requireText(input.label, `Import pièce ${index + 1} : libellé`, 80);
  const component = COMPONENTS.includes(input.component as PatternComponent)
    ? (input.component as PatternComponent)
    : 'principal';
  const qty = Number(input.qty ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    throw new ServiceError(
      `Import : la quantité de « ${label} » doit être un entier entre 1 et 20.`,
      400,
    );
  }
  const grain = GRAINS.includes(input.grainDirection as GrainDirection)
    ? (input.grainDirection as GrainDirection)
    : 'along';
  const rotationsRaw = Array.isArray(input.allowedRotations)
    ? input.allowedRotations
    : [0, 180];
  const rotations = [...new Set(rotationsRaw.map((angle) => Number(angle)))]
    .filter((angle) => [0, 90, 180, 270].includes(angle) && Number.isInteger(angle))
    .sort((a, b) => a - b);
  if (rotations.length === 0) {
    throw new ServiceError(
      `Import : « ${label} » n'autorise aucune rotation valide.`,
      400,
    );
  }
  const seam = finiteNumber(input.seamAllowanceCm ?? 1, `marge de couture de « ${label} »`);
  if (seam < 0 || seam > 10) {
    throw new ServiceError(
      `Import : la marge de couture de « ${label} » doit être entre 0 et 10 cm.`,
      400,
    );
  }
  const points = parseImportPoints(input.points);
  const contourDefects = validateContourDefects(points);
  if (contourDefects.length > 0) {
    throw new ServiceError(
      `Import : contour de « ${label} » invalide — `
        + `${contourDefects.map((defect) => defect.message).join(' ; ')}.`,
      400,
    );
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || height <= 0) {
    throw new ServiceError(
      `Import : le contour de « ${label} » est aplati (dimension nulle).`,
      400,
    );
  }
  return {
    code,
    label,
    component,
    points,
    widthCm: width,
    heightCm: height,
    qty,
    grainDirection: grain,
    allowedRotations: rotations,
    seamAllowanceCm: seam,
    seamIncluded: input.seamIncluded === true,
    required: input.required !== false,
    status: 'configuree',
  };
}

export interface ImportRevisionInput {
  ficheId: number;
  sourceName: unknown;
  sourceUnit: 'cm' | 'mm';
  pieces: unknown;
}

/** Crée une révision brouillon depuis des contours importés vérifiés. */
export function importRevision(
  db: Database.Database,
  actor: Actor,
  input: ImportRevisionInput,
): RevisionItem {
  assertCoupeWrite(actor);
  const ficheId = requireId(input.ficheId, 'La fiche technique');
  const fiche = requireValidatedFiche(db, ficheId);
  const sourceName = requireText(input.sourceName, 'La source du patron', 120);
  const sourceUnit = input.sourceUnit === 'mm' ? 'mm' : 'cm';
  if (!Array.isArray(input.pieces) || input.pieces.length === 0) {
    throw new ServiceError('Import : au moins une pièce est requise.', 400);
  }
  const validated = input.pieces.map((raw, index) => {
    const piece = validateImportPiece(raw, index);
    if (sourceUnit === 'mm') {
      return {
        ...piece,
        points: piece.points.map((point) => ({ x: point.x / 10, y: point.y / 10 })),
        widthCm: piece.widthCm / 10,
        heightCm: piece.heightCm / 10,
      };
    }
    return piece;
  });
  const codes = new Set<string>();
  for (const piece of validated) {
    if (codes.has(piece.code)) {
      throw new ServiceError(
        `Import : code de pièce dupliqué « ${piece.code} ».`,
        400,
      );
    }
    codes.add(piece.code);
  }
  const catalogue = requireCatalogueProduct(db, fiche.productId);
  return insertRevision(
    db,
    actor,
    {
      productId: fiche.productId,
      sizeId: fiche.sizeId as number,
      modelName: `import-${catalogue.family}`,
      fabricRef: fiche.fabricType ?? 'tissu-non-precise',
      ficheId: fiche.id,
      ficheVersion: fiche.version,
      sourceName,
      sourceUnit,
    },
    validated,
  );
}
