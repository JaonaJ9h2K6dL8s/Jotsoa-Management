/**
 * Types partagés du module Coupe (client + serveur).
 */

export type RollStatus =
  | 'disponible'
  | 'en_utilisation'
  | 'epuise'
  | 'bloque'
  | 'defectueux';

export type LotStatus =
  | 'brouillon'
  | 'a_verifier'
  | 'plan_a_valider'
  | 'pret_a_couper'
  | 'en_coupe'
  | 'resultat_a_confirmer'
  | 'coupe'
  | 'transfert_pret'
  | 'pret_transfert'
  | 'transfere'
  | 'annule'
  | 'bloque';

export type TaskStatus =
  | 'a_faire'
  | 'en_cours'
  | 'en_attente'
  | 'terminee'
  | 'a_verifier'
  | 'validee'
  | 'bloquee'
  | 'annulee';

export type WasteType = 'chute' | 'dechet' | 'tissu_defectueux' | 'autre';

export type IdentifierType = 'rouleau' | 'lot' | 'paquet';

export const ROLL_STATUS_LABELS: Record<RollStatus, string> = {
  disponible: 'Disponible',
  en_utilisation: 'En utilisation',
  epuise: 'Épuisé',
  bloque: 'Bloqué',
  defectueux: 'Défectueux',
};

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  brouillon: 'Brouillon',
  a_verifier: 'Vérification',
  plan_a_valider: 'Plan à valider',
  pret_a_couper: 'Prêt à couper',
  en_coupe: 'En coupe',
  resultat_a_confirmer: 'Résultat à confirmer',
  coupe: 'Coupé',
  transfert_pret: 'Transfert prêt',
  pret_transfert: 'Prêt pour transfert',
  transfere: 'Transféré',
  annule: 'Annulé',
  bloque: 'Bloqué',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  terminee: 'Terminée',
  a_verifier: 'À vérifier',
  validee: 'Validée',
  bloquee: 'Bloquée',
  annulee: 'Annulée',
};

export const WASTE_TYPE_LABELS: Record<WasteType, string> = {
  chute: 'Chute',
  dechet: 'Déchet',
  tissu_defectueux: 'Tissu défectueux',
  autre: 'Autre',
};

export interface RollDTO {
  id: number;
  code: string;
  fabricRef: string;
  colorId: number | null;
  colorNom: string | null;
  initialWeightKg: number;
  initialQty: number | null;
  qtyUnit: string | null;
  remainingWeightKg: number | null;
  remainingQty: number | null;
  supplier: string | null;
  status: RollStatus;
  observations: string | null;
  receivedAt: string;
  updatedAt: string;
  qrPayload?: string;
  grammageGm2?: number | null;
  usableWidthCm?: number | null;
}

export interface LotSizeDTO {
  id: number;
  sizeId: number;
  sizeLabel: string;
  plannedQty: number;
}

export interface TaskResultDTO {
  sizeId: number;
  sizeLabel: string;
  plannedQty: number;
  cutQty: number;
  usableQty: number;
  anomalyQty: number;
  wasteQty: number;
}

export interface TaskRollDTO {
  rollId: number;
  rollCode: string;
  weightUsed: number | null;
}

export interface TaskDTO {
  id: number;
  lotId: number;
  code: string;
  description: string;
  isMandatory: boolean;
  requiresResults: boolean;
  status: TaskStatus;
  responsableId: number;
  responsableNom: string | null;
  observations: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  validatedBy: number | null;
  validatedByName: string | null;
  validatedAt: string | null;
  validationNotes: string | null;
  results: TaskResultDTO[];
  rolls: TaskRollDTO[];
}

export interface LotDTO {
  id: number;
  code: string;
  productId: number;
  productNom: string;
  colorId: number;
  colorNom: string;
  totalPlannedQty: number;
  status: LotStatus;
  responsableId: number;
  responsableNom: string | null;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  qrPayload?: string;
}

export interface LotDetailDTO extends LotDTO {
  sizes: LotSizeDTO[];
  tasks: TaskDTO[];
  waste: WasteDTO[];
  bundles: BundleDTO[];
  identifier: { code: string; qrPayload: string } | null;
  lastStatusReason: {
    action: string;
    reason: string;
    at: string;
    by: string | null;
  } | null;
}

export interface WasteDTO {
  id: number;
  lotId: number | null;
  lotCode: string | null;
  rollId: number | null;
  rollCode: string | null;
  wasteType: WasteType;
  qty: number;
  unit: string;
  reason: string | null;
  observations: string | null;
  userName: string | null;
  createdAt: string;
}

export interface BundleDTO {
  id: number;
  lotId: number;
  sizeId: number;
  sizeLabel: string;
  qty: number;
  status: string;
  code: string | null;
  qrPayload: string | null;
}

export interface CompletenessDTO {
  totalMandatory: number;
  done: number;
  validated: number;
  inProgress: number;
  pendingOrBlocked: number;
  remainingToValidate: number;
  percent: number;
  blockingTasks: Array<{ code: string; description: string; status: TaskStatus }>;
}

export interface TransferEligibilityDTO {
  eligible: boolean;
  transferred: boolean;
  lotStatus: LotStatus;
  completeness: CompletenessDTO;
  reasons: string[];
}

export interface TransferLineDTO {
  productId: number;
  productNom: string;
  colorNom: string;
  sizeId: number;
  sizeLabel: string;
  qty: number;
}

export interface TransferDTO {
  id: number;
  lotId: number;
  lotCode: string;
  code: string;
  performedBy: string | null;
  confirmedAt: string;
  notes: string | null;
  lines: TransferLineDTO[];
}

export interface LookupResultDTO {
  objectType: IdentifierType;
  objectId: number;
  code: string;
  label: string;
  statusLabel: string;
}

export interface HistoryEntryDTO {
  id: number;
  action: string;
  entityType: string;
  entityId: number;
  actorNom: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
}

export interface MovementDTO {
  id: number;
  rollId: number;
  movementType: string;
  lotCode: string | null;
  weightBefore: number | null;
  weightAfter: number | null;
  qty: number | null;
  unit: string | null;
  reason: string | null;
  userName: string | null;
  createdAt: string;
}

export interface RollDetailDTO extends RollDTO {
  movements: MovementDTO[];
  identifier: { code: string; qrPayload: string } | null;
}
