/**
 * Calculateur de consommation textile « ORDNUR » (phase 4) — moteur PUR.
 * Aucun I/O, aucune base : réutilisable côté serveur et côté client.
 *
 * Principe d'honnêteté des chiffres (mêmes règles que le module Coupe) :
 * - la formule T-shirt de référence reste l'implémentation UNIQUE
 *   `tshirtTheoreticalKg` (fabric-estimate.ts) : ce moteur ne la
 *   duplique pas, il l'enrichit (unités, quantité, wastage, coût) ;
 * - le wastage est appliqué UNE SEULE FOIS, jamais composé ;
 * - aucune conversion d'unité implicite : l'unité est un champ
 *   explicite ('cm' | 'in'), une unité absente est refusée ;
 * - les résultats sont des ESTIMATIONS THÉORIQUES, distinctes du
 *   placement réel des patrons, du disponible physique des rouleaux
 *   et de la consommation enregistrée après production ;
 * - précision interne conservée : aucun arrondi dans le moteur,
 *   l'affichage arrondit.
 */

import { ServiceError } from '../../server/api/service-error';

/**
 * Cœur PUR de la formule T-shirt de référence (cahier des charges /
 * ORDNUR, C12) — implémentation UNIQUE du projet :
 * (L_corps + L_manche + marge_L) × (demi-poitrine + marge_P) × 2
 *   × grammage × 12 / 10 000 000 → kg PAR DOUZAINE.
 * ×2 : devant + dos en double épaisseur ; ×12 : par douzaine.
 * Entrées prévalidées (positives) par l'appelant. La version validée
 * avec messages d'erreur est `tshirtTheoreticalKg` (fabric-estimate),
 * qui délègue ici.
 */
export function tshirtFormulaCore(input: {
  bodyLengthCm: number;
  chestHalfCm: number;
  sleeveLengthCm: number;
  lengthAllowanceCm: number;
  chestAllowanceCm: number;
  grammageGm2: number;
}): { netKgPerDozen: number; netKgPerPiece: number; netM2PerDozen: number } {
  const netM2PerDozen =
    ((input.bodyLengthCm + input.sleeveLengthCm + input.lengthAllowanceCm)
      * (input.chestHalfCm + input.chestAllowanceCm) * 2 * 12) / 10000;
  const netKgPerDozen = (netM2PerDozen * input.grammageGm2) / 1000;
  return {
    netM2PerDozen,
    netKgPerDozen,
    netKgPerPiece: netKgPerDozen / 12,
  };
}

/** Unités du calculateur (champ explicite, jamais déduit). */
export type ConsumptionUnit = 'cm' | 'in';

/** Facteur de conversion exact pouces → centimètres. */
export const CM_PER_INCH = 2.54;

/**
 * Convertit une longueur vers les centimètres (unité interne du module).
 * `value` doit être un nombre fini strictement positif.
 */
export function toCm(value: number, unit: ConsumptionUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ServiceError('La valeur doit être un nombre positif.', 400);
  }
  if (unit !== 'cm' && unit !== 'in') {
    throw new ServiceError(
      `Unité inconnue (${String(unit)}) : 'cm' ou 'in' attendu, aucune conversion implicite.`,
      400,
    );
  }
  return unit === 'in' ? value * CM_PER_INCH : value;
}

/** Ligne d'une taille (mode Single size ou Size ratio), saisie dans l'unité choisie. */
export interface ConsumptionSizeRow {
  /** Libellé libre de la taille (S, M, L…), informatif. */
  label: string;
  bodyLength: number;
  halfChest: number;
  sleeveLength: number;
  /** Quantité en pièces pour cette taille (> 0). */
  qty: number;
}

