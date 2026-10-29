/**
 * Contrats partagés du module Coupe reconstruit.
 *
 * Toutes les coordonnées et dimensions sont exprimées en centimètres
 * réels, indépendants du zoom écran et de la taille de la fenêtre.
 * Le rendu visuel n'est jamais la source de vérité : ces structures
 * alimentent aussi bien le canvas client que les contrôles serveur.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rotation d'une pièce, en degrés (multiples de 90°). */
export type Rotation = 0 | 90 | 180 | 270;

/** Sens du tissu déclaré pour une pièce de patron. */
export type GrainDirection = 'along' | 'cross' | 'any';

/**
 * Définition d'une pièce de patron : contour vectoriel fermé à
 * l'échelle 1, origine (0,0) au coin supérieur gauche du contour.
 * Une pièce « incomplete » n'est jamais utilisable pour une coupe réelle.
 */
export interface CuttingPiece {
  id: number;
  code: string;
  label: string;
  component: string;
  points: Point[];
  widthCm: number;
  heightCm: number;
  qty: number;
  grainDirection: GrainDirection;
  allowedRotations: number[];
  seamAllowanceCm: number;
  seamIncluded: boolean;
  status: 'configuree' | 'incomplete';
}

/** Instance d'une pièce posée sur la table de coupe. */
export interface PiecePlacement {
  pieceId: number;
  code: string;
  label: string;
  /** Coin supérieur gauche du contour tourné, en cm réels. */
  x: number;
  y: number;
  rotation: Rotation;
  /** Contour transformé (coordonnées absolues sur la table, cm). */
  points: Point[];
}
