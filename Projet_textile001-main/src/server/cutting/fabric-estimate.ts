import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { parseNumberInput } from '@/lib/coupe-validation';
import { MARKER_TOLERANCE_CM } from '@/lib/cutting/metrics';
import { requireId } from './common';
import { parsePoints } from './patterns';
import { polygonArea } from '@/lib/cutting/geometry';
import { familyFormulaKg, tshirtFormulaCore } from '@/lib/cutting/consumption';

/**
 * Estimation prévisionnelle de tissu (étape 18) — LECTURE SEULE.
 * Aucun mouvement de rouleau, aucune écriture : une estimation n'est
 * jamais une consommation. Les méthodes sont hiérarchisées par
 * fiabilité et le résultat porte toujours sa méthode et son statut :
 * - 'historique_placement' : efficacité moyenne des plans VALIDÉS du
 *   produit (échantillon minimal requis) appliquée aux surfaces réelles
 *   des contours validés du patron (pièces × multiplicité) ;
 * - 'surfaces_nettes' : sans historique exploitable, borne basse =
 *   poids net des pièces (chutes NON incluses, signalées manquantes) ;
 * - 'theorique_tshirt' : formule de référence du cahier des charges,
 *   distincte, jamais confondue avec le placement réel.
 * Plusieurs matières n'étant pas modélisées (un produit = un tissu),
 * le grammage est requis par appel pour convertir m² → kg.
 */

/** Échantillon minimal de plans validés pour un historique fiable. */
const MIN_HISTORY_SAMPLE = 3;

export interface FabricEstimateSizeRow {
  sizeId: number;
  sizeLabel: string;
  /** Surface nette des contours validés × multiplicité, en m². */
  netAreaM2: number;
  /** Nombre de pièces validées prises en compte. */
  pieceCount: number;
}

export interface FabricEstimateResult {
  productId: number;
  productName: string;
  method: 'historique_placement' | 'surfaces_nettes'
    | 'theorique_tshirt' | 'theorique_famille';
  /** true si la méthode s'appuie sur un échantillon jugé fiable. */
  reliable: boolean;
  /** Efficacité de placement utilisée (%), null si sans historique. */
  efficiencyPct: number | null;
  /** Taille de l'échantillon historique utilisé. */
  historySample: number;
  /** Surface estimée de tissu à dérouler, m² (chutes incluses si historique). */
  estimatedAreaM2: number | null;
  /** Longueur estimée de tissu (m) à la largeur utile demandée. */
  estimatedLengthM: number | null;
  /** Poids estimé (kg), uniquement si grammage fourni. */
  estimatedKg: number | null;
  /** Détail de la formule de référence quand la méthode l'utilise. */
  theoretical: {
    family: string;
    /** 'C12' : formule ORDNUR (tshirt) ; 'panneaux' : somme dédiée. */
    formula: 'C12' | 'panneaux';
    netKgPerPiece: number;
    netKgPerDozen: number;
    /** Poids net total commande (kg), avant wastage. */
    netKgTotal: number;
    /** Wastage appliqué UNE fois (%). */
    wastagePct: number;
    /** Poids total après UNE application du wastage (kg). */
    kgWithWastage: number;
    /** Surface nette des panneaux par pièce (m²), sans wastage. */
    panelsAreaM2PerPiece: number;
  } | null;
  /** Données manquantes empêchant une estimation fiable. */
  missingData: string[];
  sizes: FabricEstimateSizeRow[];
  notes: string[];
}

function parsePositive(value: unknown, label: string): number {
  const parsed = parseNumberInput(value);
  if (parsed === null || parsed <= 0) {
    throw new ServiceError(`${label} doit être un nombre positif.`, 400);
  }
  return parsed;
}

/** Surface nette d'un contour JSON (cm² → m²), pièces dégénérées ignorées. */
function geometryAreaM2(geometryJson: string): number {
  try {
    const contour = parsePoints(geometryJson);
    if (contour.length < 3) return 0;
    return polygonArea(contour) / 10000;
  } catch {
    return 0;
  }
}

/**
 * Conversion poids → longueur d'un rouleau homogène (test A) :
 * L = P×1000 / (grammage × largeur_m). Inverse : P = L×largeur_m×grammage/1000.
 * Lève une erreur explicite si les données sont absentes ou incohérentes.
 */
