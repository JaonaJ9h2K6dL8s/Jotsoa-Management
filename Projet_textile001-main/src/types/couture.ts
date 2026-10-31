/**
 * Types partagés du module Couture (client + serveur).
 */

export type CoutureLotStatus =
  | 'en_attente_reception'
  | 'reception_partielle'
  | 'reception_confirmee'
  | 'a_affecter'
  | 'affecte'
  | 'en_cours'
  | 'en_pause'
  | 'attente_reprise'
  | 'couture_terminee'
  | 'attente_transfert'
  | 'transfere_cq'
  | 'bloque'
  | 'annule';

export type AssignmentStatus =
  | 'affecte'
  | 'en_cours'
  | 'en_pause'
  | 'terminee'
  | 'bloquee'
  | 'annulee';

export type IncidentSeverity = 'mineure' | 'majeure' | 'critique';

export type IncidentStatus = 'ouverte' | 'en_cours' | 'resolue' | 'cloturee';

export const COUTURE_LOT_STATUS_LABELS: Record<CoutureLotStatus, string> = {
  en_attente_reception: 'En attente de réception',
  reception_partielle: 'Réception partielle',
  reception_confirmee: 'Réception confirmée',
  a_affecter: 'À affecter',
  affecte: 'Affecté',
  en_cours: 'En cours de couture',
  en_pause: 'En pause',
  attente_reprise: 'En attente de reprise',
  couture_terminee: 'Couture terminée',
  attente_transfert: 'En attente de transfert',
  transfere_cq: 'Transféré au contrôle qualité',
  bloque: 'Bloqué',
  annule: 'Annulé',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  affecte: 'Affecté',
  en_cours: 'En cours',
  en_pause: 'En pause',
  terminee: 'Terminée',
  bloquee: 'Bloquée',
  annulee: 'Annulée',
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  mineure: 'Mineure',
  majeure: 'Majeure',
  critique: 'Critique',
};

export const INCIDENT_TYPE_OPTIONS = [
  'machine_panne',
  'matiere_manquante',
  'quantite_incoherente',
  'probleme_taille_couleur',
  'production_interrompue',
  'anomalie_saisie',
  'ecart_quantite',
  'autre',
] as const;

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  machine_panne: 'Machine en panne',
  matiere_manquante: 'Matière manquante',
  quantite_incoherente: 'Quantité reçue incohérente',
  probleme_taille_couleur: 'Problème de taille ou de couleur',
  production_interrompue: 'Production interrompue',
  anomalie_saisie: 'Anomalie de saisie',
  ecart_quantite: 'Écart de quantité',
  autre: 'Autre',
};

export interface CoutureLineDTO {
  id: number;
  code: string;
  nom: string;
  roomId: number;
  roomNom: string;
  roomCode: string;
  isActive: boolean;
}

export interface CoutureRoomDTO {
  id: number;
  code: string;
  nom: string;
  isActive: boolean;
  lines: CoutureLineDTO[];
}

export interface PendingTransferDTO {
  transferId: number;
  transferCode: string;
  /** Numéro de ticket lisible (TRF-AAAA-NNNNNN), absent sur l'historique. */
  ticketNo: string | null;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  confirmedAt: string;
  lines: Array<{ sizeId: number; sizeLabel: string; qty: number }>;
  received: boolean;
}

export interface ReceptionDTO {
  id: number;
  transferId: number;
  transferCode: string;
  ticketNo: string | null;
  lotId: number;
  lotCode: string;
  status: 'complete' | 'partielle';
  notes: string | null;
  receivedByName: string | null;
  receivedAt: string;
  lines: Array<{
    productId: number;
    productNom: string;
    colorNom: string;
    sizeId: number;
    sizeLabel: string;
    transferredQty: number;
    receivedQty: number;
  }>;
}

export interface LotBalanceDTO {
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  status: CoutureLotStatus;
  transferredQty: number;
  receivedQty: number;
  contestedQty: number;
  assignedQty: number;
  sewnQty: number;
  transferredCqQty: number;
  remainingToSew: number;
  availableToAssign: number;
  availableToTransfer: number;
}

export interface AssignmentDTO {
  id: number;
  code: string;
  lotId: number;
  lotCode: string;
  productNom: string;
  colorNom: string;
  roomId: number;
  roomNom: string;
  lineId: number;
  lineNom: string;
  responsableId: number;
  responsableNom: string | null;
  status: AssignmentStatus;
  notes: string | null;
  createdAt: string;
  /** Démarrage du travail (première mise en cours), null si jamais démarrée. */
  startedAt: string | null;
  /** Fin du travail (action « terminer »), null si en cours ou non démarrée. */
  endedAt: string | null;
  /** Secondes travaillées cumulées, pauses exclues (ancre : updated_at). */
  workedSeconds: number;
  /** Ancre du segment en cours (dernière transition d'état). */
  updatedAt: string;
  sizes: Array<{ sizeId: number; sizeLabel: string; plannedQty: number; sewnQty: number }>;
}

export interface ProductionDTO {
  id: number;
  assignmentId: number;
  assignmentCode: string;
  lotId: number;
  lotCode: string;
  sizeId: number;
  sizeLabel: string;
  qty: number;
  operatorId: number | null;
  operatorName: string | null;
  recordedByName: string | null;
  status: 'normal' | 'corrigee' | 'annulee';
  notes: string | null;
  createdAt: string;
}

export interface IncidentDTO {
  id: number;
  lotId: number | null;
  lotCode: string | null;
  assignmentId: number | null;
  assignmentCode: string | null;
  roomNom: string | null;
  lineNom: string | null;
  incidentType: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  startedAt: string;
  endedAt: string | null;
  resolutionNote: string | null;
  declaredByName: string | null;
}

export interface CoutureTransferDTO {
  id: number;
  code: string;
  assignmentId: number;
  assignmentCode: string;
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

export interface CoutureHistoryDTO {
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

export interface CoutureDashboardDTO {
  lotsByStatus: Record<string, number>;
  assignmentsByStatus: Record<string, number>;
  quantities: {
    receivedQty: number;
    contestedQty: number;
    assignedQty: number;
    sewnQty: number;
    remainingToSew: number;
    transferredCqQty: number;
  };
  openIncidents: number;
  criticalIncidents: number;
  openAlerts: number;
  pendingRequests: number;
  productionByLine: Array<{ lineNom: string; qty: number }>;
  recentHistory: CoutureHistoryDTO[];
}
