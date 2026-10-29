import type Database from 'better-sqlite3';
import type { Point } from '@/lib/cutting/types';
import { ServiceError } from '@/server/api/service-error';
import { requireId } from './common';
import { requireCatalogueProduct } from './catalogue';
import { buildFamilyPieces, PATTERN_FAMILIES, type PatternFamily } from './pattern-rules';
import { buildShapedContour } from './pattern-shapes';

export interface PatternDemoPiece {
  code: string;
  label: string;
  qty: number;
  required: boolean;
  outline: Point[];
}

export interface PatternDemo {
  family: PatternFamily;
  pieces: PatternDemoPiece[];
}

function aspectFor(code: string): [number, number] {
  const base = code.replace(/^(haut_|short_)/, '');
  if (base === 'devant' || base === 'dos') return [72, 100];
  if (base.startsWith('manche_')) return [100, 72];
  if (['devant_gauche', 'devant_droite', 'dos_gauche', 'dos_droite'].includes(base)) return [60, 100];
  if (base === 'poche' || base.startsWith('poche_')) return [68, 58];
  if (base === 'col' || base === 'ceinture') return [100, 34];
  return [100, 36];
}

function normalizeOutline(points: Point[]): Point[] {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = 80 / Math.max(width, height);
  const offsetX = (100 - width * scale) / 2;
  const offsetY = (100 - height * scale) / 2;
  return points.map((point) => ({
    x: Math.round((offsetX + (point.x - minX) * scale) * 100) / 100,
    y: Math.round((offsetY + (point.y - minY) * scale) * 100) / 100,
  }));
}

export function previewPatternForProduct(db: Database.Database, rawProductId: unknown): PatternDemo {
  const product = requireCatalogueProduct(db, requireId(rawProductId, 'Le produit'));
  return buildPatternDemo(product.family);
}

export function buildPatternDemo(familyName: string): PatternDemo {
  if (!(PATTERN_FAMILIES as string[]).includes(familyName)) {
    throw new ServiceError(`Famille de démonstration inconnue : ${familyName}.`, 400);
  }
  const family = familyName as PatternFamily;
  const pieces = buildFamilyPieces(family, {}).map((piece) => {
    const [shapeWidth, shapeHeight] = aspectFor(piece.code);
    const outline = buildShapedContour(family, piece.code, shapeWidth, shapeHeight);
    return {
      code: piece.code,
      label: piece.label,
      qty: piece.qty,
      required: piece.required,
      outline: normalizeOutline(outline),
    };
  });
  if (pieces.length === 0) {
    throw new ServiceError(`Aucun modèle de démonstration pour « ${family} ».`, 400);
  }
  return { family, pieces };
}