export function estimateRollLengthM(
  weightKg: number,
  grammageGm2: number,
  widthCm: number,
): number {
  if (weightKg <= 0) throw new ServiceError('Le poids doit être positif.', 400);
  if (grammageGm2 <= 0) throw new ServiceError('Le grammage doit être positif.', 400);
  if (widthCm <= 0) throw new ServiceError('La largeur doit être positive.', 400);
  return (weightKg * 1000) / (grammageGm2 * (widthCm / 100));
}

/** Inverse : poids estimé d'une longueur de tissu (kg). */
export function estimateRollWeightKg(
  lengthM: number,
  grammageGm2: number,
  widthCm: number,
): number {
  if (lengthM <= 0) throw new ServiceError('La longueur doit être positive.', 400);
  if (grammageGm2 <= 0) throw new ServiceError('Le grammage doit être positif.', 400);
  if (widthCm <= 0) throw new ServiceError('La largeur doit être positive.', 400);
  return (lengthM * (widthCm / 100) * grammageGm2) / 1000;
}

/**
 * Compare poids et longueur réels d'un rouleau au grammage déclaré.
 * Retourne l'écart relatif de grammage implicite ; au-delà de la
 * tolérance, une anomalie est signalée (jamais corrigée en silence).
 */
export function checkRollCoherence(
  weightKg: number,
  lengthM: number,
  grammageGm2: number,
  widthCm: number,
  tolerancePct = 10,
): { implicitGrammage: number; deviationPct: number; anomaly: boolean } {
  if (lengthM <= 0) throw new ServiceError('La longueur doit être positive.', 400);
  const widthM = widthCm / 100;
  if (widthM <= 0) throw new ServiceError('La largeur doit être positive.', 400);
  const implicitGrammage = (weightKg * 1000) / (lengthM * widthM);
  const deviationPct = Math.abs(implicitGrammage - grammageGm2) / grammageGm2 * 100;
  return { implicitGrammage, deviationPct, anomaly: deviationPct > tolerancePct };
}

/**
 * Formule théorique de référence T-shirt (cahier des charges, test B,
 * ORDNUR C12) : (L_corps + L_manche + marge_L) × (demi-poitrine + marge_P)
 *   × 2 × grammage × 12 / 10 000 000 → kg PAR DOUZAINE.
 * ×2 : devant + dos en double épaisseur ; ×12 : par douzaine.
 * Implémentation UNIQUE du projet : le cœur pur vit dans
 * `src/lib/cutting/consumption.ts` (tshirtFormulaCore) et cette
 * fonction validée délègue. Référence théorique UNIQUEMENT : ne
 * remplace pas le placement réel.
 */
export function tshirtTheoreticalKg(input: {
  bodyLengthCm: number;
  chestHalfCm: number;
  sleeveLengthCm: number;
  lengthAllowanceCm?: number;
  chestAllowanceCm?: number;
  grammageGm2: number;
}): { netKgPerDozen: number; netKgPerPiece: number; netM2PerDozen: number } {
  const bodyLengthCm = parsePositive(input.bodyLengthCm, 'Longueur du corps');
  const chestHalfCm = parsePositive(input.chestHalfCm, 'Demi-tour de poitrine');
  const sleeveLengthCm = parsePositive(input.sleeveLengthCm, 'Longueur de manche');
  const grammageGm2 = parsePositive(input.grammageGm2, 'Grammage');
  const lengthAllowanceCm = input.lengthAllowanceCm ?? 10;
  const chestAllowanceCm = input.chestAllowanceCm ?? 3;
  return tshirtFormulaCore({
    bodyLengthCm, chestHalfCm, sleeveLengthCm,
    lengthAllowanceCm, chestAllowanceCm, grammageGm2,
  });
}