export interface OrdnurInput {
  unit: ConsumptionUnit;
  /** Une ligne (Single size) ou plusieurs (Size ratio). */
  rows: ConsumptionSizeRow[];
  /** Grammage du tissu (g/m²), identique pour toute la commande. */
  grammageGm2: number;
  /** Marge longueur (cm), appliquée aux valeurs converties en cm. */
  lengthAllowanceCm: number;
  /** Marge poitrine (cm), appliquée aux valeurs converties en cm. */
  chestAllowanceCm: number;
  /** Wastage en % (0–100), appliqué UNE FOIS sur le total net. */
  wastagePct: number;
  /** Prix par kg (optionnel : absent → coût non calculé). */
  pricePerKg?: number | null;
  /** Devise affichée, libellé libre non persisté. */
  currency?: string | null;
}

/** Résultat par taille : contribution isolée, jamais fondue dans le total. */
export interface ConsumptionSizeResult {
  label: string;
  /** Quantité (pièces) de la ligne. */
  qty: number;
  /** Poids net par douzaine (kg) pour cette taille. */
  netKgPerDozen: number;
  /** Poids net par pièce (kg) pour cette taille. */
  netKgPerPiece: number;
  /** Poids avec wastage pour les pièces de cette ligne (kg). */
  kgWithWastage: number;
  /** Coût pour cette ligne (null si prix non fourni). */
  cost: number | null;
}

export interface OrdnurResult {
  unit: ConsumptionUnit;
  /** Total pièces de la commande. */
  totalPieces: number;
  /** Poids net par douzaine de la RÉFÉRENCE (première ligne), kg. */
  netKgPerDozen: number;
  /** Poids net par pièce (moyenne pondérée par les quantités), kg. */
  netKgPerPiece: number;
  /** Poids net total commande (kg), avant wastage. */
  netKgTotal: number;
  /** Wastage appliqué, en %. */
  wastagePct: number;
  /** Poids total commande après UNE application du wastage (kg). */
  kgWithWastage: number;
  /** Détail par taille (contributions isolées). */
  sizes: ConsumptionSizeResult[];
  /** Prix/kg utilisé (null → coût indisponible). */
  pricePerKg: number | null;
  /** Devise affichée (null → champ non fourni). */
  currency: string | null;
  /** Coût total commande (null si prix non fourni). */
  costTotal: number | null;
  /** Coût par pièce (null si prix non fourni). */
  costPerPiece: number | null;
  /** Coût par douzaine (null si prix non fourni). */
  costPerDozen: number | null;
}

/**
 * Parses et valide un nombre de saisie : fin, > 0 requis.
 * Message en français citant le champ, style du module Coupe.
 */
function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ServiceError(`${label} doit être un nombre positif.`, 400);
  }
  return value;
}

function nonNegative(value: number, label: string, max = Number.MAX_VALUE): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new ServiceError(`${label} doit être un nombre entre 0 et ${max}.`, 400);
  }
  return value;
}

/**
 * Calculateur ORDNUR complet : formule T-shirt par taille (via
 * l'implémentation unique), wastage une seule fois, agrégation
 * commande, coût facultatif. Aucun arrondi interne.
 */
