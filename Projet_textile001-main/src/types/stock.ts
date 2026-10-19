/**
 * Types du module Cartons et Stock (étape 8).
 * Les entrées proviennent des transferts conformes du Contrôle qualité
 * (cq_stock_transfers, étape 6). Les soldes sont recalculés depuis les
 * mouvements réels (st_movements), jamais saisis directement.
 */

export type StCartonStatus =
  | 'remplissage'
  | 'cloture'
  | 'bloque'
  | 'partiellement_sorti'
  | 'vide'
  | 'annule';

export interface StCartonLineDTO {
  lotId: number;
  lotCode: string;
  controleId: number;
  controleCode: string;
  sizeId: number;
  sizeLabel: string;
  qty: number;
}

export interface StCartonDTO {
  id: number;
  code: string;
  status: StCartonStatus;
  locationId: number | null;
  locationCode: string | null;
  locationLabel: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  identifier: { code: string; qrPayload: string } | null;
  totalQty: number;
  lines: StCartonLineDTO[];
}

export interface StLocationDTO {
  id: number;
  code: string;
  label: string;
  area: 'zone' | 'salle' | 'rangee' | 'etagere' | 'niveau' | 'emplacement';
  isActive: boolean;
  notes: string | null;
  cartonsCount: number;
}

export interface StPendingCqTransferDTO {
  transferId: number;
  transferCode: string;
  controleId: number;
  controleCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  confirmedAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

export interface StEntryDTO {
  id: number;
  code: string;
  transferCode: string;
  controleCode: string;
  lotCode: string;
  receivedByName: string | null;
  notes: string | null;
  createdAt: string;
  lines: Array<{
    lotCode: string;
    controleCode: string;
    sizeLabel: string;
    cartonCode: string;
    qty: number;
  }>;
}

export type StMovementType =
  | 'entree_cq'
  | 'transfert'
  | 'sortie'
  | 'retour'
  | 'ajustement'
  | 'annulation';

export interface StMovementDTO {
  id: number;
  movementType: StMovementType;
  lotCode: string;
  sizeLabel: string;
  qty: number;
  cartonCode: string | null;
  reason: string | null;
  userName: string | null;
  createdAt: string;
}

export interface StBalanceDTO {
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  sizeId: number;
  sizeLabel: string;
  inStock: number;
}

export interface StTransferDTO {
  id: number;
  code: string;
  cartonCode: string;
  fromCode: string | null;
  toCode: string;
  reason: string | null;
  performedByName: string | null;
  confirmedAt: string;
}

export interface StInventoryLineDTO {
  id: number;
  cartonId: number;
  cartonCode: string;
  lotCode: string;
  sizeId: number;
  sizeLabel: string;
  theoreticalQty: number;
  countedQty: number | null;
  observation: string | null;
}

export interface StInventoryDTO {
  id: number;
  code: string;
  locationCode: string | null;
  status: 'comptage' | 'ecarts' | 'attente_validation' | 'valide' | 'cloture' | 'annule';
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  countedAt: string | null;
  lines: StInventoryLineDTO[];
  gapsCount: number;
}

export interface StAdjustmentDTO {
  id: number;
  code: string;
  inventoryCode: string;
  cartonCode: string;
  lotCode: string;
  sizeLabel: string;
  deltaQty: number;
  reason: string;
  status: 'en_attente' | 'approuve' | 'refuse';
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface StHistoryDTO {
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

export interface StAlertDTO {
  id: number;
  category: string;
  severity: string;
  objectType: string | null;
  objectId: number | null;
  message: string;
  ownerRole: string | null;
  status: string;
  createdAt: string;
}

export interface StWasteStockDTO {
  wasteType: string;
  totalKg: number;
  outKg: number;
  availableKg: number;
}

export interface StWasteMovementDTO {
  id: number;
  wasteType: string;
  movementType: 'sortie' | 'ajustement';
  lotCode: string | null;
  qty: number;
  unit: string;
  reason: string;
  userName: string | null;
  createdAt: string;
}

export interface StDashboardDTO {
  cartonsInStock: number;
  cartonsFilling: number;
  cartonsBlocked: number;
  cartonsCount: number;
  pendingCqTransfers: number;
  inventoriesInProgress: number;
  pendingAdjustments: number;
  openAlerts: number;
  totalPiecesInStock: number;
  locationsCount: number;
  balances: StBalanceDTO[];
  waste: StWasteStockDTO[];
  recentHistory: StHistoryDTO[];
}

export const ST_CARTON_STATUS_LABELS: Record<StCartonStatus, string> = {
  remplissage: 'En remplissage',
  cloture: 'Clôturé',
  bloque: 'Bloqué pour anomalie',
  partiellement_sorti: 'Partiellement sorti',
  vide: 'Vide',
  annule: 'Annulé',
};

export const ST_MOVEMENT_LABELS: Record<StMovementType, string> = {
  entree_cq: 'Entrée depuis le contrôle qualité',
  transfert: 'Transfert entre emplacements',
  sortie: 'Sortie autorisée',
  retour: 'Retour autorisé',
  ajustement: "Ajustement d'inventaire",
  annulation: 'Annulation compensatoire',
};

export const ST_INVENTORY_STATUS_LABELS: Record<
  StInventoryDTO['status'],
  string
> = {
  comptage: 'Comptage en cours',
  ecarts: 'Écarts détectés',
  attente_validation: 'Ajustements en attente de validation',
  valide: 'Validé',
  cloture: 'Clôturé',
  annule: 'Annulé',
};
