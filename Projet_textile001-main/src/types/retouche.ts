/**
 * Types du module Retouche (étape 7).
 * Les demandes proviennent de cq_rework_requests (étape 6) ; le module
 * trace son propre cycle dans les tables rt_*.
 */

export type RtRequestStatus = 'en_attente' | 'acceptee' | 'refusee' | 'annulee';

export interface RtRequestLineDTO {
  sizeId: number;
  sizeLabel: string;
  requestedQty: number;
  receivedQty: number;
}

export interface RtRequestDTO {
  id: number;
  code: string;
  controleId: number;
  controleCode: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  origin: 'initial' | 'final';
  originFinalId: number | null;
  status: RtRequestStatus;
  reason: string;
  requestedByName: string | null;
  createdAt: string;
  receptionId: number | null;
  lines: RtRequestLineDTO[];
  assignedQty: number;
  processedQty: number;
  returnedQty: number;
}

export interface RtReceptionDTO {
  id: number;
  requestCode: string;
  receivedByName: string | null;
  notes: string | null;
  createdAt: string;
  lines: RtRequestLineDTO[];
}

export interface RtAssignmentDTO {
  id: number;
  code: string;
  requestId: number;
  requestCode: string;
  lotCode: string;
  retoucheurId: number;
  retoucheurNom: string;
  assignedByName: string | null;
  status: 'affectee' | 'en_cours' | 'terminee' | 'annulee';
  notes: string | null;
  createdAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

export interface RtInterventionDTO {
  id: number;
  code: string;
  assignmentId: number;
  assignmentCode: string;
  requestCode: string;
  retoucheurNom: string;
  status: 'en_cours' | 'terminee' | 'annulee';
  action: string | null;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
  lines: Array<{
    sizeId: number;
    sizeLabel: string;
    processedQty: number;
    result: 'repare' | 'irreparable' | 'partiel';
  }>;
}

export interface RtReturnDTO {
  id: number;
  code: string;
  requestId: number;
  requestCode: string;
  lotCode: string;
  returnedByName: string | null;
  status: 'transmis' | 'annule';
  notes: string | null;
  createdAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
}

export interface RtRebutProposalDTO {
  id: number;
  code: string;
  requestId: number;
  requestCode: string;
  sizeId: number;
  sizeLabel: string;
  qty: number;
  motif: string;
  retoucheurNom: string;
  status: 'en_attente' | 'approuvee' | 'refusee';
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface RtHistoryDTO {
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

export interface RtDashboardDTO {
  requestsCount: number;
  pendingReception: number;
  pendingAssignment: number;
  assignmentsInProgress: number;
  interventionsInProgress: number;
  quantities: {
    requestedQty: number;
    receivedQty: number;
    assignedQty: number;
    processedQty: number;
    repairedQty: number;
    returnedQty: number;
    irreparableQty: number;
  };
  pendingRebutProposals: number;
  openAlerts: number;
  recentHistory: RtHistoryDTO[];
}

export const RT_STATUS_LABELS: Record<RtRequestStatus, string> = {
  en_attente: 'En attente de réception',
  acceptee: 'Transmise au contrôle final',
  refusee: 'Refusée',
  annulee: 'Annulée',
};

export const RT_RESULT_LABELS: Record<
  'repare' | 'irreparable' | 'partiel',
  string
> = {
  repare: 'Réparée',
  irreparable: 'Non réparable',
  partiel: 'Partiellement réparée',
};
