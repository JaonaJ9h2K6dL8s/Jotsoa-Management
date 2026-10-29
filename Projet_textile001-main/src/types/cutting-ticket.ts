/**
 * Types du ticket de transfert Coupe → Couture (étape 17).
 * Partagés entre le serveur (transfer-ticket.ts) et les interfaces
 * (liste et impression) : une seule définition, aucune duplication.
 */

export type TransferTicketReceptionStatus =
  | 'en_attente' | 'partielle' | 'complete';

export interface TransferTicketListDTO {
  transferId: number;
  /** NULL = transfert historique antérieur au ticket numéroté. */
  ticketNo: string | null;
  code: string;
  status: string;
  confirmedAt: string;
  lotCode: string;
  planId: number | null;
  productName: string | null;
  colorName: string | null;
  sizeLabel: string | null;
  qtySent: number;
  pieceRows: number;
  emitterName: string;
  emitterRole: string | null;
  receptionStatus: TransferTicketReceptionStatus;
  receivedByName: string | null;
  receivedAt: string | null;
}

export interface TransferTicketPieceRow {
  pieceId: number;
  code: string;
  label: string;
  /** Prévue = placements du plan validé × couches (null si absent). */
  qtyPlanned: number | null;
  qtyPerLayer: number;
  layers: number;
  qtySent: number;
}

export interface TransferTicketSizeRow {
  sizeId: number;
  sizeLabel: string;
  qtySent: number;
  /** null = pas encore réceptionné. */
  qtyReceived: number | null;
  observation: string;
}

export interface TransferTicketDTO {
  transferId: number;
  ticketNo: string | null;
  code: string;
  status: string;
  confirmedAt: string;
  appName: string;
  lotCode: string;
  planId: number | null;
  productName: string | null;
  colorName: string | null;
  emitter: { name: string; role: string | null; notes: string | null };
  pieces: TransferTicketPieceRow[];
  sizes: TransferTicketSizeRow[];
  reception: {
    status: TransferTicketReceptionStatus;
    receivedByName: string | null;
    receivedAt: string | null;
    notes: string | null;
  } | null;
}
