import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { PiecePlacement, Rotation } from '@/lib/cutting/types';
import { polygonArea, transformContour } from '@/lib/cutting/geometry';
import { assertCoupePlanValidation, assertCoupeWrite, inTransaction } from './common';
import {
  getPlan,
  parsePlacementInput,
  readRevisionId,
  verifyPlan,
  type PlanItem,
  type ParsedPlacement,
} from './plans';
import { requireValidatedRevision, type RevisionPiece } from './patterns';
import { familyFormulaKg } from '@/lib/cutting/consumption';
import { parseFicheMesures } from './fabric-estimate';
import {
  readPlanInputJson,
  type PlanTheoreticalSize,
  type PlanTheoreticalSummary,
} from './plans';

/**
 * Sauvegarde explicite et validation finale des plans de coupe.
 * - `savePlan` : refuse d'enregistrer un plan contenant une pièce
 *   invalide ; l'état reste « proposition » tant que la validation
 *   finale n'a pas été prononcée.
 * - `validatePlan` : chef de coupe ou administrateur ; le plan validé est
 *   immuable (triggers SQL), les placements ne sont plus modifiables.
 * Les contours persistés sont toujours recalculés côté serveur à
 * partir des définitions de la révision : le client ne fournit que
 * pieceId / x / y / rotation.
 */

function planStats(
  plan: PlanItem,
  placements: PiecePlacement[],
): {
  piecesJson: string;
  totalPieces: number;
  placedArea: number;
  consumedLength: number;
  efficiency: number;
  wasteArea: number;
} {
  const placedArea = placements.reduce(
    (sum, placement) => sum + polygonArea(placement.points),
    0,
  ) / 10000;
  // Longueur réellement occupée = max(y + emprise) des contours
  // recalculés serveur (jamais saisie par l'utilisateur).
  let consumedLength = 0;
  for (const placement of placements) {
    for (const point of placement.points) {
      if (point.y > consumedLength) consumedLength = point.y;
    }
  }
  const available = plan.available_area_m2;
  const efficiency = available > 0
    ? Math.min(100, Math.round((placedArea / available) * 10000) / 100)
    : 0;
  return {
    piecesJson: JSON.stringify(placements),
    totalPieces: placements.length,
    placedArea: Math.round(placedArea * 10000) / 10000,
    consumedLength: Math.round(consumedLength * 100) / 100,
    efficiency,
    wasteArea: Math.round((available - placedArea) * 10000) / 10000,
  };
}

/** Contours reconstruits serveur + refus de toute pièce étrangère au plan. */
function buildStoredPlacements(
  db: Database.Database,
  revisionId: number,
  parsed: ParsedPlacement[],
): PiecePlacement[] {
  const revision = requireValidatedRevision(db, revisionId);
  return parsed.map((item) => {
    const piece = revision.pieces.find((candidate) => candidate.id === item.pieceId);
    if (!piece) {
      throw new ServiceError(
        `Pièce ${item.pieceId} étrangère à la révision du plan.`,
        409,
      );
    }
    return {
      pieceId: item.pieceId,
      code: piece.code,
      label: piece.label,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      points: transformContour(piece.points, item.rotation, item.x, item.y),
    };
  });
}

