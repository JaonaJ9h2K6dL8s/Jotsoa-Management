import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { assertCoupeWrite, requireId } from './common';

/**
 * Image de patron générée automatiquement depuis les contours VALIDÉS
 * (table `pattern_pieces`, remplis par les règles R2 ou l'import JSON).
 * Aucune mesure n'est inventée : le rendu reproduit exactement les
 * polygones persistés, mis côte à côte avec leur code, leurs
 * dimensions et leur quantité. Le rendu est déterministe et recalculé
 * à la demande — rien n'est stocké, rien n'est modifié.
 */

export interface PatternPreview {
  revisionId: number;
  modelName: string;
  pieceCount: number;
  svg: string;
}

interface PreviewPiece {
  code: string;
  component: string | null;
  width: number;
  height: number;
  qty: number;
  points: Array<{ x: number; y: number }>;
}

const MAX_ROW_WIDTH_PX = 860;
const GAP_PX = 26;
const SCALE_PX_PER_CM = 2.2;
const LABEL_H_PX = 30;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function bboxOf(points: Array<{ x: number; y: number }>): {
  minX: number; minY: number; w: number; h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function pathOf(points: Array<{ x: number; y: number }>,
  offset: { x: number; y: number }, bbox: { minX: number; minY: number },
  scale: number): string {
  return `${points.map((point, index) => {
    const px = (point.x - bbox.minX) * scale + offset.x;
    const py = (point.y - bbox.minY) * scale + offset.y;
    return `${index === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ')} Z`;
}

/** Image SVG du patron d'une révision VALIDÉE (chef de coupe). */
export function renderPatternPreview(
  db: Database.Database,
  actor: Actor,
  rawRevisionId: unknown,
): PatternPreview {
  assertCoupeWrite(actor);
  const revisionId = requireId(rawRevisionId, 'La révision de patron');
  const revision = db
    .prepare(
      `SELECT pr.id, pr.status, pr.version, p.nom AS model_name
         FROM pattern_revisions pr
         JOIN fiches_techniques f ON f.id = pr.fiche_id
         JOIN products p ON p.id = f.product_id
        WHERE pr.id = ?`,
    )
    .get(revisionId) as { id: number; status: string; version: number; model_name: string } | undefined;
  if (!revision) {
    throw new ServiceError('Révision de patron introuvable.', 404);
  }
  if (revision.status !== 'valide') {
    throw new ServiceError(
      'Image disponible uniquement pour un patron validé.',
      409,
    );
  }
  const rows = db
    .prepare(
      `SELECT piece_code, component, width_cm, height_cm, qty_multiplier, geometry_json
         FROM pattern_pieces WHERE revision_id = ? ORDER BY id`,
    )
    .all(revisionId) as Array<{
    piece_code: string; component: string | null; width_cm: number;
    height_cm: number; qty_multiplier: number; geometry_json: string;
  }>;
  if (rows.length === 0) {
    throw new ServiceError('Aucune pièce persistée pour cette révision.', 409);
  }
  const pieces: PreviewPiece[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.geometry_json) as { points?: Array<{ x: number; y: number }> };
    const points = parsed?.points;
    if (!Array.isArray(points) || points.length < 3) continue;
    pieces.push({
      code: row.piece_code,
      component: row.component,
      width: row.width_cm,
      height: row.height_cm,
      qty: Math.max(1, Math.round(row.qty_multiplier)),
      points,
    });
  }
  if (pieces.length === 0) {
    throw new ServiceError(
      'Contours vectoriels absents : image non générable.',
      409,
    );
  }
  // Échelle uniforme : la plus grande pièce doit tenir en largeur.
  const maxPieceWidthCm = Math.max(...pieces.map((piece) => piece.width));
  const maxPieceHeightCm = Math.max(...pieces.map((piece) => piece.height));
  const scale = Math.min(
    SCALE_PX_PER_CM,
    (MAX_ROW_WIDTH_PX - GAP_PX) / Math.max(1, maxPieceWidthCm),
    220 / Math.max(1, maxPieceHeightCm),
  );
  // Rangées simples (shelf) : pièces classées par hauteur décroissante.
  const ordered = [...pieces].sort((a, b) => b.height - a.height);
  const placed: Array<{ piece: PreviewPiece; x: number; y: number;
    bbox: ReturnType<typeof bboxOf> }> = [];
  let cursorX = GAP_PX;
  let cursorY = LABEL_H_PX + 8;
  let rowHeight = 0;
  for (const piece of ordered) {
    const bbox = bboxOf(piece.points);
    const widthPx = bbox.w * scale;
    const heightPx = bbox.h * scale;
    if (cursorX + widthPx > MAX_ROW_WIDTH_PX && cursorX > GAP_PX) {
      cursorX = GAP_PX;
      cursorY += rowHeight + LABEL_H_PX + 14;
      rowHeight = 0;
    }
    placed.push({ piece, x: cursorX, y: cursorY, bbox });
    cursorX += widthPx + GAP_PX;
    rowHeight = Math.max(rowHeight, heightPx);
  }
  const totalWidth = MAX_ROW_WIDTH_PX + GAP_PX;
  const totalHeight = cursorY + rowHeight + LABEL_H_PX + 16;
  const title = escapeXml(`${revision.model_name} — patron v${revision.version} (#${revision.id})`);
  const body: string[] = [];
  for (const item of placed) {
    const { piece, x, y, bbox } = item;
    body.push(
      `<path d="${pathOf(piece.points, { x, y }, bbox, scale)}" `
      + `fill="rgba(59,130,246,0.14)" stroke="#1d4ed8" stroke-width="1.4"/>`,
    );
    const dims = `${piece.width.toFixed(0)}×${piece.height.toFixed(0)} cm`;
    const label = escapeXml(`${piece.code}${piece.qty > 1 ? ` ×${piece.qty}` : ''}`);
    body.push(
      `<text x="${x.toFixed(1)}" y="${(y + bbox.h * scale + 14).toFixed(1)}" `
      + `font-size="11" fill="#334155" font-family="sans-serif">${label} · ${dims}</text>`,
    );
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" `
    + `viewBox="0 0 ${totalWidth} ${totalHeight}" role="img">`,
    `<text x="${GAP_PX}" y="18" font-size="13" font-weight="bold" fill="#0f172a" `
    + `font-family="sans-serif">${title}</text>`,
    `<rect x="0.7" y="0.7" width="${totalWidth - 1.4}" height="${totalHeight - 1.4}" `
    + `fill="#f8fafc" stroke="#cbd5e1"/>`,
    ...body,
    '</svg>',
  ].join('');
  return {
    revisionId, modelName: revision.model_name,
    pieceCount: pieces.length, svg,
  };
}
