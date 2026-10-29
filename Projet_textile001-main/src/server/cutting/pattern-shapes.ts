import type { Point } from '@/lib/cutting/types';

/**
 * Construction des contours R2 (pur — aucun I/O).
 *
 * Chaque constructeur reçoit les dimensions de coupe EXACTES issues de
 * la fiche validée (largeur/hauteur déjà augmentées des marges de
 * couture) et retourne un contour vectoriel fermé dont l'enveloppe
 * (bounding box, sommets uniquement) est exactement [0..largeur] ×
 * [0..hauteur]. Les dimensions de coupe ne changent donc jamais :
 * seules les formes des bords deviennent réalistes — épaules inclinées,
 * encolure et emmanchures courbes, côtés légèrement cintrés, calotte de
 * manche haute, bande « os » de col, fourche et fourche couture d'entrejambe
 * incurvées, bas de jambe resserré, poche au fond arrondi.
 *
 * Ratios de construction (règles de patronage versionnées R2) :
 * ce sont des règles de tracé explicites entre les mesures validées,
 * jamais des mesures inventées.
 */

/** Point d'épaule (emmanchure) : inset depuis le bord du torse. */
const SHOULDER_TIP_RATIO = 0.1;
/** Demi-largeur de l'encolure (depuis le centre). */
const NECK_HALF_RATIO = 0.3;
/** Pente d'épaule : descente du point d'épaule vs bord d'encolure. */
const SHOULDER_SLOPE_RATIO = 0.035;
/** Profondeur d'emmanchure en fraction de la longueur du torse. */
const ARMHOLE_DEPTH_RATIO = 0.34;
/** Baisse d'encolure (devant / dos) en fraction de la longueur. */
const NECK_DROP_FRONT_RATIO = 0.09;
const NECK_DROP_BACK_RATIO = 0.03;
/** Hauteur de calotte de manche en fraction de la longueur de manche. */
const SLEEVE_CAP_RATIO = 0.3;
/** Resserrage du bas de manche en fraction de la largeur. */
const SLEEVE_HEM_INSET_RATIO = 0.1;
/** Incurvation des bandes (col, ceinture) : flèche du bord supérieur. */
const BAND_DIP_RATIO = 0.85;
/** Position de la fourche (entrejambe) sur la largeur de la jambe. */
const CROTCH_X_RATIO = 0.42;
/** Profondeur de fourche en fraction de la longueur de la jambe. */
const CROTCH_Y_RATIO = 0.3;
/** Resserrage du bas de jambe : short vs jogging. */
export const SHORT_TAPER_RATIO = 0.05;
export const JOGGING_TAPER_RATIO = 0.12;
/** Étroitesse du bas de jambe côté entrejambe (short vs jogging). */
const SHORT_HEM_INNER_RATIO = 0.55;
const JOGGING_HEM_INNER_RATIO = 0.35;
/** Étroitesse du bas de jambe côté couture extérieure. */
const SHORT_HEM_OUTER_RATIO = 0.04;
const JOGGING_HEM_OUTER_RATIO = 0.1;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Échantillonne une courbe quadratrice de p0 (exclu) vers p1. */
function pushQuad(
  pts: Point[],
  p0: Point,
  control: Point,
  p1: Point,
  segments: number,
  skipEnd = false,
): void {
  const last = skipEnd ? segments - 1 : segments;
  for (let index = 1; index <= last; index += 1) {
    const t = index / segments;
    const mt = 1 - t;
    pts.push({
      x: round2(mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x),
      y: round2(mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y),
    });
  }
}

function rectContour(w: number, h: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: round2(w), y: 0 },
    { x: round2(w), y: round2(h) },
    { x: 0, y: round2(h) },
  ];
}

/**
 * Devant / dos de torse : épaules inclinées, encolure incurvée
 * (creusée selon neckDropCm), emmanchures concaves, côtés faiblement
 * cintrés, ourlet droit — silhouette de t-shirt réel.
 */
export function torsoContour(w: number, h: number, neckDropCm: number): Point[] {
  const tipX = round2(w * SHOULDER_TIP_RATIO);
  const neckX = round2(w * NECK_HALF_RATIO);
  const slopeY = round2(Math.max(0.5, h * SHOULDER_SLOPE_RATIO));
  const pitY = round2(h * ARMHOLE_DEPTH_RATIO);
  const drop = round2(Math.max(0, Math.min(neckDropCm, pitY - 1)));
  const pts: Point[] = [];
  pts.push({ x: neckX, y: 0 });
  pushQuad(pts, { x: neckX, y: 0 }, { x: w / 2, y: 2 * drop }, { x: w - neckX, y: 0 }, 10);
  pts.push({ x: w - tipX, y: slopeY });
  pushQuad(pts, { x: w - tipX, y: slopeY }, { x: w - tipX, y: pitY * 0.72 }, { x: w, y: pitY }, 8);
  pushQuad(pts, { x: w, y: pitY }, { x: round2(w * 0.985), y: (pitY + h) / 2 }, { x: w, y: h }, 6);
  pts.push({ x: 0, y: round2(h) });
  pushQuad(pts, { x: 0, y: h }, { x: round2(w * 0.015), y: (pitY + h) / 2 }, { x: 0, y: pitY }, 6);
  pushQuad(pts, { x: 0, y: pitY }, { x: tipX, y: pitY * 0.72 }, { x: tipX, y: slopeY }, 8);
  pushQuad(
    pts, { x: tipX, y: slopeY }, { x: tipX * 0.55, y: slopeY * 0.4 },
    { x: neckX, y: 0 }, 6, true,
  );
  return pts;
}

/**
 * Manche : calotte haute convexe (deux arcs), emmanchures/side légèrement
 * concaves, bas resserré, ourlet droit.
 */