/** Sauvegarde explicite : état recalculé côté serveur, jamais fourni par le client. */
export function savePlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
  placements: unknown,
): PlanItem {
  assertCoupeWrite(actor);
  const plan = getPlan(db, planId);
  if (plan.status === 'valide') {
    throw new ServiceError(
      'Plan validé immuable : créez un nouveau plan pour modifier le placement.',
      409,
    );
  }
  const revisionId = readRevisionId(plan.input_json);
  if (revisionId === null) {
    throw new ServiceError('Plan sans révision de patron associée.', 409);
  }
  const result = verifyPlan(db, planId, placements);
  if (!result.ok) {
    const detail = result.violations
      .slice(0, 3)
      .map((violation) => violation.reason)
      .join(' | ');
    throw new ServiceError(
      `Placement invalide, sauvegarde refusée : ${detail}`,
      409,
    );
  }
  const parsed = parsePlacementInput(placements);
  const stored = buildStoredPlacements(db, revisionId, parsed);
  const stats = planStats(plan, stored);
  return inTransaction(db, () => {
    db.prepare(
      `UPDATE marker_plans
          SET pieces_json = ?, total_pieces = ?, placed_area_m2 = ?,
              marker_length_cm = ?, efficiency = ?, waste_area_m2 = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      stats.piecesJson,
      stats.totalPieces,
      stats.placedArea,
      stats.consumedLength,
      stats.efficiency,
      stats.wasteArea,
      planId,
    );
    return getPlan(db, planId);
  });
}

/**
 * Consommation théorique du plan selon la famille du produit
 * (formule de référence ORDNUR « C12 » pour le tshirt, somme de
 * panneaux dédiée pour les autres familles du catalogue).
 * Données indispensables : famille du catalogue, grammage (plan ou
 * rouleau), fiche technique VALIDÉE avec les mesures de chaque taille.
 * Aucune donnée n'est inventée : une donnée absente lève une erreur
 * explicite (l'appelant la convertit en cause d'indisponibilité).
 */
export function computePlanTheoretical(
  db: Database.Database,
  plan: PlanItem,
  wastagePct: number,
): PlanTheoreticalSummary {
  const familyRow = db.prepare(
    'SELECT family FROM coupe_catalogue WHERE product_id = ?',
  ).get(plan.product_id) as { family: string } | undefined;
  if (!familyRow || familyRow.family === '') {
    throw new ServiceError(
      `Famille du produit introuvable dans le catalogue (produit #${plan.product_id}) : `
      + 'consommation théorique impossible.',
      409,
    );
  }
  const family = familyRow.family;
  let grammage = plan.grammage_g_m2;
  if ((grammage === null || grammage === undefined) && plan.roll_id !== null) {
    const roll = db.prepare(
      'SELECT grammage_g_m2 FROM coupe_rolls WHERE id = ?',
    ).get(plan.roll_id) as { grammage_g_m2: number | null } | undefined;
    grammage = roll?.grammage_g_m2 ?? null;
  }
  if (grammage === null || grammage === undefined || grammage <= 0) {
    throw new ServiceError(
      'Grammage indisponible (ni sur le plan, ni sur le rouleau) : '
      + 'la consommation théorique en kg ne peut pas être calculée.',
      409,
    );
  }
  let sizeEntries: Array<{ sizeId: number; qty: number }>;
  try {
    const parsed: unknown = JSON.parse(plan.sizes_json);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('vide');
    }
    sizeEntries = parsed.map((entry) => {
      const record = entry as { sizeId?: unknown; qty?: unknown };
      const sizeId = Number(record.sizeId);
      const qty = Number(record.qty);
      if (!Number.isInteger(sizeId) || sizeId <= 0
        || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('entrée invalide');
      }
      return { sizeId, qty };
    });
  } catch {
    throw new ServiceError(
      'Liste des tailles du plan absente ou invalide : '
      + 'consommation théorique impossible.',
      409,
    );
  }
  const details: PlanTheoreticalSize[] = [];
  for (const entry of sizeEntries) {
    const sizeLabel = (db.prepare('SELECT nom FROM sizes WHERE id = ?')
      .get(entry.sizeId) as { nom: string } | undefined)?.nom
      ?? `taille #${entry.sizeId}`;
    const ficheRow = db.prepare(
      `SELECT mesures_json FROM fiches_techniques
        WHERE product_id = ? AND size_id = ? AND statut = 'valide'
        ORDER BY version DESC, id DESC LIMIT 1`,
    ).get(plan.product_id, entry.sizeId) as { mesures_json: string } | undefined;
    if (!ficheRow) {
      throw new ServiceError(
        `Fiche technique validée introuvable pour la taille « ${sizeLabel} » : `
        + 'les mesures du vêtement sont indispensables à la formule de référence.',
        409,
      );
    }
    const mesures = parseFicheMesures(ficheRow.mesures_json);
    if (mesures === null) {
      throw new ServiceError(
        `Mesures illisibles dans la fiche technique validée de la taille `
        + `« ${sizeLabel} » : consommation théorique impossible.`,
        409,
      );
    }
    let ff;
    try {
      ff = familyFormulaKg(family, mesures, grammage);
    } catch (cause) {
      throw new ServiceError(
        `Formule de référence indisponible pour la famille « ${family} » `
        + `(taille « ${sizeLabel} ») : ${(cause as Error).message}`,
        409,
      );
    }
    // Chaque couche produit `qty` vêtements de cette taille.
    const garments = entry.qty * plan.layers;
    details.push({
      sizeId: entry.sizeId,
      label: sizeLabel,
      garments,
      netKgPerPiece: ff.kgPerPiece,
      netKgTotal: ff.kgPerPiece * garments,
    });
  }
  const netKgTotal = details.reduce((sum, size) => sum + size.netKgTotal, 0);
  const totalGarments = details.reduce((sum, size) => sum + size.garments, 0);
  const wastageFactor = 1 + wastagePct / 100;
  return {
    family,
    formula: family === 'tshirt' ? 'C12' : 'panneaux',
    grammageGm2: grammage,
    wastagePct,
    netKgPerPiece: totalGarments > 0 ? netKgTotal / totalGarments : 0,
    netKgTotal,
    // Wastage appliqué UNE seule fois, sur le total.
    kgWithWastage: netKgTotal * wastageFactor,
    computedAt: new Date().toISOString(),
    sizes: details,
  };
}

/** Validation finale : chef de coupe, plan sauvegardé et géométriquement valide. */
export function validatePlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
): PlanItem {
  assertCoupePlanValidation(actor);
  const plan = getPlan(db, planId);
  if (plan.status === 'valide') return plan;
  if (plan.status !== 'proposition') {
    throw new ServiceError('Plan dans un état non validable.', 409);
  }
  const result = verifyPlan(db, planId, plan.placements);
  if (!result.ok) {
    throw new ServiceError(
      'Le plan contient des pièces invalides : validation refusée.',
      409,
    );
  }
  if (plan.placements.length === 0) {
    throw new ServiceError(
      'Aucune pièce placée : validez un plan réellement préparé.',
      409,
    );
  }
  // Calcul automatique de consommation au moment de la validation,
  // selon la famille du produit (formule de référence ORDNUR pour le
  // tshirt). Les vérifications géométriques restent la condition
  // première ; l'estimation théorique est enregistrée avec le plan.
  // Données absentes (grammage, fiche) → cause explicite persistée,
  // jamais de valeur inventée ni de validation « incorrecte ».
  const planInput = readPlanInputJson(plan.input_json);
  const wastagePct = planInput.wastagePct ?? 0;
  let theoretical: PlanTheoreticalSummary | null = null;
  let theoreticalUnavailable: string | null = null;
  try {
    theoretical = computePlanTheoretical(db, plan, wastagePct);
  } catch (cause) {
    theoreticalUnavailable = (cause as Error).message;
  }
  return inTransaction(db, () => {
    db.prepare(
      `UPDATE marker_plans
          SET status = 'valide', validated_by = ?,
              validated_at = datetime('now'), updated_at = datetime('now'),
              input_json = ?
        WHERE id = ?`,
    ).run(
      actor.id,
      JSON.stringify({
        revisionId: planInput.revisionId,
        wastagePct,
        theoretical,
        theoreticalUnavailable,
      }),
      planId,
    );
    return getPlan(db, planId);
  });
}