export function ordnurTshirtConsumption(input: OrdnurInput): OrdnurResult {
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new ServiceError(
      'Au moins une ligne de taille est requise (Single size ou Size ratio).',
      400,
    );
  }
  const grammage = positive(input.grammageGm2, 'Le grammage');
  const lengthAllowance = nonNegative(input.lengthAllowanceCm, 'La marge de longueur');
  const chestAllowance = nonNegative(input.chestAllowanceCm, 'La marge de poitrine');
  const wastagePct = nonNegative(input.wastagePct, 'Le wastage', 100);
  const pricePerKg = input.pricePerKg === null || input.pricePerKg === undefined
    ? null
    : positive(input.pricePerKg, 'Le prix au kilogramme');
  const wastageFactor = 1 + wastagePct / 100;

  const sizes: ConsumptionSizeResult[] = input.rows.flatMap((row, index) => {
    const label = typeof row.label === 'string' && row.label.trim()
      ? row.label.trim() : `Taille ${index + 1}`;
    // Quantité : 0 → ligne ignorée (mode Size ratio), négative → refus.
    if (!Number.isFinite(row.qty) || row.qty < 0) {
      throw new ServiceError(`La quantité (${label}) doit être un nombre positif ou nul.`, 400);
    }
    if (row.qty === 0) return [];
    const qty = row.qty;
    // Conversion explicite vers les cm internes, puis formule de référence.
    const net = tshirtFormulaCore({
      bodyLengthCm: toCm(positive(row.bodyLength, `La longueur du corps (${label})`), input.unit),
      chestHalfCm: toCm(positive(row.halfChest, `Le demi-tour de poitrine (${label})`), input.unit),
      sleeveLengthCm: toCm(positive(row.sleeveLength, `La longueur de manche (${label})`), input.unit),
      lengthAllowanceCm: lengthAllowance,
      chestAllowanceCm: chestAllowance,
      grammageGm2: grammage,
    });
    const kgWithWastage = net.netKgPerPiece * qty * wastageFactor;
    return {
      label,
      qty,
      netKgPerDozen: net.netKgPerDozen,
      netKgPerPiece: net.netKgPerPiece,
      kgWithWastage,
      cost: pricePerKg === null ? null : kgWithWastage * pricePerKg,
    };
  });

  const totalPieces = sizes.reduce((sum, size) => sum + size.qty, 0);
  if (sizes.length === 0 || totalPieces === 0) {
    throw new ServiceError(
      'Aucune pièce dans la commande : au moins une ligne doit avoir une quantité positive.',
      400,
    );
  }
  const netKgTotal = sizes.reduce((sum, size) => sum + size.netKgPerPiece * size.qty, 0);
  const kgWithWastage = netKgTotal * wastageFactor;
  return {
    unit: input.unit,
    totalPieces,
    netKgPerDozen: sizes[0].netKgPerDozen,
    netKgPerPiece: totalPieces > 0 ? netKgTotal / totalPieces : 0,
    netKgTotal,
    wastagePct,
    kgWithWastage,
    sizes,
    pricePerKg,
    currency: input.currency === null || input.currency === undefined ? null : input.currency,
    costTotal: pricePerKg === null ? null : kgWithWastage * pricePerKg,
    costPerPiece: pricePerKg === null ? null : (netKgTotal * wastageFactor * pricePerKg) / totalPieces,
    costPerDozen: pricePerKg === null ? null : (netKgTotal * wastageFactor * pricePerKg) / totalPieces * 12,
  };
}

// ── Contrat API du calculateur (phase 4.1) ────────────────────────────
// Mapping entrée API → moteur, unique côté serveur : toute valeur
// affichée est RECALCULÉE ici, jamais acceptée du client.

/** Champ numérique API : nombre fini ou chaîne numérique ; sinon refus. */
function apiNumber(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new ServiceError(`${label} doit être un nombre.`, 400);
}

/** Ligne API : mesures requises par ligne, quantité validée (0 = ignorée). */
function apiRow(raw: unknown, index: number): ConsumptionSizeRow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ServiceError(`Ligne de taille ${index + 1} invalide.`, 400);
  }
  const row = raw as Record<string, unknown>;
  const label = typeof row.label === 'string' && row.label.trim()
    ? row.label.trim() : `Taille ${index + 1}`;
  const qty = apiNumber(row.qty, `La quantité (${label})`);
  if (qty < 0) {
    throw new ServiceError(`La quantité (${label}) doit être un nombre positif ou nul.`, 400);
  }
  return {
    label,
    bodyLength: apiNumber(row.bodyLength, `La longueur du corps (${label})`),
    halfChest: apiNumber(row.halfChest, `Le demi-tour de poitrine (${label})`),
    sleeveLength: apiNumber(row.sleeveLength, `La longueur de manche (${label})`),
    qty,
  };
}

export interface TshirtCommandEstimate extends OrdnurResult {
  /** Champ historique : m² nets par douzaine de la taille de référence. */
  netM2PerDozen: number;
}

