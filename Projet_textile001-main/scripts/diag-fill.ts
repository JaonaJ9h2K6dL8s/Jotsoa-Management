/* Diagnostic remplissage matelas — reproduit plans-optimize.ts hors UI. */
import Database from 'better-sqlite3';
import { optimizePlacementBest } from '../src/lib/cutting/best-placement';
import { fillMatelas } from '../src/lib/cutting/fill-matelas';
import { computeMetrics } from '../src/lib/cutting/optimizer';
import { validateCandidate } from '../src/lib/cutting/nesting-validate';
import type { OptimizerPiece } from '../src/lib/cutting/optimizer';

const DB_PATH = process.argv[2]
  ?? 'V1_jotsoa/win-unpacked/resources/app/.next/standalone/database/jo-management.db';
const PLAN_ID = Number(process.argv[3] ?? 0);

function parsePoints(raw: string): { x: number; y: number }[] {
  const parsed: unknown = JSON.parse(raw);
  const list = !Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null && 'points' in parsed
    ? (parsed as { points: unknown }).points
    : parsed;
  if (!Array.isArray(list)) throw new Error('contour invalide');
  return list.map((item: unknown) => {
    if (Array.isArray(item)) return { x: Number(item[0]), y: Number(item[1]) };
    const p = item as { x: unknown; y: unknown };
    return { x: Number(p.x), y: Number(p.y) };
  });
}

const db = new Database(DB_PATH, { readonly: true });
const plan = (PLAN_ID
  ? db.prepare('SELECT * FROM marker_plans WHERE id = ?').get(PLAN_ID)
  : db.prepare('SELECT * FROM marker_plans ORDER BY id DESC LIMIT 1').get()) as {
  id: number; input_json: string; usable_width_cm: number;
  matelas_length_cm: number; gap_cm: number; layers: number; status: string;
};
console.log(`Plan #${plan.id} — statut ${plan.status} — matelas ${plan.matelas_length_cm} cm, largeur utile ${plan.usable_width_cm} cm, gap ${plan.gap_cm}, couches ${plan.layers}`);

const input = JSON.parse(plan.input_json || '{}') as { revisionId?: number };
const revisionId = input.revisionId ?? 0;
const rev = db.prepare('SELECT * FROM pattern_revisions WHERE id = ?').get(revisionId) as { model_name: string } | undefined;
console.log(`Révision #${revisionId} (${rev?.model_name ?? 'introuvable'})`);

const pieceRows = db.prepare('SELECT * FROM pattern_pieces WHERE revision_id = ? ORDER BY id').all(revisionId) as Array<{
  id: number; piece_code: string; piece_label: string; geometry_json: string;
  qty_multiplier: number; grain_direction: string; allowed_rotations: string;
}>;
const pieces: OptimizerPiece[] = pieceRows.map((row) => ({
  id: row.id,
  code: row.piece_code,
  label: row.piece_label,
  points: parsePoints(row.geometry_json),
  qty: row.qty_multiplier,
  grainDirection: row.grain_direction as OptimizerPiece['grainDirection'],
  allowedRotations: JSON.parse(row.allowed_rotations) as number[],
  status: 'configuree',
}));
console.log('Pièces du patron :', pieces.map((p) => `${p.label} ×${p.qty}`).join(', '));
const piecesPerSet = pieces.reduce((s, p) => s + p.qty, 0);
console.log(`Pièces par jeu : ${piecesPerSet}`);

const optimizerInput = {
  usableWidthCm: plan.usable_width_cm,
  maxLengthCm: plan.matelas_length_cm,
  gapCm: plan.gap_cm,
  pieces,
};

const single = optimizePlacementBest(optimizerInput);
const singleMaxY = single.placements.reduce(
  (max, pl) => Math.max(max, ...pl.points.map((pt) => pt.y)), 0,
);
console.log(`\n[1] Un jeu seul : ${single.placements.length} pièces, longueur (axe Y) ${singleMaxY.toFixed(1)} cm (méthode ${single.method})`);

const fill = fillMatelas(optimizerInput);
console.log(`[2] Remplissage jeu par jeu (${fill.capacitySets} jeux complets, ${fill.result.computeMs ?? 0} ms) :`);
for (const attempt of fill.attempts.slice(-5)) {
  console.log(
    `    - jeu ${attempt.sets} : ${attempt.placed} pièces cumulées, `
    + `longueur ${attempt.lengthCm.toFixed(0)}/${plan.matelas_length_cm} cm`,
  );
}
const capacitySets = fill.capacitySets;
const trimmed = capacitySets >= 1 ? fill.result.placements : [];
const maxX = trimmed.length > 0
  ? trimmed.reduce((m, pl) => Math.max(m, ...pl.points.map((pt) => pt.y)), 0)
  : 0;
