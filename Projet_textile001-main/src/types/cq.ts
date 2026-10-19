/**
 * Types du module Contrôle qualité (étape 6).
 */

export type ReceptionStatus = 'complete' | 'partielle';

export interface CqReceptionLineDTO {
  sizeId: number;
  sizeLabel: string;
  transferredQty: number;
  receivedQty: number;
}

export interface CqReceptionDTO {
  id: number;
  code: string;
  transferId: number;
  transferCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  status: ReceptionStatus;
  notes: string | null;
  receivedByName: string | null;
  receivedAt: string;
  lines: CqReceptionLineDTO[];
}

export interface PendingCqTransferDTO {
  transferId: number;
  transferCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  roomNom: string;
  lineNom: string;
  confirmedAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

export type ControlStatus =
  | 'en_attente'
  | 'en_cours'
  | 'incomplet'
  | 'attente_validation'
  | 'valide'
  | 'bloque'
  | 'cloture';

export interface ControlLineDTO {
  sizeId: number;
  sizeLabel: string;
  receivedQty: number;
  inspectedQty: number;
  conformeQty: number;
}

export interface CqControlDTO {
  id: number;
  code: string;
  receptionId: number;
  receptionCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  status: ControlStatus;
  controlledByName: string | null;
  notes: string | null;
  createdAt: string;
  lines: ControlLineDTO[];
  defauts: CqDefautDTO[];
}

export type DefautDecision = 'attente' | 'retouche' | 'rebut';

export interface CqDefautDTO {
  id: number;
  controleId: number;
  lotId: number;
  lotCode: string;
  sizeId: number;
  sizeLabel: string;
  defectId: number;
  defectNom: string;
  defectCategory: string | null;
  reworkZoneNom: string | null;
  qtyPieces: number;
  description: string | null;
  severity: 'mineure' | 'majeure' | 'critique';
  decision: DefautDecision;
  declaredByName: string | null;
  createdAt: string;
}

export interface ReworkRequestDTO {
  id: number;
  code: string;
  controleId: number;
  controleCode: string;
  lotId: number;
  lotCode: string;
  origin: 'initial' | 'final';
  status: 'en_attente' | 'acceptee' | 'refusee' | 'annulee';
  reason: string;
  requestedByName: string | null;
  createdAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

export interface FinalControlDTO {
  id: number;
  code: string;
  requestId: number;
  requestCode: string;
  lotId: number;
  lotCode: string;
  status: 'en_cours' | 'valide' | 'cloture';
  controlledByName: string | null;
  notes: string | null;
  createdAt: string;
  lines: Array<{
    sizeId: number;
    sizeLabel: string;
    sentQty: number;
    returnedQty: number;
    conformeQty: number;
    reworkQty: number;
    rebutQty: number;
  }>;
}

export interface StockTransferDTO {
  id: number;
  code: string;
  controleId: number;
  controleCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  status: 'confirme' | 'annule';
  preparedByName: string | null;
  confirmedAt: string;
  notes: string | null;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

/** Soldes agrégés d'un lot, par taille (base de tous les contrôles). */
export interface CqSizeBalanceDTO {
  sizeId: number;
  sizeLabel: string;
  received: number;
  inspected: number;
  conforme: number;
  rework: number;
  rebut: number;
  transferredStock: number;
  availableStock: number;
}

export interface CqLotBalanceDTO {
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  receptionCode: string | null;
  controleCode: string | null;
  controleStatus: ControlStatus | null;
  totalReceived: number;
  totalInspected: number;
  totalConforme: number;
  totalRework: number;
  totalRebut: number;
  totalPending: number;
  totalAvailableStock: number;
  sizes: CqSizeBalanceDTO[];
}

export interface SensitiveRequestDTO {
  id: number;
  action: string;
  entityType: string;
  entityId: number;
  payload: string;
  reason: string;
  status: string;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface AlertDTO {
  id: number;
  category: string;
  severity: string;
  objectType: string | null;
  objectId: number | null;
  message: string;
  ownerRole: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
}

export interface CqHistoryDTO {
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

export interface CqDashboardDTO {
  controlsByStatus: Record<string, number>;
  receptionsCount: number;
  quantities: {
    receivedQty: number;
    inspectedQty: number;
    conformeQty: number;
    defautQty: number;
    reworkQty: number;
    rebutQty: number;
    pendingQty: number;
    availableStockQty: number;
    transferredStockQty: number;
  };
  pendingReworkRequests: number;
  openAlerts: number;
  pendingRequests: number;
  conformanceRate: number | null;
  recentHistory: CqHistoryDTO[];
}

export const CONTROL_STATUS_LABELS: Record<ControlStatus, string> = {
  en_attente: 'En attente de contrôle',
  en_cours: 'En cours de contrôle',
  incomplet: 'Contrôle incomplet',
  attente_validation: 'En attente de validation',
  valide: 'Validé',
  bloque: 'Bloqué pour anomalie',
  cloture: 'Clôturé',
};

export const REWORK_STATUS_LABELS: Record<ReworkRequestDTO['status'], string> = {
  en_attente: 'En attente',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  annulee: 'Annulée',
};

export const SEVERITY_LABELS: Record<CqDefautDTO['severity'], string> = {
  mineure: 'Mineure',
  majeure: 'Majeure',
  critique: 'Critique',
};

export const DECISION_LABELS: Record<DefautDecision, string> = {
  attente: 'En attente',
  retouche: 'À retoucher',
  rebut: 'Rebut',
};