/**
 * Contrat complet de l'action `estimate.tshirt-theoretical` :
 * - `rows` (tableau) : mode Size ratio — toutes les tailles sont
 *   calculées et agrégées côté serveur, ligne par ligne ;
 * - sans `rows` : format historique à ligne unique (rétrocompatible,
 *   `totalPieces` par défaut 12).
 * Chaque ligne est validée strictement : mesure manquante ou quantité
 * négative refusée avec son libellé — jamais remplacée par zéro.
 * Le wastage est appliqué UNE fois, dans le moteur uniquement.
 */
export function estimateTshirtCommand(
  input: Record<string, unknown>,
): TshirtCommandEstimate {
  const unit = input.unit === 'in' ? 'in' : 'cm';
  if (input.unit !== undefined && input.unit !== 'cm' && input.unit !== 'in') {
    throw new ServiceError(
      `Unité inconnue (${String(input.unit)}) : 'cm' ou 'in' attendu.`,
      400,
    );
  }
  const rows: ConsumptionSizeRow[] = input.rows !== undefined
    ? Array.isArray(input.rows) && input.rows.length > 0
      ? (input.rows as unknown[]).map(apiRow)
      : (() => {
        throw new ServiceError(
          'rows doit être un tableau non vide de tailles.',
          400,
        );
      })()
    : [{
      label: typeof input.sizeLabel === 'string' && input.sizeLabel.trim()
        ? input.sizeLabel.trim() : 'Taille unique',
      bodyLength: apiNumber(input.bodyLengthCm, 'La longueur du corps'),
      halfChest: apiNumber(input.chestHalfCm, 'Le demi-tour de poitrine'),
      sleeveLength: apiNumber(input.sleeveLengthCm, 'La longueur de manche'),
      qty: input.totalPieces === undefined || input.totalPieces === null
        || input.totalPieces === ''
        ? 12
        : apiNumber(input.totalPieces, 'La quantité totale'),
    }];
  const wastageRaw = input.wastagePct;
  const priceRaw = input.pricePerKg;
  const result = ordnurTshirtConsumption({
    unit,
    rows,
    grammageGm2: apiNumber(input.grammageGm2, 'Le grammage'),
    lengthAllowanceCm: input.lengthAllowanceCm === undefined
      ? 10 : apiNumber(input.lengthAllowanceCm, 'La marge de longueur'),
    chestAllowanceCm: input.chestAllowanceCm === undefined
      ? 3 : apiNumber(input.chestAllowanceCm, 'La marge de poitrine'),
    wastagePct: wastageRaw === undefined || wastageRaw === null || wastageRaw === ''
      ? 0 : apiNumber(wastageRaw, 'Le wastage'),
    pricePerKg: priceRaw === undefined || priceRaw === null || priceRaw === ''
      ? null : apiNumber(priceRaw, 'Le prix au kilogramme'),
    currency: typeof input.currency === 'string' && input.currency.trim()
      ? input.currency.trim().slice(0, 8) : null,
  });
  const grammage = apiNumber(input.grammageGm2, 'Le grammage');
  return {
    ...result,
    netM2PerDozen: result.netKgPerDozen / (grammage / 1000),
  };
}

// ── Formules par famille (phase 4) ────────────────────────────────────
// Chaque famille reçoit SA PROPRE formule, fondée sur les libellés de
// mesures de sa fiche technique (mêmes libellés que `FAMILY_SPECS` de
// pattern-rules — un test de non-dérive vérifie l'alignement). La
// formule T-shirt ORDNUR (C12) n'est JAMAIS appliquée aux autres
// familles : polo/short/jogging/ensemble sont des sommes explicites
// de panneaux rectangulaires. Toutes sont des ESTIMATIONS THÉORIQUES
// (méthode « formule_famille ») que le placement réel des patrons et
// les relevés physiques restent seuls à trancher.