/**
 * Consommation tissu d'un transfert (étape 18) — moteur central.
 * La longueur retenue est le matelas DÉCLARÉ (longueur réellement
 * déroulée saisie à la création du plan), JAMAIS la longueur occupée
 * par les pièces (marker_length_cm = max Y des placements), qui ignore
 * la queue de matelas et sous-estimerait la consommation. Le poids
 * déroulé dépend de la LARGEUR NOMINALE du tissu (lisière à lisière) :
 * dérouler 1 m consomme 1 m sur toute la largeur, même si seules les
 * pièces occupent la largeur utile. La largeur utile reste réservée au
 * placement des patrons. Largeur nominale absente ou grammage absent :
 * AUCUNE déduction (jamais de substitution silencieuse par la largeur
 * utile), avec cause explicite. Pas d'arrondi prématuré : précision
 * interne conservée, l'affichage arrondit. Anomalie bloquante : occupé
 * > matelas déclaré au-delà de la tolérance → erreur, déduction refusée.
 */
export interface FabricConsumption {
  fabricKg: number | null;
  fabricKgBasis: 'matelas_declare' | null;
  /** Cause explicite quand fabricKg est null malgré un matelas fiable. */
  unavailableReason: string | null;
}

export function resolveFabricConsumption(input: {
  markerLengthCm: number;
  matelasLengthCm: number;
  layers: number;
  /** Largeur NOMINALE du tissu (cm) — propriété du rouleau. */
  widthCm: number | null;
  grammageGm2: number | null;
}): FabricConsumption {
  if (input.markerLengthCm > input.matelasLengthCm + MARKER_TOLERANCE_CM) {
    throw new ServiceError(
      `Anomalie de plan : longueur occupée ${input.markerLengthCm} cm `
      + `> matelas déclaré ${input.matelasLengthCm} cm (tolérance `
      + `${MARKER_TOLERANCE_CM} cm). Corrigez le matelas ou le placement `
      + 'avant le transfert.',
      409,
    );
  }
  const unrolledIsReliable = Number.isFinite(input.matelasLengthCm)
    && input.matelasLengthCm > 0;
  const widthIsReliable = input.widthCm !== null
    && Number.isFinite(input.widthCm) && input.widthCm > 0;
  const fabricAreaM2 = unrolledIsReliable && widthIsReliable
    ? (input.layers * input.matelasLengthCm * (input.widthCm as number)) / 10000
    : null;
  const fabricKg = fabricAreaM2 !== null && input.grammageGm2 !== null
    ? (fabricAreaM2 * input.grammageGm2) / 1000
    : null;
  let unavailableReason: string | null = null;
  if (fabricKg === null && unrolledIsReliable) {
    if (!widthIsReliable) {
      unavailableReason = 'Largeur nominale du rouleau inconnue : déduction '
        + 'refusée (le poids déroulé dépend de la largeur réelle du tissu, '
        + 'pas de la largeur utile de placement).';
    } else if (input.grammageGm2 === null) {
      unavailableReason = 'Grammage du rouleau inconnu : consommation non décomptée.';
    }
  }
  return {
    fabricKg,
    fabricKgBasis: fabricKg !== null ? 'matelas_declare' : null,
    unavailableReason,
  };
}

/**
 * Estimation prévisionnelle par produit et taille (lecture seule).
 * Le grammage et la largeur utile sont fournis par l'appelant (ils
 * appartiennent au rouleau, pas au produit). Sans eux : surfaces et
 * longueurs seulement, jamais de kg inventés.
 *
 * Hiérarchie des méthodes :
 * 1. 'historique_placement' — efficacité réelle des plans validés ;
 * 2. 'theorique_tshirt' / 'theorique_famille' — FORMULE DE RÉFÉRENCE
 *    du cahier des charges (ORDNUR C12 pour le tshirt, somme de
 *    panneaux dédiée pour les autres familles), calculée depuis les
 *    mesures VALIDÉES de la fiche technique ; wastage appliqué UNE
 *    fois ; remplace l'ancienne surface nette comme calcul théorique
 *    automatique du parcours ;
 * 3. 'surfaces_nettes' — repli explicite (fiche absente/incomplète ou
 *    grammage absent) : borne basse, jamais présentée comme formule.
 */