export interface MarkerStats {
  markerLengthCm: number;
  placedAreaM2: number;
  efficiency: number;
  wasteAreaM2: number;
}

export interface RemetricsResult {
  item: PlanItem;
  before: MarkerStats;
  after: MarkerStats;
}

function statsOf(plan: PlanItem): MarkerStats {
  return {
    markerLengthCm: plan.marker_length_cm,
    placedAreaM2: plan.placed_area_m2,
    efficiency: plan.efficiency,
    wasteAreaM2: plan.waste_area_m2,
  };
}

/**
 * Recalcul explicite des métriques d'un plan brouillon (étape 10) :
 * contours reconstruits depuis la révision actuelle, longueur réellement
 * occupée ré-enregistrée. Jamais automatique : l'interface demande une
 * confirmation et affiche avant/après. Un plan validé (a fortiori
 * transféré) est refusé : les métriques historiques sont conservées.
 */
export function remetricsPlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
): RemetricsResult {
  assertCoupeWrite(actor);
  const plan = getPlan(db, planId);
  if (plan.status === 'valide') {
    throw new ServiceError(
      'Plan validé immuable : les métriques historiques sont conservées.',
      409,
    );
  }
  if (plan.placements.length === 0) {
    throw new ServiceError('Aucune pièce enregistrée : rien à recalculer.', 409);
  }
  const revisionId = readRevisionId(plan.input_json);
  if (revisionId === null) {
    throw new ServiceError('Plan sans révision de patron associée.', 409);
  }
  const result = verifyPlan(db, planId, plan.placements);
  if (!result.ok) {
    const detail = result.violations
      .slice(0, 3)
      .map((violation) => violation.reason)
      .join(' | ');
    throw new ServiceError(
      `Placement enregistré invalide, recalcul refusé : ${detail}`,
      409,
    );
  }
  const stored = buildStoredPlacements(db, revisionId, plan.placements);
  const stats = planStats(plan, stored);
  const before = statsOf(plan);
  const after: MarkerStats = {
    markerLengthCm: stats.consumedLength,
    placedAreaM2: stats.placedArea,
    efficiency: stats.efficiency,
    wasteAreaM2: stats.wasteArea,
  };
  return inTransaction(db, () => {
    db.prepare(
      `UPDATE marker_plans
          SET pieces_json = ?, total_pieces = ?, placed_area_m2 = ?,
              marker_length_cm = ?, efficiency = ?, waste_area_m2 = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      stats.piecesJson, stats.totalPieces, stats.placedArea,
      stats.consumedLength, stats.efficiency, stats.wasteArea, planId,
    );
    return { item: getPlan(db, planId), before, after };
  });
}
