'use client';

import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import type { HistoryEntryDTO } from '@/types/coupe';
import { useCoupeData } from './use-coupe';

const ENTITY_TYPES = [
  { value: '', label: 'Toutes les entités' },
  { value: 'rouleau', label: 'Rouleaux' },
  { value: 'lot', label: 'Lots' },
  { value: 'tache', label: 'Tâches' },
  { value: 'dechet', label: 'Déchets' },
  { value: 'paquet', label: 'Paquets' },
];

const ACTION_LABELS: Record<string, string> = {
  ROLL_CREATED: 'Rouleau créé',
  ROLL_UPDATED: 'Rouleau modifié',
  ROLL_WEIGHT_CORRECTED: 'Poids initial corrigé',
  ROLL_STATUS_CHANGED: 'Statut du rouleau modifié',
  ROLL_ASSIGNED: 'Rouleau affecté',
  ROLL_CONSUMED: 'Consommation de tissu',
  LOT_CREATED: 'Lot créé',
  LOT_START: 'Coupe démarrée',
  LOT_SET_ATTENTE: 'Lot en attente de validation',
  LOT_RESUME: 'Lot repris',
  LOT_BLOCK: 'Lot bloqué',
  LOT_UNBLOCK: 'Lot débloqué',
  LOT_CANCEL: 'Lot annulé',
  LOT_READY_FOR_TRANSFER: 'Lot prêt pour transfert',
  TASK_CREATED: 'Tâche créée',
  TASK_START: 'Tâche démarrée',
  TASK_FINISH: 'Tâche terminée',
  TASK_SET_ATTENTE: 'Tâche mise en attente',
  TASK_BLOCK: 'Tâche bloquée',
  TASK_UNBLOCK: 'Tâche débloquée',
  TASK_CANCEL: 'Tâche annulée',
  TASK_RESULTS_SAVED: 'Résultats saisis',
  TASK_RESULTS_CORRECTED: 'Résultats corrigés',
  TASK_CORRECTION: 'Correction après validation',
  TASK_VALIDATED: 'Tâche validée',
  TASK_VALIDATION_REFUSED: 'Validation refusée',
  WASTE_DECLARED: 'Déchet déclaré',
  BUNDLE_CREATED: 'Paquet créé',
  TRANSFER_CONFIRMED: 'Transfert confirmé',
  REPRINT_LABEL: 'Étiquette réimprimée',
  LOOKUP: 'Recherche par code',
};

/** Historique complet du module Coupe : traçabilité non modifiable. */
export default function HistoryTable() {
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const query = `/api/coupe/history?limit=300&entityType=${entityType}`;
  const { data, loading, error } = useCoupeData<HistoryEntryDTO[]>(query);
  const entries = data ?? [];

  return (
    <Stack spacing={2}>
      <TextField
        select
        size="small"
        label="Filtrer par entité"
        value={entityType}
        onChange={(event) => {
          setEntityType(event.target.value);
          setPage(0);
        }}
        className="w-64"
      >
        {ENTITY_TYPES.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TableContainer component="div" className="overflow-x-auto rounded border">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Entité</TableCell>
              <TableCell>Utilisateur</TableCell>
              <TableCell>Motif / détails</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center">
                  Aucune opération enregistrée.
                </TableCell>
              </TableRow>
            ) : (
              entries
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((entry) => (
                  <TableRow key={entry.id} hover>
                    <TableCell>{entry.createdAt}</TableCell>
                    <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                    <TableCell>
                      {entry.entityType} #{entry.entityId}
                    </TableCell>
                    <TableCell>{entry.actorNom ?? '—'}</TableCell>
                    <TableCell>{entry.reason ?? '—'}</TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={entries.length}
          page={page}
          onPageChange={(_, value) => setPage(value)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number(event.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[15, 30, 50]}
          labelRowsPerPage="Lignes par page"
        />
      </TableContainer>
    </Stack>
  );
}
