/** Types du module Chef Sécurité (étape 10). */

export type SecControlLevel = 'cartons' | 'references' | 'quantites';

export type SecControlStatus =
  | 'en_cours'
  | 'conforme'
  | 'non_conforme'
  | 'attente_correction'
  | 'invalide';

export type SecAnomalyType =
  | 'carton_manquant'
  | 'carton_supplementaire'
  | 'carton_inconnu'
  | 'qr_invalide'
  | 'carton_double'
  | 'carton_deja_sorti'
  | 'reference_incoherente'
  | 'quantite_ecart'
  | 'dossier_modifie'
  | 'dossier_incomplet'
  | 'sortie_non_autorisee'
  | 'incoherence_stock'
  | 'echec_contre_verification';

export type SecDecision =
  | 'conforme'
  | 'non_conforme'
  | 'attente_correction'
  | 'contrev_crequise'
  | 'autorisee'
  | 'refusee';

export interface SecDossierDTO {
  id: number;
  code: string;
  orderCode: string;
  externalOrderNo: string | null;
  version: number;
  status: 'soumis' | 'retour' | 'annule';
  notes: string | null;
  submittedByName: string | null;
  submittedAt: string;
  securityResult: SecDecision | null;
  cartons: Array<{ code: string; totalQty: number }>;
  lines: Array<{
    id: number;
    productNom: string | null;
    colorNom: string | null;
    sizeNom: string | null;
    rawText: string | null;
    qtyOrdered: number;
    qtyPrepared: number;
  }>;
  checks: Array<{ result: string; gaps: string | null; checkedAt: string }>;
  anomalies: SecAnomalyDTO[];
}

export interface SecControlDTO {
  id: number;
  code: string;
  dossierCode: string;
  orderCode: string;
  version: number;
  level: SecControlLevel;
  status: SecControlStatus;
  notes: string | null;
  startedByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  expectedCartons: Array<{ cartonId: number; code: string; totalQty: number }>;
  observations: SecObservationDTO[];
  lineChecks: Array<{ orderLineId: number; qtyChecked: number }>;
  anomalies: SecAnomalyDTO[];
}

export interface SecObservationDTO {
  id: number;
  cartonId: number;
  cartonCode: string;
  codeSaisi: string;
  result: 'attendu' | 'supplementaire';
  qtyTotal: number;
  observedAt: string;
}

export interface SecAnomalyDTO {
  id: number;
  code: string;
  dossierId: number | null;
  dossierCode: string | null;
  controleId: number | null;
  cartonCode: string | null;
  type: SecAnomalyType;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  status: 'ouverte' | 'resolue' | 'acceptee';
  detectedByName: string | null;
  detectedAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionReason: string | null;
}

export interface SecDecisionDTO {
  id: number;
  dossierId: number;
  dossierCode: string;
  decision: SecDecision;
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string;
}

export interface SecSortieDTO {
  id: number;
  code: string;
  dossierCode: string;
  orderCode: string;
  status: 'autorisee' | 'confirmee' | 'refusee' | 'annulee';
  authorizedByName: string | null;
  authorizedAt: string;
  authorizedReason: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  movementLogged: boolean;
  cartons: Array<{ code: string; totalQty: number }>;
}

export interface SecDashboardDTO {
  dossiersPending: number;
  controlsRunning: number;
  controlsConforme: number;
  dossiersBlocked: number;
  cartonsExpected: number;
  cartonsObserved: number;
  anomaliesOpen: number;
  counterChecksPending: number;
  sortiesAuthorized: number;
  sortiesConfirmed: number;
  sortiesRefused: number;
  recentHistory: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: number;
    actorNom: string | null;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface SecHistoryDTO {
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
