import type { GrainDirection, Point } from '@/lib/cutting/types';
import { buildShapedContour } from './pattern-shapes';

/**
 * Règles de patronage R2 (version figée, pur — aucun I/O).
 *
 * Principe d'exactitude : chaque pièce référence EXPLICITEMENT les
 * libellés de mesures de la fiche technique validée. Aucune dimension
 * n'est inventée : la largeur et la hauteur de coupe sont la mesure
 * du vêtement fini, augmentée des marges de couture (seamIncluded =
 * false). Le contour R2 est un vrai patron vectoriel (encolure
 * incurvée, emmanchures, calotte de manche, fourche de pantalon,
 * bandes incurvées) construit par `pattern-shapes.ts` : son enveloppe
 * correspond exactement aux dimensions de coupe mesurées.
 *
 * Une pièce dont une mesure référencée manque est « incomplete » :
 * elle est signalée, jamais utilisable pour une coupe réelle. Une
 * révision ne peut être validée que si toutes ses pièces requises
 * (« required ») sont configurées ; les pièces optionnelles
 * incomplètes restent visibles mais ne peuvent pas être placées.
 */

export type PatternFamily =
  | 'tshirt'
  | 'polo'
  | 'short'
  | 'jogging'
  | 'ensemble';

/** Liste des familles couvertes par les règles de patronage (R2). */
export const PATTERN_FAMILIES: PatternFamily[] = [
  'tshirt', 'polo', 'short', 'jogging', 'ensemble',
];

export type PatternComponent = 'principal' | 'haut' | 'short';

export interface PieceSpec {
  code: string;
  label: string;
  component: PatternComponent;
  qty: number;
  grainDirection: GrainDirection;
  allowedRotations: number[];
  required: boolean;
  widthLabel: string;
  heightLabel: string;
}

interface FamilySpec {
  pieces: PieceSpec[];
}

function spec(
  code: string,
  label: string,
  widthLabel: string,
  heightLabel: string,
  options: Partial<Omit<PieceSpec, 'code' | 'label' | 'widthLabel' | 'heightLabel'>> = {},
): PieceSpec {
  return {
    code,
    label,
    component: 'principal',
    qty: 1,
    grainDirection: 'along',
    allowedRotations: [0, 180],
    required: true,
    widthLabel,
    heightLabel,
    ...options,
  };
}