export function sleeveContour(w: number, h: number): Point[] {
  const capY = round2(h * SLEEVE_CAP_RATIO);
  const hemInset = round2(w * SLEEVE_HEM_INSET_RATIO);
  const underY = round2(capY * 0.9);
  const pts: Point[] = [];
  pts.push({ x: 0, y: underY });
  pushQuad(pts, { x: 0, y: underY }, { x: w * 0.22, y: capY * 0.18 }, { x: w / 2, y: 0 }, 8);
  pushQuad(pts, { x: w / 2, y: 0 }, { x: w * 0.78, y: capY * 0.18 }, { x: w, y: underY }, 8);
  pushQuad(
    pts, { x: w, y: underY },
    { x: w, y: (underY + h) / 2 }, { x: w - hemInset, y: h }, 6,
  );
  pts.push({ x: hemInset, y: round2(h) });
  pushQuad(
    pts, { x: hemInset, y: h }, { x: 0, y: (underY + h) / 2 },
    { x: 0, y: underY }, 6, true,
  );
  return pts;
}

/**
 * Bande « os » incurvée (col, ceinture) : bord supérieur très courbe,
 * bord inférieur suivant partiellement la courbe (bande plus fine au
 * milieu), extrémités droites.
 */
export function bandContour(w: number, h: number): Point[] {
  const dip = round2(h * BAND_DIP_RATIO);
  const pts: Point[] = [];
  pts.push({ x: 0, y: 0 });
  pushQuad(pts, { x: 0, y: 0 }, { x: w / 2, y: dip }, { x: w, y: 0 }, 10);
  pts.push({ x: w, y: h });
  pushQuad(pts, { x: w, y: h }, { x: w / 2, y: round2(h - dip * 0.5) }, { x: 0, y: h }, 10);
  return pts;
}

/**
 * Jambe de pantalon (short / jogging) : taille droite, fourche concave
 * profondément incurvée, entrejambe incurvé jusqu'à un bas resserré des
 * deux côtés, couture extérieure quasi verticale avec hanche légèrement
 * galbée.
 */
export function legContour(w: number, h: number, taperRatio: number): Point[] {
  const crotchX = round2(w * CROTCH_X_RATIO);
  const crotchY = round2(h * CROTCH_Y_RATIO);
  const hemInner = round2(crotchX + (w - crotchX) * (taperRatio >= 0.1
    ? JOGGING_HEM_INNER_RATIO : SHORT_HEM_INNER_RATIO));
  const hemOuter = round2(w * (taperRatio >= 0.1
    ? JOGGING_HEM_OUTER_RATIO : SHORT_HEM_OUTER_RATIO));
  const pts: Point[] = [];
  pts.push({ x: 0, y: 0 });
  pts.push({ x: round2(w), y: 0 });
  pushQuad(pts, { x: w, y: 0 }, { x: round2(w * 0.6), y: round2(crotchY * 1.3) },
    { x: crotchX, y: crotchY }, 10);
  pushQuad(
    pts, { x: crotchX, y: crotchY },
    { x: round2(crotchX + (hemInner - crotchX) * 0.3), y: round2((crotchY + h) * 0.62) },
    { x: hemInner, y: h }, 8,
  );
  pts.push({ x: hemOuter, y: round2(h) });
  pushQuad(
    pts, { x: hemOuter, y: h }, { x: round2(hemOuter * 0.3), y: round2(h * 0.45) },
    { x: 0, y: 0 }, 8, true,
  );
  return pts;
}

/**
 * Poche : fond arrondi (U), bord supérieur droit — poche plaque réelle.
 */
export function pocketContour(w: number, h: number): Point[] {
  const r = round2(Math.min(w * 0.22, h * 0.35));
  const pts: Point[] = [];
  pts.push({ x: 0, y: 0 });
  pts.push({ x: round2(w), y: 0 });
  pts.push({ x: round2(w), y: round2(h - r) });
  pushQuad(pts, { x: w, y: h - r }, { x: w, y: h }, { x: w / 2, y: h }, 8);
  pushQuad(pts, { x: w / 2, y: h }, { x: 0, y: h }, { x: 0, y: h - r }, 8);
  return pts;
}

/**
 * Contour R2 d'une pièce : choix de la forme d'après la famille et le
 * code de pièce. Les préfixes « haut_ » / « short_ » (ensembles) sont
 * décomposés ; toute pièce sans forme dédiée (patte, fente, poignet,
 * bas de jambe…) reste un rectangle de coupe exact.
 */
export function buildShapedContour(
  family: string,
  code: string,
  widthCm: number,
  heightCm: number,
): Point[] {
  let base = code;
  if (base.startsWith('haut_')) base = base.slice(5);
  else if (base.startsWith('short_')) base = base.slice(6);
  switch (base) {
    case 'devant':
      return torsoContour(widthCm, heightCm, heightCm * NECK_DROP_FRONT_RATIO);
    case 'dos':
      return torsoContour(widthCm, heightCm, heightCm * NECK_DROP_BACK_RATIO);
    case 'manche_gauche':
    case 'manche_droite':
      return sleeveContour(widthCm, heightCm);
    case 'col':
    case 'ceinture':
      return bandContour(widthCm, heightCm);
    case 'devant_gauche':
    case 'devant_droite':
    case 'dos_gauche':
    case 'dos_droite':
      return legContour(
        widthCm,
        heightCm,
        family === 'jogging' ? JOGGING_TAPER_RATIO : SHORT_TAPER_RATIO,
      );
    case 'poche_gauche':
    case 'poche_droite':
    case 'poche':
      return pocketContour(widthCm, heightCm);
    default:
      return rectContour(widthCm, heightCm);
  }
}