export function estimateFabricForProduct(
  db: Database.Database,
  rawProductId: unknown,
  rawSizeId: unknown,
  options: {
    qty: number;
    grammageGm2?: number | null;
    usableWidthCm?: number | null;
    /** Wastage (%) appliqué UNE fois sur la formule de référence. */
    wastagePct?: number | null;
    /** Marges ORDNUR (cm) — défauts de la formule : 10 / 3. */
    lengthAllowanceCm?: number | null;
    chestAllowanceCm?: number | null;
  },
): FabricEstimateResult {
  const productId = requireId(rawProductId, 'Le produit');
  const sizeId = requireId(rawSizeId, 'La taille');
  const qty = requireId(options.qty, 'La quantité');
  if (qty <= 0) throw new ServiceError('La quantité doit être positive.', 400);
  const grammage = options.grammageGm2 ?? null;
  if (grammage !== null && grammage <= 0) {
    throw new ServiceError('Le grammage doit être positif.', 400);
  }
  const usableWidthCm = options.usableWidthCm ?? null;
  if (usableWidthCm !== null && usableWidthCm <= 0) {
    throw new ServiceError('La largeur utile doit être positive.', 400);
  }
  const wastagePct = options.wastagePct ?? 0;
  if (!Number.isFinite(wastagePct) || wastagePct < 0 || wastagePct > 100) {
    throw new ServiceError('Le wastage doit être un nombre entre 0 et 100.', 400);
  }
  const wastageFactor = 1 + wastagePct / 100;
  const product = db.prepare('SELECT id, nom FROM products WHERE id = ?')
    .get(productId) as { id: number; nom: string } | undefined;
  if (!product) throw new ServiceError('Produit introuvable.', 404);
  const pieces = db.prepare(
    `SELECT piece_code, piece_label, geometry_json, qty_multiplier
     FROM pattern_pieces
     WHERE product_id = ? AND size_id = ? AND is_validated = 1
     ORDER BY id`,
  ).all(productId, sizeId) as Array<{
    piece_code: string; piece_label: string;
    geometry_json: string; qty_multiplier: number;
  }>;
  if (pieces.length === 0) {
    throw new ServiceError(
      'Aucune pièce validée pour ce produit et cette taille : estimation impossible.',
      404,
    );
  }
  const sizeLabel = (db.prepare('SELECT nom FROM sizes WHERE id = ?')
    .get(sizeId) as { nom: string } | undefined)?.nom ?? '—';
  const sizes: FabricEstimateSizeRow[] = [{
    sizeId,
    sizeLabel,
    netAreaM2: pieces.reduce(
      (sum, piece) => sum
        + geometryAreaM2(piece.geometry_json) * piece.qty_multiplier,
      0,
    ),
    pieceCount: pieces.reduce((sum, piece) => sum + piece.qty_multiplier, 0),
  }];
  const history = db.prepare(
    `SELECT COUNT(*) AS n, AVG(efficiency) AS avg_efficiency
     FROM marker_plans WHERE product_id = ? AND status = 'valide' AND efficiency > 0`,
  ).get(productId) as { n: number; avg_efficiency: number | null };
  const missingData: string[] = [];
  const notes: string[] = [];
  const netAreaM2 = sizes[0].netAreaM2 * qty;

  // Formule de référence par famille (ORDNUR C12 pour le tshirt) :
  // mesures validées de la fiche technique, grammage requis pour le kg.
  const family = (db.prepare(
    'SELECT family FROM coupe_catalogue WHERE product_id = ?',
  ).get(productId) as { family: string } | undefined)?.family ?? null;
  const ficheRow = db.prepare(
    `SELECT mesures_json FROM fiches_techniques
      WHERE product_id = ? AND size_id = ? AND statut = 'valide'
      ORDER BY version DESC, id DESC LIMIT 1`,
  ).get(productId, sizeId) as { mesures_json: string } | undefined;
  const mesures = ficheRow ? parseFicheMesures(ficheRow.mesures_json) : null;
  let theoretical: FabricEstimateResult['theoretical'] = null;
  if (family !== null && mesures !== null) {
    if (grammage === null) {
      missingData.push(
        'Grammage non fourni : la formule de référence ne peut pas convertir en kg.',
      );
    } else {
      try {
        const ff = familyFormulaKg(family, mesures, grammage, {
          lengthAllowanceCm: options.lengthAllowanceCm ?? undefined,
          chestAllowanceCm: options.chestAllowanceCm ?? undefined,
        });
        theoretical = {
          family,
          formula: ff.formula,
          netKgPerPiece: ff.kgPerPiece,
          netKgPerDozen: ff.kgPerDozen,
          netKgTotal: ff.kgPerPiece * qty,
          wastagePct,
          kgWithWastage: ff.kgPerPiece * qty * wastageFactor,
          panelsAreaM2PerPiece: ff.panels.reduce(
            (sum, panel) => sum + panel.areaM2, 0,
          ),
        };
        notes.push(
          family === 'tshirt'
            ? 'Formule de référence ORDNUR (C12) : devant + dos, marges '
              + 'longueur/poitrine incluses ; le col et les manches sont '
              + 'approximés par le rectangle de la formule.'
            : `Formule de référence « panneaux » dédiée à la famille `
              + `« ${family} » (la formule T-shirt ne s'applique pas).`,
        );
        if (wastagePct > 0) {
          notes.push(
            `Wastage de ${wastagePct} % appliqué UNE seule fois sur le total net.`,
          );
        }
      } catch (cause) {
        notes.push(
          `Formule de référence indisponible : ${(cause as Error).message}`,
        );
      }
    }
  } else if (grammage !== null) {
    missingData.push(
      'Fiche technique validée introuvable pour ce produit et cette taille : '
      + 'la formule de référence ne peut pas être appliquée.',
    );
  }

  let method: FabricEstimateResult['method'];
  let efficiencyPct: number | null = null;
  let reliable = false;
  let estimatedAreaM2: number | null = null;
  if (history.n >= MIN_HISTORY_SAMPLE && history.avg_efficiency !== null) {
    method = 'historique_placement';
    efficiencyPct = history.avg_efficiency;
    reliable = true;
    estimatedAreaM2 = netAreaM2 / (history.avg_efficiency / 100);
    notes.push(
      `Efficacité moyenne de ${history.n} plan(s) validé(s) : `
      + `${history.avg_efficiency.toFixed(1)} % (chutes de placement incluses).`,
    );
  } else if (theoretical !== null) {
    method = family === 'tshirt' ? 'theorique_tshirt' : 'theorique_famille';
    estimatedAreaM2 = theoretical.panelsAreaM2PerPiece * qty * wastageFactor;
  } else {
    method = 'surfaces_nettes';
    estimatedAreaM2 = netAreaM2;
    if (!missingData.some((item) => item.includes('Fiche technique validée'))) {
      missingData.push(
        `Efficacité de placement historique indisponible `
        + `(${history.n} plan(s) validé(s) sur ${MIN_HISTORY_SAMPLE} requis) : `
        + 'les chutes de placement ne sont PAS incluses.',
      );
    }
    notes.push('Borne basse : poids net des pièces, sans chutes ni queue de matelas.');
  }
  let estimatedKg: number | null = null;
  let estimatedLengthM: number | null = null;
  if (theoretical !== null
    && (method === 'theorique_tshirt' || method === 'theorique_famille')) {
    estimatedKg = theoretical.kgWithWastage;
  } else if (estimatedAreaM2 !== null && grammage !== null) {
    estimatedKg = (estimatedAreaM2 * grammage) / 1000;
  }
  if (grammage === null) {
    missingData.push('Grammage non fourni : estimation en kg indisponible.');
  }
  if (estimatedAreaM2 !== null && usableWidthCm !== null) {
    estimatedLengthM = estimatedAreaM2 / (usableWidthCm / 100);
  } else if (usableWidthCm === null) {
    missingData.push('Largeur utile non fournie : estimation en mètres indisponible.');
  }
  return {
    productId,
    productName: product.nom,
    method,
    reliable,
    efficiencyPct,
    historySample: history.n,
    estimatedAreaM2,
    estimatedLengthM,
    estimatedKg,
    theoretical,
    missingData,
    sizes,
    notes,
  };
}

/**
 * Parse minimal des mesures d'une fiche technique validée
 * (JSON objet libellé → nombre). Mêmes règles que `fiches.ts` :
 * valeurs non numériques ignorées, libellés tronqués.
 * Également utilisé par la validation des plans (calcul théorique).
 */
export function parseFicheMesures(raw: string): Record<string, number> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const mesures: Record<string, number> = {};
    for (const [label, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (Number.isFinite(num)) mesures[label.trim()] = num;
    }
    return Object.keys(mesures).length > 0 ? mesures : null;
  } catch {
    return null;
  }
}