const metrics = computeMetrics(
  trimmed.map((pl) => pl.points),
  plan.usable_width_cm,
  trimmed.length,
  0,
);
const defects = validateCandidate(
  { ...optimizerInput, pieces: fill.scaledPieces },
  { ...fill.result, placements: trimmed },
);
console.log(`[3] Jeux complets retenus : ${capacitySets}`);
console.log(`[4] Longueur réellement occupée : ${maxX.toFixed(1)} cm / ${plan.matelas_length_cm} cm`);
console.log(`[4b] Métriques : consommé ${metrics.consumedAreaM2} m², pièces ${metrics.piecesAreaM2} m², chutes ${metrics.wasteAreaM2} m², utilisation ${metrics.utilizationPct} %`);
console.log(`[4c] Validation géométrique : ${defects.length === 0 ? 'OK (aucun défaut)' : `${defects.length} DÉFAUT(S) : ${defects.slice(0, 3).map((d) => d.message).join(' ; ')}`}`);
console.log(`[5] Production : ${capacitySets} jeux × ${plan.layers} couche(s) = ${capacitySets * plan.layers} vêtements, ${capacitySets * plan.layers * piecesPerSet} pièces`);

// [6] Diagnostic géométrique fin : bboxes, aires, recouvrement par grille.
function bbox(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}
console.log('\n[6] Bboxes des pièces du patron (cm) :');
for (const piece of pieces) {
  const b = bbox(piece.points);
  const area = Math.abs(piece.points.reduce((s, a, i) => {
    const b2 = piece.points[(i + 1) % piece.points.length];
    return s + a.x * b2.y - b2.x * a.y;
  }, 0)) / 2;
  console.log(
    `    - ${piece.label}: ${piece.points.length} pts, `
    + `x ${b.minX.toFixed(1)}→${b.maxX.toFixed(1)} (l=${(b.maxX - b.minX).toFixed(1)}), `
    + `y ${b.minY.toFixed(1)}→${b.maxY.toFixed(1)} (h=${(b.maxY - b.minY).toFixed(1)}), `
    + `aire ${area.toFixed(0)} cm²`,
  );
}
if (trimmed.length > 0) {
  const placedArea = trimmed.reduce((s, pl) => {
    const pts = pl.points;
    return s + Math.abs(pts.reduce((acc, a, i) => {
      const b2 = pts[(i + 1) % pts.length];
      return acc + a.x * b2.y - b2.x * a.y;
    }, 0)) / 2;
  }, 0);
  const gb = bbox(trimmed.flatMap((pl) => pl.points));
  console.log(`[6b] Placements trimmed : ${trimmed.length} pièces, bbox globale x ${gb.minX.toFixed(1)}→${gb.maxX.toFixed(1)}, y ${gb.minY.toFixed(1)}→${gb.maxY.toFixed(1)}`);
  console.log(`[6c] Somme aires placées : ${(placedArea / 10_000).toFixed(3)} m² ; aire bbox : ${(((gb.maxX - gb.minX) * (gb.maxY - gb.minY)) / 10_000).toFixed(3)} m²`);

  // Grille 1 cm : détecte les recouvrements (cellules couvertes ≥ 2 fois).
  const STEP = 1;
  const covered = new Map<number, number>();
  function pointInPoly(px: number, py: number, pts: { x: number; y: number }[]) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x; const yi = pts[i].y;
      const xj = pts[j].x; const yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  for (const pl of trimmed) {
    const b = bbox(pl.points);
    for (let gx = Math.floor(b.minX); gx <= Math.ceil(b.maxX); gx += STEP) {
      for (let gy = Math.floor(b.minY); gy <= Math.ceil(b.maxY); gy += STEP) {
        if (pointInPoly(gx, gy, pl.points)) {
          const key = gx * 100_000 + gy;
          covered.set(key, (covered.get(key) ?? 0) + 1);
        }
      }
    }
  }
  let union = 0; let overlap = 0;
  for (const count of covered.values()) {
    union += 1;
    if (count > 1) overlap += 1;
  }
  console.log(`[6d] Grille 1 cm : union ${union} cm², recouvrement ${overlap} cm² (${((overlap / Math.max(union, 1)) * 100).toFixed(1)} %)`);
}
db.close();
