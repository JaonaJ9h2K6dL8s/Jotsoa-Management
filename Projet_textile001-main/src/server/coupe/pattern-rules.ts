import { ServiceError } from '@/server/api/service-error';
import type { Point } from '@/lib/coupe-geometry';
import type { TechnicalProduct } from './technical-catalogue';

/**
 * Règles de patronage versionnées (module pur : aucune base de données).
 *
 * Séparation des responsabilités :
 *  - ce fichier : règles de patronage par famille + construction des
 *    contours (géométrie pure) ;
 *  - pattern-generator.ts : contrôles fiche/catalogue, conversion vers
 *    le format d'import et création de la révision.
 *
 * Impératif exactitude : chaque dimension de contour est calculée à
 * partir des mesures officielles de la fiche (catalogue technique).
 * Aucune valeur arbitraire n'est substituée à une mesure absente.
 * Les formes restent volontairement simples (rectangles, biseaux
 * d'épaule) : ce sont des pièces de brouillon qui doivent être
 * contrôlées puis validées par un humain via validateRevision.
 */

export const PATTERN_RULES_VERSION = 'R1';

export type Family = TechnicalProduct['family'];
export type MesuresBag = Record<string, number>;
export type PieceComponent = 'principal' | 'haut' | 'short';

export interface DraftPiece {
  code: string;
  label: string;
  role: string;
  component: PieceComponent;
  qty: number;
  points: Point[];
  widthCm: number;
  heightCm: number;
  grain: 'along';
  rotations: number[];
  seamAllowanceCm: number;
  seamIncluded: true;
  marks: Point[];
}

/**
 * Familles dont une mesure indispensable au patronage n'est pas
 * définie dans le catalogue : la génération est refusée avec le motif,
 * au lieu de produire des pièces prétendument prêtes pour la coupe.
 */
export const PATRONAGE_GAPS: Partial<Record<Family, string>> = {
  polo:
    'hauteur de col non définie : le catalogue ne fournit que « Col » (longueur de bande). Ajoutez la hauteur de col aux mesures officielles du produit.',
};

const r2 = (value: number): number => Math.round(value * 100) / 100;

function measure(bag: MesuresBag, label: string): number {
  const value = bag[label];
  if (!Number.isFinite(value) || value <= 0) {
    throw new ServiceError(`Mesure absente ou invalide : « ${label} ».`, 400);
  }
  return value;
}

function coherent(condition: boolean, message: string): void {
  if (!condition) throw new ServiceError(message, 400);
}

