'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { apiPatch, apiPost } from '@/services/api-client';
import {
  ROLL_STATUS_LABELS,
  type RollDetailDTO,
  type RollStatus,
} from '@/types/coupe';
import { useCoupeData } from './use-coupe';

const MOVEMENT_LABELS: Record<string, string> = {
  creation: 'Réception',
  affectation: 'Affectation à une tâche',
  consommation: 'Consommation',
  correction_poids: 'Correction du poids initial',
  blocage: 'Blocage',
  deblocage: 'Déblocage',
  statut: 'Changement de statut',
};

/** Fiche rouleau : QR code, historique des mouvements, corrections contrôlées. */
export default function RollDetailDialog({
  rollId,
  onClose,
}: {
  rollId: number | null;
  onClose: () => void;
}) {
  const { data, loading, error, refresh } = useCoupeData<RollDetailDTO>(
    rollId ? `/api/coupe/rolls/${rollId}` : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [weightReason, setWeightReason] = useState('');
  const [statusValue, setStatusValue] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function runAction(payload: Record<string, unknown>, success: string) {
    if (!rollId) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/api/coupe/rolls/${rollId}`, payload);
      setInfo(success);
      setCorrectionMode(false);
      setNewWeight('');
      setWeightReason('');
      setStatusValue('');
      setStatusReason('');
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReprint() {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost('/api/coupe/codes', {
        objectType: 'rouleau',
        objectId: data.id,
      });
      setInfo('Étiquette réimprimée (identifiant inchangé).');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={rollId !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Rouleau {data?.code ?? '…'}
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box className="py-6 text-center">
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : data ? (
          <Stack spacing={2} className="pt-1">
            {info ? (
              <Alert severity="success" onClose={() => setInfo(null)}>
                {info}
              </Alert>
            ) : null}
            {actionError ? <Alert severity="error">{actionError}</Alert> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Stack spacing={1} className="flex-1">
                <Typography variant="body2">
                  <strong>Tissu :</strong> {data.fabricRef}
                </Typography>
                <Typography variant="body2">
                  <strong>Couleur :</strong> {data.colorNom ?? '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Poids initial :</strong> {data.initialWeightKg} kg
                </Typography>
                <Typography variant="body2">
                  <strong>Poids restant :</strong>{' '}
                  {data.remainingWeightKg === null ? '—' : `${data.remainingWeightKg} kg`}
                </Typography>
                <Typography variant="body2">
                  <strong>Statut :</strong>{' '}
                  {ROLL_STATUS_LABELS[data.status as RollStatus] ?? data.status}
                </Typography>
                <Typography variant="body2">
                  <strong>Réception :</strong> {data.receivedAt}
                </Typography>
                {data.supplier ? (
                  <Typography variant="body2">
                    <strong>Fournisseur :</strong> {data.supplier}
                  </Typography>
                ) : null}
              </Stack>
              <Stack spacing={1} alignItems="center">
                {data.identifier ? (
                  <>
                    {/* QR généré côté serveur ; le scan ne contourne jamais les permissions. */}
                    <Box
                      component="img"
                      src={`/api/coupe/qr?payload=${encodeURIComponent(data.identifier.qrPayload)}`}
                      alt={`QR code du rouleau ${data.code}`}
                      className="h-40 w-40"
                    />
                    <Typography variant="caption">Code : {data.identifier.code}</Typography>
                    <Button size="small" onClick={handleReprint} disabled={busy}>
                      Réimprimer l&apos;étiquette
                    </Button>
                  </>
                ) : null}
              </Stack>
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Actions contrôlées</Typography>
            {correctionMode ? (
              <Stack spacing={1}>
                <TextField
                  label="Nouveau poids initial (kg)"
                  type="number"
                  inputProps={{ step: '0.01', min: 9, max: 30 }}
                  size="small"
                  value={newWeight}
                  onChange={(event) => setNewWeight(event.target.value)}
                  helperText="La correction 9–30 kg est vérifiée côté serveur et historisée."
                />
                <TextField
                  label="Motif de la correction"
                  required
                  size="small"
                  value={weightReason}
                  onChange={(event) => setWeightReason(event.target.value)}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={busy || !newWeight || !weightReason}
                    onClick={() =>
                      runAction(
                        { action: 'correct_weight', newWeightKg: newWeight, reason: weightReason },
                        'Poids initial corrigé et historisé.',
                      )
                    }
                  >
                    Confirmer la correction
                  </Button>
                  <Button size="small" onClick={() => setCorrectionMode(false)}>
                    Annuler
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Button size="small" onClick={() => setCorrectionMode(true)}>
                Corriger le poids initial
              </Button>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                select
                size="small"
                label="Nouveau statut"
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value)}
                className="min-w-40"
              >
                {Object.entries(ROLL_STATUS_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Motif (obligatoire pour bloquer / défectueux)"
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                className="flex-1"
              />
              <Button
                variant="outlined"
                size="small"
                disabled={busy || !statusValue}
                onClick={() =>
                  runAction(
                    { action: 'set_status', status: statusValue, reason: statusReason },
                    'Statut mis à jour.',
                  )
                }
              >
                Appliquer
              </Button>
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Historique des mouvements</Typography>
            {data.movements.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Aucun mouvement enregistré.
              </Typography>
            ) : (
              <List dense>
                {data.movements.map((movement) => (
                  <ListItem key={movement.id} disableGutters>
                    <ListItemText
                      primary={`${MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}${
                        movement.lotCode ? ` — lot ${movement.lotCode}` : ''
                      }`}
                      secondary={`${movement.createdAt}${
                        movement.weightBefore !== null
                          ? ` — ${movement.weightBefore} → ${movement.weightAfter} kg`
                          : ''
                      }${movement.reason ? ` — ${movement.reason}` : ''}${
                        movement.userName ? ` — par ${movement.userName}` : ''
                      }`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
}