export type FamilyFormulaName = 'tshirt' | 'polo' | 'short' | 'jogging' | 'ensemble';

export const FAMILY_FORMULA_NAMES: FamilyFormulaName[] = [
  'tshirt', 'polo', 'short', 'jogging', 'ensemble',
];

/** Panneau rectangulaire : mesure largeur × mesure hauteur × multiplicité. */
export interface FamilyPanelDef {
  label: string;
  widthLabel: string;
  heightLabel: string;
  multiplier: number;
}

/**
 * Panneaux par famille (hors tshirt = C12). Les multiplicateurs
 * reproduisent les pièces requises de `FAMILY_SPECS` (qty × paires) ;
 * les pièces optionnelles (poches, fentes, bas, poignets) sont
 * EXCLUES et signalées dans le résultat.
 */
export const FAMILY_PANELS: Record<
  Exclude<FamilyFormulaName, 'tshirt'>,
  FamilyPanelDef[]
> = {
  polo: [
    { label: 'Devant + dos', widthLabel: 'Poitrine à plat', heightLabel: 'Longueur totale', multiplier: 2 },
    { label: 'Manches', widthLabel: 'Ouverture manche', heightLabel: 'Longueur manche', multiplier: 2 },
    { label: 'Col polo', widthLabel: 'Encolure', heightLabel: 'Col', multiplier: 1 },
    { label: 'Pattes de boutonnage', widthLabel: 'Largeur patte', heightLabel: 'Longueur patte', multiplier: 2 },
  ],
  short: [
    { label: 'Jambes (devant + dos × gauche + droite)', widthLabel: 'Hanches', heightLabel: 'Longueur extérieure', multiplier: 4 },
    { label: 'Ceinture', widthLabel: 'Taille détendue', heightLabel: 'Hauteur ceinture', multiplier: 1 },
  ],
  jogging: [
    { label: 'Jambes (devant + dos × gauche + droite)', widthLabel: 'Hanches', heightLabel: 'Longueur extérieure', multiplier: 4 },
    { label: 'Ceinture', widthLabel: 'Taille détendue', heightLabel: 'Hauteur ceinture', multiplier: 1 },
  ],
  ensemble: [
    { label: 'Haut : devant + dos', widthLabel: 'Haut : poitrine', heightLabel: 'Haut : longueur', multiplier: 2 },
    { label: 'Haut : manches', widthLabel: 'Haut : ouverture manche', heightLabel: 'Haut : manche', multiplier: 2 },
    { label: 'Haut : col', widthLabel: 'Haut : encolure', heightLabel: 'Hauteur col', multiplier: 1 },
    { label: 'Short : jambes', widthLabel: 'Short : hanches', heightLabel: 'Short : longueur', multiplier: 4 },
    { label: 'Short : ceinture', widthLabel: 'Short : taille', heightLabel: 'Short : ceinture', multiplier: 1 },
  ],
};

export interface FamilyPanelResult {
  label: string;
  /** Aire du panneau (multiplicité incluse), en m². */
  areaM2: number;
  /** Poids du panneau au grammage donné, en kg. */
  kg: number;
}

export interface FamilyFormulaResult {
  family: FamilyFormulaName;
  /** 'C12' : formule ORDNUR (tshirt seul) ; 'panneaux' : somme explicite. */
  formula: 'C12' | 'panneaux';
  kgPerPiece: number;
  kgPerDozen: number;
  panels: FamilyPanelResult[];
  /** Pièces optionnelles volontairement non comptées (transparence). */
  optionalExcluded: string[];
}

/**
 * Mesure requise absente ou invalide : refus explicite listant TOUTES
 * les mesures manquantes — jamais de valeur inventée ni par défaut.
 */
function familyMeasure(
  mesures: Record<string, number>,
  label: string,
  missing: string[],
): number {
  const value = mesures[label];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    missing.push(label);
    return 0;
  }
  return value;
}