const TSHIRT: FamilySpec = {
  pieces: [
    spec('devant', 'Devant', 'Poitrine à plat', 'Longueur totale'),
    spec('dos', 'Dos', 'Poitrine à plat', 'Longueur totale'),
    spec('manche_gauche', 'Manche gauche', 'Ouverture manche', 'Longueur manche'),
    spec('manche_droite', 'Manche droite', 'Ouverture manche', 'Longueur manche'),
    spec('col', 'Col', 'Encolure', 'Hauteur col', {
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
  ],
};

const POLO: FamilySpec = {
  pieces: [
    spec('devant', 'Devant', 'Poitrine à plat', 'Longueur totale'),
    spec('dos', 'Dos', 'Poitrine à plat', 'Longueur totale'),
    spec('manche_gauche', 'Manche gauche', 'Ouverture manche', 'Longueur manche'),
    spec('manche_droite', 'Manche droite', 'Ouverture manche', 'Longueur manche'),
    spec('col', 'Col polo', 'Encolure', 'Col', {
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
    spec('patte_gauche', 'Patte de boutonnage gauche', 'Largeur patte', 'Longueur patte'),
    spec('patte_droite', 'Patte de boutonnage droite', 'Largeur patte', 'Longueur patte'),
    // Fente latérale : pièce du modèle, sans mesure dédiée au catalogue
    // pour l'instant → « à configurer » jusqu'à définition des mesures.
    spec('fente_cote', 'Fente côté', 'Longueur fente', 'Hauteur fente', {
      qty: 2,
      required: false,
    }),
  ],
};

const SHORT: FamilySpec = {
  pieces: [
    spec('devant_gauche', 'Devant jambe gauche', 'Hanches', 'Longueur extérieure'),
    spec('devant_droite', 'Devant jambe droite', 'Hanches', 'Longueur extérieure'),
    spec('dos_gauche', 'Dos jambe gauche', 'Hanches', 'Longueur extérieure'),
    spec('dos_droite', 'Dos jambe droite', 'Hanches', 'Longueur extérieure'),
    spec('ceinture', 'Ceinture', 'Taille détendue', 'Hauteur ceinture', {
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
    spec('poche_gauche', 'Poche gauche', 'Longueur poche', 'Hauteur poche', {
      required: false,
    }),
    spec('poche_droite', 'Poche droite', 'Longueur poche', 'Hauteur poche', {
      required: false,
    }),
  ],
};

const JOGGING: FamilySpec = {
  pieces: [
    spec('devant_gauche', 'Devant jambe gauche', 'Hanches', 'Longueur extérieure'),
    spec('devant_droite', 'Devant jambe droite', 'Hanches', 'Longueur extérieure'),
    spec('dos_gauche', 'Dos jambe gauche', 'Hanches', 'Longueur extérieure'),
    spec('dos_droite', 'Dos jambe droite', 'Hanches', 'Longueur extérieure'),
    spec('ceinture', 'Ceinture', 'Taille détendue', 'Hauteur ceinture', {
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
    spec('poche', 'Poche', 'Longueur poche', 'Hauteur poche', { required: false }),
    spec('bas_jambe', 'Bas de jambe', 'Ouverture bas', 'Hauteur bas', {
      qty: 2,
      required: false,
    }),
    spec('poignet', 'Poignet', 'Ouverture poignet', 'Hauteur poignet', {
      qty: 2,
      required: false,
    }),
  ],
};

const ENSEMBLE: FamilySpec = {
  pieces: [
    spec('haut_devant', 'Haut : devant', 'Haut : poitrine', 'Haut : longueur', { component: 'haut' }),
    spec('haut_dos', 'Haut : dos', 'Haut : poitrine', 'Haut : longueur', { component: 'haut' }),
    spec('haut_manche_gauche', 'Haut : manche gauche', 'Haut : ouverture manche', 'Haut : manche', { component: 'haut' }),
    spec('haut_manche_droite', 'Haut : manche droite', 'Haut : ouverture manche', 'Haut : manche', { component: 'haut' }),
    spec('haut_col', 'Haut : col', 'Haut : encolure', 'Hauteur col', {
      component: 'haut',
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
    spec('short_devant_gauche', 'Short : devant gauche', 'Short : hanches', 'Short : longueur', { component: 'short' }),
    spec('short_devant_droite', 'Short : devant droite', 'Short : hanches', 'Short : longueur', { component: 'short' }),
    spec('short_dos_gauche', 'Short : dos gauche', 'Short : hanches', 'Short : longueur', { component: 'short' }),
    spec('short_dos_droite', 'Short : dos droite', 'Short : hanches', 'Short : longueur', { component: 'short' }),
    spec('short_ceinture', 'Short : ceinture', 'Short : taille', 'Short : ceinture', {
      component: 'short',
      grainDirection: 'any',
      allowedRotations: [0, 90, 180, 270],
    }),
    spec('short_poche_gauche', 'Short : poche gauche', 'Longueur poche', 'Hauteur poche', {
      component: 'short',
      required: false,
    }),
    spec('short_poche_droite', 'Short : poche droite', 'Longueur poche', 'Hauteur poche', {
      component: 'short',
      required: false,
    }),
  ],
};

const FAMILY_SPECS: Record<PatternFamily, FamilySpec> = {
  tshirt: TSHIRT,
  polo: POLO,
  short: SHORT,
  jogging: JOGGING,
  ensemble: ENSEMBLE,
};

/** Marge de couture R2 (cm), ajoutée de chaque côté (seamIncluded=false). */
export const RULE_SEAM_ALLOWANCE_CM = 1;
/** Version des règles de patronage (contours réalistes). */
export const RULES_VERSION = 'R2';

/**
 * Libellés de mesures exigés par les règles d'une famille : seules les
 * pièces REQUISES rendent la fiche incomplète si elles manquent. Les
 * pièces optionnelles (poche, fente, bas de jambe, poignet…) sont
 * signalées « à configurer » sans bloquer la fiche ni la validation.
 */
export function ruleMeasurementLabels(family: string): string[] {
  const known = FAMILY_SPECS[family as PatternFamily];
  if (!known) return [];
  const labels = new Set<string>();
  for (const piece of known.pieces) {
    if (!piece.required) continue;
    labels.add(piece.widthLabel);
    labels.add(piece.heightLabel);
  }
  return [...labels];
}

export interface BuiltPiece {
  code: string;
  label: string;
  component: PatternComponent;
  qty: number;
  grainDirection: GrainDirection;
  allowedRotations: number[];
  seamAllowanceCm: number;
  seamIncluded: boolean;
  widthCm: number | null;
  heightCm: number | null;
  points: Point[] | null;
  status: 'configuree' | 'incomplete';
  required: boolean;
  missingLabels: string[];
}

/** Mesures de la fiche : libellé → valeur en cm. */
export type FicheMesures = Record<string, number>;

/**
 * Construit les pièces d'une famille à partir des mesures validées.
 * Aucune valeur par défaut : une mesure absente produit une pièce
 * « incomplete » avec la liste exacte des champs manquants.
 */
export function buildFamilyPieces(
  family: string,
  mesures: FicheMesures,
): BuiltPiece[] {
  const known = FAMILY_SPECS[family as PatternFamily];
  if (!known) return [];
  return known.pieces.map((piece) => {
    const width = mesures[piece.widthLabel];
    const height = mesures[piece.heightLabel];
    const missingLabels: string[] = [];
    if (typeof width !== 'number' || !(width > 0)) missingLabels.push(piece.widthLabel);
    if (typeof height !== 'number' || !(height > 0)) missingLabels.push(piece.heightLabel);
    if (missingLabels.length > 0) {
      return {
        code: piece.code,
        label: piece.label,
        component: piece.component,
        qty: piece.qty,
        grainDirection: piece.grainDirection,
        allowedRotations: piece.allowedRotations,
        seamAllowanceCm: RULE_SEAM_ALLOWANCE_CM,
        seamIncluded: false,
        widthCm: null,
        heightCm: null,
        points: null,
        status: 'incomplete' as const,
        required: piece.required,
        missingLabels,
      };
    }
    const cutWidth = width + 2 * RULE_SEAM_ALLOWANCE_CM;
    const cutHeight = height + 2 * RULE_SEAM_ALLOWANCE_CM;
    const points = buildShapedContour(family, piece.code, cutWidth, cutHeight);
    return {
      code: piece.code,
      label: piece.label,
      component: piece.component,
      qty: piece.qty,
      grainDirection: piece.grainDirection,
      allowedRotations: piece.allowedRotations,
      seamAllowanceCm: RULE_SEAM_ALLOWANCE_CM,
      seamIncluded: false,
      widthCm: cutWidth,
      heightCm: cutHeight,
      points,
      status: 'configuree' as const,
      required: piece.required,
      missingLabels: [],
    };
  });
}

/** Un patron est « prêt pour la coupe » si toutes ses pièces requises sont configurées. */
export function isFamilyReady(pieces: BuiltPiece[]): boolean {
  return pieces.every((piece) => !piece.required || piece.status === 'configuree');
}
