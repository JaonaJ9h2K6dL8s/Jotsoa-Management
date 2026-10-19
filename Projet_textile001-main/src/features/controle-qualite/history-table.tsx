'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CqHistoryDTO } from '@/types/cq';
import { useCqData } from './use-cq';

/**
 * Historique complet du module Contrôle qualité : lecture seule,
 * filtrable par type d'entité et identifiant. Les traces ne sont ni
 * modifiables ni supprimables depuis l'application.
 */

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function HistoryTable() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const query = new URLSearchParams();
  if (entityType) query.set('entityType', entityType);
  if (entityId) query.set('entityId', entityId);
  const { data, loading, error } = useCqData<CqHistoryDTO[]>(
    `/api/controle-qualite/history${query.toString() ? `?${query.toString()}` : ''}`,
  );

  return (
    <Stack spacing={2}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack direction="row" spacing={2}>
        <TextField
          select
          label="Type d'entité"
          size="small"
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Tous</MenuItem>
          {[
            'cq_reception',
            'cq_controle',
            'cq_defaut',
            'cq_rework_request',
            'cq_final_control',
            'cq_stock_transfer',
            'demande_sensitive',
            'alerte',
          ].map((value) => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Identifiant"
          size="small"
          type="number"
          value={entityId}
          onChange={(event) => setEntityId(event.target.value)}
          sx={{ maxWidth: 140 }}
        />
      </Stack>

      <Paper variant="outlined" className="p-3">
        {(data?.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucun événement pour ces filtres.
          </Typography>
        ) : (
          <List dense>
            {data?.map((entry) => (
              <ListItem key={entry.id} disableGutters>
                <ListItemText
                  primary={`${entry.action} — ${entry.entityType} #${entry.entityId}${
                    entry.actorNom ? ` — par ${entry.actorNom}` : ''
                  }`}
                  secondary={
                    <>
                      {formatTimestamp(entry.createdAt)}
                      {entry.oldValue ? ` — avant : ${entry.oldValue}` : ''}
                      {entry.newValue ? ` — après : ${entry.newValue}` : ''}
                      {entry.reason ? ` — motif : ${entry.reason}` : ''}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