/** Rectangle simple (sens de lecture : x vers la droite, y vers le bas). */
function rectContour(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/**
 * Torse : rectangle à épaules en biseau 45° (règle R1). Le biseau est
 * déduit de l'écart poitrine/épaules — aucune dimension inventée — et
 * borné au quart de la hauteur. Si l'écart est nul : rectangle pur.
 */
function shoulderContour(width: number, height: number, topSpan: number): Point[] {
  const dx = Math.max(0, (width - topSpan) / 2);
  const dy = Math.min(dx, height / 4);
  if (dy <= 0) return rectContour(width, height);
  return [
    { x: 0, y: r2(dy) },
    { x: r2(dx), y: 0 },
    { x: r2(width - dx), y: 0 },
    { x: width, y: r2(dy) },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function piece(draft: {
  code: string; label: string; role: string; component: PieceComponent;
  qty: number; points: Point[]; widthCm: number; heightCm: number; seamAllowanceCm: number;
}): DraftPiece {
  return {
    ...draft,
    // Droit-fil longitudinal (règle R1) : rotations limitées à 0/180.
    grain: 'along',
    rotations: [0, 180],
    // Les valeurs de couture sont intégrées au contour (dimensions de
    // coupe) : exigence du contrôle de validation existant.
    seamIncluded: true,
    marks: [],
  };
}

/* ----------------------------- T-shirt ----------------------------- */

function buildTshirt(bag: MesuresBag, a: number): DraftPiece[] {
  const chest = measure(bag, 'Poitrine à plat');
  const length = measure(bag, 'Longueur totale');
  const shoulders = measure(bag, 'Épaules');
  const sleeveLength = measure(bag, 'Longueur manche');
  const sleeveOpening = measure(bag, 'Ouverture manche');
  const bottom = measure(bag, 'Largeur bas');
  const neck = measure(bag, 'Encolure');
  coherent(chest >= shoulders, `Incohérence : épaules (${shoulders} cm) supérieures à la poitrine à plat (${chest} cm).`);
  coherent(neck <= shoulders, `Incohérence : encolure (${neck} cm) supérieure aux épaules (${shoulders} cm).`);
  coherent(sleeveOpening < chest, `Incohérence : ouverture manche (${sleeveOpening} cm) ≥ poitrine (${chest} cm).`);
  coherent(bottom <= chest, `Incohérence : largeur bas (${bottom} cm) supérieure à la poitrine (${chest} cm).`);
  // Coutures latérales : +a de chaque côté. Couture d'emmanchure en
  // haut : +a. L'ourlet du bas est inclus dans la longueur finie.
  const torsoWidth = r2(chest + 2 * a);
  const torsoHeight = r2(length + a);
  const topSpan = r2(shoulders + 2 * a);
  const sleeveWidth = r2(sleeveOpening + 2 * a);
  const sleeveHeight = r2(sleeveLength + a);
  const torso = () => shoulderContour(torsoWidth, torsoHeight, topSpan);
  return [
    piece({ code: 'DEVANT', label: 'Devant', role: 'devant', component: 'principal', qty: 1, points: torso(), widthCm: torsoWidth, heightCm: torsoHeight, seamAllowanceCm: a }),
    piece({ code: 'DOS', label: 'Dos', role: 'dos', component: 'principal', qty: 1, points: torso(), widthCm: torsoWidth, heightCm: torsoHeight, seamAllowanceCm: a }),
    piece({ code: 'MANCHE', label: 'Manche', role: 'manche', component: 'principal', qty: 2, points: rectContour(sleeveWidth, sleeveHeight), widthCm: sleeveWidth, heightCm: sleeveHeight, seamAllowanceCm: a }),
  ];
}

/* --------------------- Short et jogging (jambes) -------------------- */

interface LowerLabels {
  waistRelaxed: string;
  waistStretched?: string;
  hip: string;
  outerLength: string;
  inseam: string;
  legOpening: string;
  waistbandHeight: string;
}

const LOWER_LABELS: LowerLabels = {
  waistRelaxed: 'Taille détendue',
  waistStretched: 'Taille étirée',
  hip: 'Hanches',
  outerLength: 'Longueur extérieure',
  inseam: 'Entrejambe',
  legOpening: 'Ouverture bas',
  waistbandHeight: 'Hauteur ceinture',
};

function buildLower(bag: MesuresBag, a: number, labels: LowerLabels, codePrefix: string, component: PieceComponent): DraftPiece[] {
  const waist = measure(bag, labels.waistRelaxed);
  const waistStretched = labels.waistStretched ? measure(bag, labels.waistStretched) : null;
  const hip = measure(bag, labels.hip);
  const outer = measure(bag, labels.outerLength);
  const inseam = measure(bag, labels.inseam);
  const legOpening = measure(bag, labels.legOpening);
  const bandHeight = measure(bag, labels.waistbandHeight);
  coherent(waistStretched == null || waist <= waistStretched, `Incohérence : taille détendue (${waist} cm) supérieure à la taille étirée (${waistStretched} cm).`);
  coherent(hip >= waist, `Incohérence : hanches (${hip} cm) inférieures à la taille détendue (${waist} cm).`);
  coherent(inseam < outer, `Incohérence : entrejambe (${inseam} cm) ≥ longueur extérieure (${outer} cm).`);
  coherent(bandHeight < outer, `Incohérence : hauteur de ceinture (${bandHeight} cm) ≥ longueur extérieure (${outer} cm).`);
  coherent(legOpening <= hip, `Incohérence : ouverture bas (${legOpening} cm) supérieure aux hanches (${hip} cm).`);
  // « Ouverture bas » = tour d'une jambe : largeur à plat = ouverture/2,
  // plus une marge par couture (side + entrejambe).
  const legWidth = r2(legOpening / 2 + 2 * a);
  // La ceinture couvre le haut de la longueur extérieure ; la couture
  // de taille ajoute a ; l'ourlet du bas est inclus dans la longueur.
  const legLength = r2(outer - bandHeight + a);
  const bandLength = r2(waist + 2 * a);
  const bandWidth = r2(bandHeight + 2 * a);
  const leg = () => rectContour(legWidth, legLength);
  return [
    piece({ code: `${codePrefix}DEVANT`, label: 'Devant jambe', role: 'devant', component, qty: 2, points: leg(), widthCm: legWidth, heightCm: legLength, seamAllowanceCm: a }),
    piece({ code: `${codePrefix}DOS`, label: 'Dos jambe', role: 'dos', component, qty: 2, points: leg(), widthCm: legWidth, heightCm: legLength, seamAllowanceCm: a }),
    piece({ code: `${codePrefix}CEINTURE`, label: 'Ceinture', role: 'ceinture', component, qty: 1, points: rectContour(bandLength, bandWidth), widthCm: bandLength, heightCm: bandWidth, seamAllowanceCm: a }),
  ];
}

function buildShort(bag: MesuresBag, a: number): DraftPiece[] {
  return buildLower(bag, a, LOWER_LABELS, '', 'principal');
}

function buildJogging(bag: MesuresBag, a: number): DraftPiece[] {
  // Mêmes libellés que le short dans le catalogue, mais règle
  // indépendante : les modèles évoluent séparément (longueur, chevilles…).
  return buildLower(bag, a, LOWER_LABELS, '', 'principal');
}

/* ------------------------ Ensemble enfant --------------------------- */

function buildEnsemble(bag: MesuresBag, a: number): DraftPiece[] {
  // Haut (type T-shirt) et short : pièces distinctes rattachées au
  // même ensemble par les composants « haut » / « short ».
  const chest = measure(bag, 'Haut : poitrine');
  const length = measure(bag, 'Haut : longueur');
  const shoulders = measure(bag, 'Haut : épaules');
  const sleeveLength = measure(bag, 'Haut : manche');
  const sleeveOpening = measure(bag, 'Haut : ouverture manche');
  const neck = measure(bag, 'Haut : encolure');
  coherent(chest >= shoulders, `Incohérence : épaules du haut (${shoulders} cm) supérieures à la poitrine (${chest} cm).`);
  coherent(neck <= shoulders, `Incohérence : encolure du haut (${neck} cm) supérieure aux épaules (${shoulders} cm).`);
  coherent(sleeveOpening < chest, `Incohérence : ouverture manche du haut (${sleeveOpening} cm) ≥ poitrine (${chest} cm).`);
  const torsoWidth = r2(chest + 2 * a);
  const torsoHeight = r2(length + a);
  const topSpan = r2(shoulders + 2 * a);
  const sleeveWidth = r2(sleeveOpening + 2 * a);
  const sleeveHeight = r2(sleeveLength + a);
  const torso = () => shoulderContour(torsoWidth, torsoHeight, topSpan);
  const upper: DraftPiece[] = [
    piece({ code: 'HAUT-DEVANT', label: 'Haut : devant', role: 'devant', component: 'haut', qty: 1, points: torso(), widthCm: torsoWidth, heightCm: torsoHeight, seamAllowanceCm: a }),
    piece({ code: 'HAUT-DOS', label: 'Haut : dos', role: 'dos', component: 'haut', qty: 1, points: torso(), widthCm: torsoWidth, heightCm: torsoHeight, seamAllowanceCm: a }),
    piece({ code: 'HAUT-MANCHE', label: 'Haut : manche', role: 'manche', component: 'haut', qty: 2, points: rectContour(sleeveWidth, sleeveHeight), widthCm: sleeveWidth, heightCm: sleeveHeight, seamAllowanceCm: a }),
  ];
  const lower = buildLower(bag, a, {
    waistRelaxed: 'Short : taille',
    hip: 'Short : hanches',
    outerLength: 'Short : longueur',
    inseam: 'Short : entrejambe',
    legOpening: 'Short : ouverture jambe',
    waistbandHeight: 'Short : ceinture',
  }, 'SHORT-', 'short');
  return [...upper, ...lower];
}

const FAMILY_RULES: { [K in Exclude<Family, 'polo'>]: (bag: MesuresBag, allowanceCm: number) => DraftPiece[] } = {
  tshirt: buildTshirt,
  short: buildShort,
  jogging: buildJogging,
  ensemble: buildEnsemble,
};

/** Construit les pièces d'une famille à partir des mesures officielles. */
export function buildFamilyPieces(family: Family, bag: MesuresBag, allowanceCm: number): DraftPiece[] {
  const gap = PATRONAGE_GAPS[family];
  if (gap) {
    throw new ServiceError(`Modèle « ${family} » non disponible pour la production : ${gap}`, 409);
  }
  if (family === 'polo') {
    throw new ServiceError('Modèle polo non disponible.', 409);
  }
  return FAMILY_RULES[family](bag, allowanceCm);
}