/**
 * Estimation théorique par famille (lecture pure).
 * - tshirt → formule C12 de référence (mêmes marges par défaut) ;
 * - autres → somme de panneaux rectangulaires (marge uniforme optionnelle,
 *   défaut 0 : les mesures de coupe R2 incluent déjà la couture).
 * Mesure requise absente → ServiceError avec la liste complète.
 */
export function familyFormulaKg(
  family: string,
  mesures: Record<string, number>,
  grammageGm2: number,
  options: {
    lengthAllowanceCm?: number;
    chestAllowanceCm?: number;
    /** Marge uniforme (cm) ajoutée à chaque dimension de panneau. */
    allowanceCm?: number;
  } = {},
): FamilyFormulaResult {
  if (!Number.isFinite(grammageGm2) || grammageGm2 <= 0) {
    throw new ServiceError('Le grammage doit être un nombre positif.', 400);
  }
  if (family === 'tshirt') {
    const missing: string[] = [];
    const body = familyMeasure(mesures, 'Longueur totale', missing);
    const chest = familyMeasure(mesures, 'Poitrine à plat', missing);
    const sleeve = familyMeasure(mesures, 'Longueur manche', missing);
    if (missing.length > 0) {
      throw new ServiceError(
        `Mesures manquantes pour la famille « tshirt » : ${missing.join(', ')}.`,
        400,
      );
    }
    const net = tshirtFormulaCore({
      bodyLengthCm: body,
      chestHalfCm: chest,
      sleeveLengthCm: sleeve,
      lengthAllowanceCm: options.lengthAllowanceCm ?? 10,
      chestAllowanceCm: options.chestAllowanceCm ?? 3,
      grammageGm2,
    });
    return {
      family,
      formula: 'C12',
      kgPerPiece: net.netKgPerPiece,
      kgPerDozen: net.netKgPerDozen,
      panels: [{
        label: 'Formule C12 (devant + dos, manches et col approximés)',
        areaM2: net.netM2PerDozen / 12,
        kg: net.netKgPerPiece,
      }],
      optionalExcluded: [],
    };
  }
  const panels = FAMILY_PANELS[family as Exclude<FamilyFormulaName, 'tshirt'>];
  if (!panels) {
    throw new ServiceError(
      `Famille « ${family} » sans formule dédiée : familles gérées : `
      + `${FAMILY_FORMULA_NAMES.join(', ')}. La formule T-shirt ne doit `
      + 'pas être appliquée à une autre famille.',
      400,
    );
  }
  const allowance = options.allowanceCm ?? 0;
  const missing: string[] = [];
  const measured = panels.map((panel) => ({
    panel,
    width: familyMeasure(mesures, panel.widthLabel, missing) + allowance,
    height: familyMeasure(mesures, panel.heightLabel, missing) + allowance,
  }));
  if (missing.length > 0) {
    throw new ServiceError(
      `Mesures manquantes pour la famille « ${family} » : ${missing.join(', ')}.`,
      400,
    );
  }
  const computed = measured.map(({ panel, width, height }) => {
    const areaM2 = (width * height * panel.multiplier) / 10000;
    return {
      label: panel.label,
      areaM2,
      kg: areaM2 * grammageGm2 / 1000,
    };
  });
  // La famille a été validée ci-dessus (panneaux trouvés) : le cast est
  // sûr ; les familles inconnues lèvent avant ce point.
  return {
    family: family as FamilyFormulaName,
    formula: 'panneaux',
    kgPerPiece: computed.reduce((sum, panel) => sum + panel.kg, 0),
    kgPerDozen: computed.reduce((sum, panel) => sum + panel.kg, 0) * 12,
    panels: computed,
    optionalExcluded: family === 'polo'
      ? ['Fente côté']
      : family === 'short' || family === 'jogging'
        ? ['Poches, bas de jambe et poignets (pièces optionnelles)']
        : ['Poches du short (pièces optionnelles)'],
  };
}
