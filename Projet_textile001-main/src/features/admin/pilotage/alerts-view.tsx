'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { AlertRow } from '@/types/pilotage';

/**
 * Vue centrale des alertes transversales. Toutes les alertes des
 * modules restent disponibles ici même après résolution ; le détail
 * ouvre un dialogue (l'accès aux pages métier reste régi par les
 * permissions de chaque rôle).
 */

const SEVERITY_COLOR: Record<string, 'info' | 'warning' | 'error'> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};

function formatDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

interface AlertsViewProps {
  alerts: AlertRow[] | null;
  loading: boolean;
  error: string | null;
  severity: string;
  onSeverityChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  onRefresh: () => void;
}

export default function AlertsView({
  alerts,
  loading,
  error,
  severity,
  onSeverityChange,
  status,
  onStatusChange,
  onRefresh,
}: AlertsViewProps) {
  const [selected, setSelected] = useState<AlertRow | null>(null);
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
        <Box sx={{ minWidth: 180 }}>
          <InputLabel id="alert-severity" size="small">
            Gravité
          </InputLabel>
          <Select
            labelId="alert-severity"
            value={severity}
            onChange={(event) => onSeverityChange(event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="">Toutes</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Avertissement</MenuItem>
            <MenuItem value="critical">Critique</MenuItem>
          </Select>
        </Box>
        <Box sx={{ minWidth: 180 }}>
          <InputLabel id="alert-status" size="small">
            Statut
          </InputLabel>
          <Select
            labelId="alert-status"
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="">Tous</MenuItem>
            <MenuItem value="nouvelle">Nouvelle</MenuItem>
            <MenuItem value="en_cours">En cours</MenuItem>
            <MenuItem value="resolue">Résolue</MenuItem>
            <MenuItem value="fermee">Fermée</MenuItem>
          </Select>
        </Box>
        <Button size="small" onClick={onRefresh}>
          Actualiser
        </Button>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <Typography color="text.secondary">Chargement…</Typography> : null}
      {!loading && alerts && alerts.length === 0 ? (
        <Typography color="text.secondary">
          Aucune alerte sur la période sélectionnée.
        </Typography>
      ) : null}
      {alerts && alerts.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Catégorie</TableCell>
              <TableCell>Gravité</TableCell>
              <TableCell>Statut</TableCell>
              <TableCell>Module</TableCell>
              <TableCell>Message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {alerts.map((alert) => (
              <TableRow key={alert.id} hover onClick={() => setSelected(alert)}>
                <TableCell>{formatDate(alert.createdAt)}</TableCell>
                <TableCell>{alert.category}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={SEVERITY_COLOR[alert.severity] ?? 'default'}
                    label={alert.severity}
                  />
                </TableCell>
                <TableCell>{alert.status}</TableCell>
                <TableCell>{alert.ownerRole ?? '—'}</TableCell>
                <TableCell>{alert.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <Dialog open={selected !== null} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Détail de l&apos;alerte</DialogTitle>
        <DialogContent dividers>
          {selected ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>Catégorie :</strong> {selected.category}
              </Typography>
              <Typography variant="body2">
                <strong>Message :</strong> {selected.message}
              </Typography>
              <Typography variant="body2">
                <strong>Objet :</strong> {selected.objectType ?? '—'}{' '}
                {selected.objectId !== null ? `#${selected.objectId}` : ''}
              </Typography>
              <Typography variant="body2">
                <strong>Module responsable :</strong> {selected.ownerRole ?? '—'}
              </Typography>
              <Typography variant="body2">
                <strong>Statut :</strong> {selected.status} — <strong>Gravité :</strong>{' '}
                {selected.severity}
              </Typography>
              <Typography variant="body2">
                <strong>Date :</strong> {formatDate(selected.createdAt)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Le traitement et la résolution de cette alerte sont gérés dans le module
                concerné, selon les permissions de chaque rôle.
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Fermer</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
