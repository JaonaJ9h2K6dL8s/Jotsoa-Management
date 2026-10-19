/**
 * Types du module Chef Magasinier (étape 9) : import PDF, commandes
 * externes, préparation avec réservations, dossiers de sortie.
 */

export type MgDocumentStatus =
  | 'importe'
  | 'extraction_ok'
  | 'extraction_partielle'
  | 'ocr_indisponible'
  | 'a_verifier'
  | 'valide'
  | 'rejete'
  | 'erreur';

export type MgOrderStatus =
  | 'a_verifier'
  | 'valide'
  | 'en_preparation'
  | 'partielle'
  | 'complete'
  | 'anomalie'
  | 'soumis'
  | 'retour'
  | 'annule';

export type MgMatchStatus = 'non_reconnu' | 'reconnu';

export interface MgDocumentDTO {
  id: number;
  code: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number | null;
  status: MgDocumentStatus;
  externalOrderNo: string | null;
  importedByName: string | null;
  importedAt: string;
  notes: string | null;
  extractedText: string | null;
  orderCode: string | null;
  orderId: number | null;
}

export interface MgExtractedLineDTO {
  rawText: string;
  productNom: string | null;
  colorNom: string | null;
  sizeNom: string | null;
  qty: number | null;
}

export interface MgExtractResultDTO {
  documentId: number;
  code: string;
  status: MgDocumentStatus;
  orderNo: string | null;
  orderDate: string | null;
  clientName: string | null;
  lines: MgExtractedLineDTO[];
  message: string;
}

export interface MgOrderLineDTO {
  id: number;
  productId: number | null;
  productNom: string | null;
  colorId: number | null;
  colorNom: string | null;
  sizeId: number | null;
  sizeNom: string | null;
  rawText: string | null;
  qtyOrdered: number;
  qtyPrepared: number;
  matchStatus: MgMatchStatus;
  notes: string | null;
  reservableQty: number;
  preparedQty: number;
  /** Présent uniquement dans la vue préparation (cartons réservables réels). */
  reservableCartons?: MgReservableCartonDTO[];
}

export interface MgOrderDTO {
  id: number;
  code: string;
  documentCode: string;
  externalOrderNo: string | null;
  clientName: string | null;
  orderDate: string | null;
  status: MgOrderStatus;
  createdAt: string;
  lines: MgOrderLineDTO[];
  duplicateWarning: string | null;
}

export interface MgReservableCartonDTO {
  cartonId: number;
  cartonCode: string;
  lotId: number;
  lotCode: string;
  sizeId: number;
  sizeLabel: string;
  reservableQty: number;
}

export interface MgReservationDTO {
  id: number;
  code: string;
  orderCode: string;
  cartonCode: string;
  lotCode: string;
  sizeLabel: string;
  qty: number;
  status: 'active' | 'liberee';
  reservedByName: string | null;
  createdAt: string;
  releasedByName: string | null;
  releaseReason: string | null;
}

export interface MgCheckDTO {
  id: number;
  orderCode: string;
  result: 'conforme' | 'partielle';
  gaps: string | null;
  notes: string | null;
  checkedByName: string | null;
  checkedAt: string;
}

export interface MgDossierDTO {
  id: number;
  code: string;
  orderCode: string;
  externalOrderNo: string | null;
  version: number;
  status: 'soumis' | 'retour' | 'annule';
  notes: string | null;
  submittedByName: string | null;
  submittedAt: string;
  cartons: Array<{ code: string; totalQty: number }>;
  lines: MgOrderLineDTO[];
  checks: MgCheckDTO[];
}

export interface MgDashboardDTO {
  documentsImported: number;
  documentsToVerify: number;
  documentsErrored: number;
  ordersValidated: number;
  ordersInPreparation: number;
  ordersPartial: number;
  ordersComplete: number;
  dossiersSubmitted: number;
  dossiersReturned: number;
  ordersBlocked: number;
  totalOrderedQty: number;
  totalPreparedQty: number;
  openAlerts: number;
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

export interface MgCatalogueDTO {
  products: Array<{ id: number; nom: string }>;
  colors: Array<{ id: number; nom: string }>;
  sizes: Array<{ id: number; nom: string }>;
}

export interface MgHistoryDTO {
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

export interface MgAlertDTO {
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
