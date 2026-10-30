'use client';

/**
 * Client API du module Coupe : contrats EXACTS des routes de l'étape 2
 * (GET /api/cutting/workspace, POST /api/cutting/atelier). Aucune
 * route ni propriété inventée : les structures reflètent les services
 * serveur réels.
 */

import type { Point } from '@/lib/cutting/types';

export interface RollDTO {
  id: number;
  code: string;
  fabricRef: string;
  colorNom: string | null;
  weightKg: number;
  lengthM: number | null;
  widthCm: number | null;
  usableWidthCm: number | null;
  grammageGm2: number | null;
  status: string;
}

/** Rouleau détaillé avec alertes de cohérence (étape 13). */
export interface RollDetailDTO {
  id: number;
  code: string;
  fabricRef: string;
  colorNom: string | null;
  weightKg: number;
  remainingWeightKg: number | null;
  lengthM: number | null;
  consumedM: number | null;
  remainingM: number | null;
  widthCm: number | null;
  usableWidthCm: number | null;
  grammageGm2: number | null;
  status: string;
  createdAt: string;
  responsable: string | null;
  alerts: Array<{ code: string; message: string }>;
}

/** Mouvement de rouleau (historique, étape 13). */
export interface MovementDTO {
  id: number;
  movementType: string;
  qty: number | null;
  unit: string | null;
  reason: string | null;
  username: string;
  createdAt: string;
}

/** Pièces imposées par les règles de patronage R2 pour une famille. */
export interface FamilyRuleDTO {
  family: string;
  requiredPieces: string[];
  optionalPieces: string[];
}

export interface TableDTO {
  id: number;
  nom: string;
  largeurCm: number;
  longueurMaxCm: number;
  largeurUtileCm: number;
  couchesMax: number;
  isActive: boolean;
}

export interface SizeDTO { id: number; nom: string }

export interface CatalogueDTO {
  productId: number;
  nom: string;
  family: string;
  category: 'adulte' | 'enfant';
  sizeNames: string[];
  sizes: SizeDTO[];
  measurementLabels: string[];
  isActive: boolean;
}

