import type { Box, Point } from './types';

/**
 * Aides du nesting BLF (pur, sans I/O) : index spatial grossier et
 * échantillonnage déterministe des valeurs candidates.
 */

/** Distance entre deux boîtes alignées sur les axes (0 si chevauchement). */
export function bboxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}

/** Valeurs uniques triées, échantillonnées uniformément si trop nombreuses. */
export function capValues(values: number[], max: number): number[] {
  const unique = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  if (unique.length <= max) return unique;
  const step = (unique.length - 1) / (max - 1);
  const sampled: number[] = [];
  for (let index = 0; index < max; index += 1) {
    sampled.push(unique[Math.round(index * step)]);
  }
  return sampled;
}

interface PlacedPieceLike { contour: Point[]; box: Box }

/** Pièce indexée, avec tampon de génération pour les requêtes. */
export interface StampedPiece extends PlacedPieceLike {
  queryStamp: number;
}

/**
 * Index spatial grossier (cellules de 60 cm) : limite la recherche de
 * voisins aux pièces proches du candidat, rendant le coût par pièce
 * quasi indépendant du nombre total de pièces placées. Les pièces sont
 * enregistrées dans toutes les cellules couvertes par leur enveloppe
 * élargie du gap ; les requêtes doivent donc aussi être élargies du
 * gap pour rester conservatives (aucun voisin manquant). Le
 * dédoublonnage des requêtes utilise un tampon de génération (aucune
 * allocation de Set). `remove` permet à l'amélioration locale de
 * libérer une pièce sans reconstruire l'index.
 */
const CELL_CM = 60;
export class PieceIndex {
  private readonly cells = new Map<number, StampedPiece[]>();
  private stamp = 0;

  private static key(cx: number, cy: number): number {
    return cx * 100000 + cy;
  }

  insert(piece: StampedPiece, gapCm: number): void {
    const x0 = Math.floor((piece.box.minX - gapCm) / CELL_CM);
    const x1 = Math.floor((piece.box.maxX + gapCm) / CELL_CM);
    const y0 = Math.floor((piece.box.minY - gapCm) / CELL_CM);
    const y1 = Math.floor((piece.box.maxY + gapCm) / CELL_CM);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = PieceIndex.key(cx, cy);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(piece);
        else this.cells.set(key, [piece]);
      }
    }
  }

  /** Retire la pièce de toutes les cellules qu'elle occupe. */
  remove(piece: StampedPiece, gapCm: number): void {
    const x0 = Math.floor((piece.box.minX - gapCm) / CELL_CM);
    const x1 = Math.floor((piece.box.maxX + gapCm) / CELL_CM);
    const y0 = Math.floor((piece.box.minY - gapCm) / CELL_CM);
    const y1 = Math.floor((piece.box.maxY + gapCm) / CELL_CM);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const bucket = this.cells.get(PieceIndex.key(cx, cy));
        if (!bucket) continue;
        const position = bucket.indexOf(piece);
        if (position >= 0) bucket.splice(position, 1);
      }
    }
  }

  /** Pièces dont l'enveloppe (élargie du gap) touche la zone donnée. */
  query(minX: number, minY: number, maxX: number, maxY: number): StampedPiece[] {
    const x0 = Math.floor(minX / CELL_CM);
    const x1 = Math.floor(maxX / CELL_CM);
    const y0 = Math.floor(minY / CELL_CM);
    const y1 = Math.floor(maxY / CELL_CM);
    const generation = ++this.stamp;
    const result: StampedPiece[] = [];
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const bucket = this.cells.get(PieceIndex.key(cx, cy));
        if (!bucket) continue;
        for (const piece of bucket) {
          if (piece.queryStamp === generation) continue;
          piece.queryStamp = generation;
          result.push(piece);
        }
      }
    }
    return result;
  }
}
