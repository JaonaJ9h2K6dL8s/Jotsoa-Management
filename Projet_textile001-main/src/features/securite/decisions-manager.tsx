'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SecDecision, SecDecisionDTO, SecDossierDTO, SecSortieDTO } from '@/types/securite';
import { sendSecurite, useSecuriteData } from './use-securite';

/**
 * Décisions de sortie et confirmation physique. L'autorisation ne
 * signifie pas que les cartons ont quitté l'usine ; la confirmation
 * enregistre le mouvement définitif de stock (une seule fois).
 */

const DECISIONS: Array<{ value: SecDecision; label: string }> = [
  { value: 'conforme', label: 'Contrôle conforme' },
  { value: 'non_conforme', label: 'Contrôle non conforme' },
  { value: 'attente_correction', label: 'En attente de correction' },
  { value: 'contrev_crequise', label: 'Contre-vérification requise' },
  { value: 'autorisee', label: 'Sortie autorisée' },
  { value: 'refusee', label: 'Sortie refusée' },
];

const SORTIE_COLOR: Record<string, 'success' | 'info' | 'warning' | 'default'> = {
  autorisee: 'info',
  confirmee: 'success',
  refusee: 'warning',
  annulee: 'default',
};

export default function DecisionsManager() {
  const { data: dossiers, loading, error, refresh } = useSecuriteData<SecDossierDTO[]>(
    '/api/securite/dossiers',
  );
  const { data: decisions, refresh: refreshDecisions } = useSecuriteData<SecDecisionDTO[]>(
    '/api/securite/decisions',
  );
  const { data: sorties, refresh: refreshSorties } = useSecuriteData<SecSortieDTO[]>(
    '/api/securite/decisions',
    'sorties',
  );
  const [decideDossier, setDecideDossier] = useState<SecDossierDTO | null>(null);
  const [confirmSortie, setConfirmSortie] = useState<SecSortieDTO | null>(null);
  const [decision, setDecision] = useState<SecDecision | ''>('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const decidable = (dossiers ?? []).filter((dossier) => dossier.status === 'soumis');
  const confirmable = (sorties ?? []).filter((sortie) => sortie.status === 'autorisee');

  const run = async (url: string, body: Record<string, unknown>, done: (text: string) => void) => {
    setActionError(null);
    try {
      await sendSecurite(url, body);
      done('Opération enregistrée.');
      setReason('');
      setDecision('');
      void refresh();
      void refreshDecisions();
      void refreshSorties();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Typography variant="subtitle1">Décision de sortie</Typography>
        <Stack spacing={1} className="mt-2">
          {decidable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun dossier soumis à décider.
            </Typography>
          ) : (
            decidable.map((dossier) => (
              <Stack key={dossier.id} direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body2">
                  {dossier.code} — commande {dossier.orderCode} — contrôle :{' '}
                  {dossier.securityResult ?? 'non décidé'} —{' '}
                  {dossier.anomalies.filter((a) => a.status === 'ouverte').length} anomalie(s)
                  ouverte(s)
                </Typography>
                <Button size="small" variant="contained" onClick={() => setDecideDossier(dossier)}>
                  Décider
                </Button>
              </Stack>
            ))
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" className="p-3">
        <Typography variant="subtitle1">Confirmation de sortie physique</Typography>
        <Stack spacing={1} className="mt-2">
          {confirmable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune sortie autorisée en attente de confirmation.
            </Typography>
          ) : (
            confirmable.map((sortie) => (
              <Stack key={sortie.id} direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body2">
                  {sortie.code} — dossier {sortie.dossierCode} —{' '}
                  {sortie.cartons.map((carton) => carton.code).join(', ')}
                </Typography>
                <Button size="small" variant="contained" onClick={() => setConfirmSortie(sortie)}>
                  Confirmer la sortie physique
                </Button>
              </Stack>
            ))
          )}
          <Alert severity="info">
            La confirmation enregistre définitivement le mouvement de stock
            (une seule fois, via le module Stock) et distingue la sortie
            autorisée de la sortie réellement confirmée.
          </Alert>
        </Stack>
      </Paper>

      <Typography variant="subtitle1">Sorties ({sorties?.length ?? 0})</Typography>
      {(sorties?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune sortie enregistrée.
        </Typography>
      ) : (
        sorties?.map((sortie) => (
          <Paper key={sortie.id} variant="outlined" className="p-3">
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">{sortie.code}</Typography>
                <Chip size="small" color={SORTIE_COLOR[sortie.status] ?? 'default'} label={sortie.status} />
                {sortie.movementLogged ? (
                  <Chip size="small" variant="outlined" label="mouvement de stock enregistré" />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Dossier {sortie.dossierCode} — commande {sortie.orderCode} — autorisée
                par {sortie.authorizedByName ?? '?'} le {sortie.authorizedAt}
                {sortie.confirmedAt
                  ? ` — confirmée par ${sortie.confirmedByName ?? '?'} le ${sortie.confirmedAt}`
                  : ''}
              </Typography>
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Dernières décisions ({decisions?.length ?? 0})</Typography>
      {(decisions?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune décision enregistrée.
        </Typography>
      ) : (
        decisions?.slice(0, 10).map((entry) => (
          <Alert key={entry.id} severity="info">
            <Typography variant="body2">
              {entry.decidedAt} — {entry.dossierCode} — <strong>{entry.decision}</strong>
              {entry.reason ? ` — ${entry.reason}` : ''} — par{' '}
              {entry.decidedByName ?? '?'}
            </Typography>
          </Alert>
        ))
      )}

      {decideDossier ? (
        <Dialog open onClose={() => setDecideDossier(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Décision — {decideDossier.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                select
                label="Décision"
                value={decision}
                onChange={(event) => setDecision(event.target.value as SecDecision | '')}
                size="small"
              >
                {DECISIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Motif"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Alert severity="info">
                L’autorisation exige un contrôle conforme, aucune anomalie
                critique ouverte et aucune contre-vérification en attente.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDecideDossier(null)}>Retour</Button>
            <Button
              variant="contained"
              disabled={!decision}
              onClick={async () => {
                await run(
                  '/api/securite/decisions',
                  { dossierId: decideDossier.id, decision, reason },
                  setMessage,
                );
                setDecideDossier(null);
              }}
            >
              Enregistrer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {confirmSortie ? (
        <Dialog open onClose={() => setConfirmSortie(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Confirmer la sortie physique — {confirmSortie.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Observations (facultatives)"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Alert severity="warning">
                Cette opération est définitive : le stock sera décrémenté une
                seule fois, selon les réservations réelles de la commande.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmSortie(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  '/api/securite/sorties',
                  { sortieId: confirmSortie.id, notes: reason },
                  setMessage,
                );
                setConfirmSortie(null);
              }}
            >
              Confirmer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