export interface FicheDTO {
  id: number;
  productId: number;
  sizeId: number | null;
  sizeNom: string | null;
  fabricType: string | null;
  colorNom: string | null;
  mesures: Record<string, number>;
  statut: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PieceDTO {
  id: number;
  code: string;
  label: string;
  component: string;
  points: Point[];
  widthCm: number;
  heightCm: number;
  qty: number;
  grainDirection: 'along' | 'cross' | 'any';
  allowedRotations: number[];
  seamAllowanceCm: number;
  seamIncluded: boolean;
  required: boolean;
  status: 'configuree' | 'incomplete';
}

export interface UnconfiguredDTO {
  code: string;
  label: string;
  missingLabels: string[];
  required: boolean;
}

export interface RevisionDTO {
  id: number;
  productId: number;
  sizeId: number;
  modelName: string;
  fabricRef: string;
  version: number;
  ficheId: number;
  ficheVersion: number;
  sourceName: string;
  status: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  pieces: PieceDTO[];
  unconfigured?: UnconfiguredDTO[];
  createdAt: string;
}

export interface PlacementDTO {
  pieceId: number;
  code: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  points: Point[];
}

export interface RectDTO { x: number; y: number; width: number; height: number }

export interface CutPieceCountDTO {
  pieceId: number;
  label: string;
  qtyPerLayer: number;
  layers: number;
  totalQty: number;
}

/** Estimation théorique calculée côté serveur à la validation du plan. */
export interface PlanTheoreticalDTO {
  family: string;
  /** 'C12' : formule ORDNUR (tshirt) ; 'panneaux' : somme dédiée. */
  formula: 'C12' | 'panneaux';
  grammageGm2: number;
  wastagePct: number;
  netKgPerPiece: number;
  netKgTotal: number;
  kgWithWastage: number;
  computedAt: string;
  sizes: Array<{
    sizeId: number;
    label: string;
    garments: number;
    netKgPerPiece: number;
    netKgTotal: number;
  }>;
}

export interface PlanDTO {
  id: number;
  product_id: number;
  category: string;
  usable_width_cm: number;
  matelas_length_cm: number;
  layers: number;
  gap_cm: number;
  sizes_json: string;
  pieces_json: string;
  marker_length_cm: number;
  total_pieces: number;
  placed_area_m2: number;
  available_area_m2: number;
  efficiency: number;
  waste_area_m2: number;
  status: 'proposition' | 'valide';
  /** Lot Couture créé au transfert (null → pas encore transféré). */
  lot_id: number | null;
  created_by: number;
  coupe_table_id: number | null;
  roll_id: number | null;
  input_json: string | null;
  created_at: string;
  updated_at: string;
  placements: PlacementDTO[];
  zone: RectDTO;
  cutPieces: CutPieceCountDTO[];
  /** Estimation théorique enregistrée à la validation (null sinon). */
  theoretical: PlanTheoreticalDTO | null;
  /** Cause explicite d'absence d'estimation (null si calculée). */
  theoreticalUnavailable: string | null;
}

export interface WorkspaceData {
  rolls: RollDTO[];
  /** Tous les rouleaux (y compris bloqués/épuisés) avec alertes. */
  rollsAll?: RollDetailDTO[];
  tables: TableDTO[];
  catalogue: CatalogueDTO[];
  colors: Array<{ id: number; nom: string }>;
  /** Tailles actives (gestion des rouleaux et produits, étape 12). */
  sizes: Array<{ id: number; nom: string }>;
  fiches: FicheDTO[];
  revisions: RevisionDTO[];
  plans: PlanDTO[];
  canValidatePlan: boolean;
  /** Règles R2 par famille (pièces obligatoires/optionnelles). */
  familyRules?: FamilyRuleDTO[];
}

export interface VerifyResult {
  ok: boolean;
  violations: Array<{ index: number; code: string; reason: string }>;
}

/** Résultat du transfert Coupe → Couture (étape 8). */
export interface CutTransferResult {
  planId: number;
  lotId: number;
  lotCode: string;
  transferId: number;
  transferCode: string;
  ticketTransfertCode: string;
  /** Numéro lisible du ticket (TRF-AAAA-NNNNNN). */
  ticketNo: string;
  sizeId: number;
  garmentsPerLayer: number;
  transferredQty: number;
  layers: number;
  fabricConsumedKg: number | null;
  /** Base du calcul : « matelas_declare » = valeur déclarée, pas une mesure. */
  fabricKgBasis?: 'matelas_declare' | null;
  /** Cause explicite quand la consommation n'est pas décomptée. */
  fabricKgUnavailableReason?: string | null;
  cutPieces: CutPieceCountDTO[];
}

export interface OptimizeMetrics {
  consumedLengthCm: number;
  usableWidthCm: number;
  piecesAreaM2: number;
  consumedAreaM2: number;
  wasteAreaM2: number;
  utilizationPct: number;
  placedCount: number;
  unplacedCount: number;
}

export interface OptimizePlacementDTO {
  pieceId: number;
  code: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  points: Point[];
}

export interface OptimizeResult {
  planId: number;
  revisionId: number;
  method: 'shelf-ffd' | 'nest-blf';
  /** Temps de calcul total mesuré (ms). */
  computeMs?: number;
  /** Compteurs de recherche (transparence, non contractuels). */
  stats?: {
    candidatesTested: number;
    exactTests: number;
    expired: boolean;
  };
  /** Statistiques de la recherche locale (retenue ou tentée). */
  improve?: {
    movesAccepted: number;
    exactTests: number;
    passes: number;
    expired: boolean;
  };
  improveApplied?: boolean;
  phaseMs?: { shelfFfd: number; nestBlf: number; localImprove: number };
  budgetExpired?: boolean;
  fallbackUsed?: boolean;
  /** Stratégies comparées par le moteur multi-stratégies (étape 16). */
  candidates?: Array<{
    strategy: string;
    unplaced: number;
    consumedLengthCm: number;
    retained: boolean;
  }>;
  placements: OptimizePlacementDTO[];
  unplaced: Array<{ code: string; label: string; quantity: number; reason: string }>;
  metrics: OptimizeMetrics;
  wasteKg: number | null;
  grammageGm2: number | null;
  availableLengthCm: number;
  /** Jeux complets placés sur le matelas (calcul auto). */
  setsCount?: number;
  /** Pièces par jeu complet (ex. polo = 6). */
  piecesPerSet?: number;
  /** Couches de tissu du plan. */
  layers?: number;
  /** Vêtements obtenus = jeux × couches. */
  garmentsTotal?: number;
  /** Pièces coupées obtenues. */
  piecesTotal?: number;
}

/** Matelas dupliqué automatiquement (remplissage multi-matelas). */
export interface AutofillDuplicate {
  planId: number;
  /** Jeux complets placés sur ce matelas dupliqué. */
  sets: number;
}

/** Résultat de l'action plan.autofill (calcul automatique multi-matelas). */
export interface AutofillResult {
  placements: OptimizePlacementDTO[];
  method: 'shelf-ffd' | 'nest-blf';
  metrics: OptimizeMetrics;
  /** Pièces par jeu complet (ex. polo = 6). */
  piecesPerSet: number;
  /** Jeux complets sur CE matelas (matelas plein). */
  setsOnPlan: number;
  /** Capacité d'un matelas plein : jeux complets qui tiennent. */
  capacitySets: number;
  layers: number;
  /** Vêtements par matelas plein = capacitySets × couches. */
  garmentsPerMatelas: number;
  /** Pièces brutes par matelas plein. */
  piecesPerMatelas: number;
  /** Métrage de tissu consommé par matelas (m) = longueur × couches. */
  fabricPerMatelasM: number;
  /** Métrage disponible sur le rouleau (m), null si inconnu. */
  rollAvailableM: number | null;
  /** Métrage restant après coupe de tous les matelas (m). */
  rollRemainingAfterM: number | null;
  /** Nombre total de matelas pleins (plan courant + dupliqués). */
  totalMatelas: number;
  /** Vêtements totaux obtenus. */
  totalGarments: number;
  /** Pièces totales obtenues (tous matelas). */
  totalPieces: number;
  /** Matelas dupliqués créés et remplis automatiquement. */
  duplicates: AutofillDuplicate[];
}

/** Métriques enregistrées d'un plan, avant et après recalcul explicite. */
export interface MarkerStats {
  markerLengthCm: number;
  placedAreaM2: number;
  efficiency: number;
  wasteAreaM2: number;
}

/** Résultat de l'action plan.remetrics (étape 10). */
export interface RemetricsResult {
  item: PlanDTO;
  before: MarkerStats;
  after: MarkerStats;
}

/** Image de patron générée depuis les contours validés (étape 12). */
export interface PatternPreview {
  revisionId: number;
  modelName: string;
  pieceCount: number;
  svg: string;
}

export interface PatternDemoDTO {
  family: string;
  pieces: Array<{
    code: string;
    label: string;
    qty: number;
    required: boolean;
    outline: Point[];
  }>;
}

interface ApiBody {
  status?: string;
  message?: string;
  workspace?: WorkspaceData;
  item?: unknown;
  result?: unknown;
}

async function readBody(response: Response): Promise<ApiBody> {
  return (await response.json().catch(() => ({}))) as ApiBody;
}

/** Chargement du contexte complet de l'atelier. */
export async function loadWorkspace(): Promise<WorkspaceData> {
  const response = await fetch('/api/cutting/workspace', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await readBody(response);
  if (!response.ok || !body.workspace) {
    throw new Error(body.message ?? 'Erreur de chargement de l’atelier.');
  }
  return body.workspace;
}

/** Action d'atelier : retourne `item`/`result` ou lève une erreur FR. */
export async function atelierAction<T>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('/api/cutting/atelier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, input }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(body.message ?? 'L’opération a échoué.');
  }
  return (body.item ?? body.result) as T;
}
