'use client';

import Chip from '@mui/material/Chip';
import { LOT_STATUS_LABELS, type LotStatus } from '@/types/coupe';

/**
 * Aides d'affichage partagées du workflow des lots : couleurs de statut,
 * ordre de priorité (les lots bloqués ou à confirmer d'abord) et format
 * des horodatages.
 */

export const WORKFLOW_STATUS_ORDER: LotStatus[] = [
  'bloque',
  'resultat_a_confirmer',
  'plan_a_valider',
  'a_verifier',
  'en_coupe',
  'brouillon',
  'pret_a_couper',
  'coupe',
  'transfert_pret',
  'pret_transfert',
  'transfere',
  'annule',
];

type ChipColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'error'
  | 'warning'
  | 'info'
  | 'success';

export function statusColor(status: LotStatus): ChipColor {
  switch (status) {
    case 'bloque':
      return 'error';
    case 'resultat_a_confirmer':
    case 'plan_a_valider':
    case 'a_verifier':
      return 'warning';
    case 'en_coupe':
    case 'brouillon':
      return 'info';
    case 'pret_a_couper':
      return 'primary';
    case 'coupe':
    case 'transfert_pret':
    case 'pret_transfert':
      return 'secondary';
    case 'transfere':
      return 'success';
    default:
      return 'default';
  }
}

export function StatusChip({ status }: { status: LotStatus }) {
  return (
    <Chip
      size="small"
      color={statusColor(status)}
      label={LOT_STATUS_LABELS[status] ?? status}
    />
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(
    value.includes('T') ? value : value.replace(' ', 'T') + 'Z',
  );
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  tissu_defectueux: 'Tissu défectueux',
  piece_manquante: 'Pièce manquante',
  quantite_incorrecte: 'Quantité incorrecte',
  probleme_patron: 'Problème de patron',
  probleme_materiel: 'Problème de matériel',
  autre: 'Autre',
};
