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
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SecAnomalyDTO, SecDossierDTO } from '@/types/securite';
import { sendSecurite, useSecuriteData } from './use-securite';

/**
 * Anomalies : consultation factuelle, résolution (une anomalie
 * critique exige une contre-vérification par une autre personne),
 * demande de correction au chef magasinier.
 */

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

function AnomalyCard({
  anomaly,
  onResolve,
}: {
  anomaly: SecAnomalyDTO;
  onResolve: (anomaly: SecAnomalyDTO) => void;
}) {
  return (
    <Alert severity={SEVERITY_COLOR[anomaly.severity] ?? 'info'}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Typography variant="body2">{anomaly.code}</Typography>
          <Chip size="small" label={anomaly.type} />
          <Chip size="small" variant="outlined" label={anomaly.status} />
        </Stack>
        <Typography variant="body2">
          {anomaly.description}
          {anomaly.dossierCode ? ` — dossier ${anomaly.dossierCode}` : ''}
          {anomaly.cartonCode ? ` — carton ${anomaly.cartonCode}` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Détectée par {anomaly.detectedByName ?? 'système'} le {anomaly.detectedAt}
          {anomaly.resolvedAt
            ? ` — résolue par ${anomaly.resolvedByName ?? '?'} le ${anomaly.resolvedAt} (${anomaly.resolution})`
            : ''}
        </Typography>
        {anomaly.status === 'ouverte' ? (
          <Button size="small" onClick={() => onResolve(anomaly)}>
            Traiter
          </Button>
        ) : null}
      </Stack>
    </Alert>
  );
}

export default function AnomaliesManager() {
  const { data: anomalies, loading, error, refresh } = useSecuriteData<SecAnomalyDTO[]>(
    '/api/securite/anomalies',
  );
  const { data: dossiers, refresh: refreshDossiers } = useSecuriteData<SecDossierDTO[]>(
    '/api/securite/dossiers',
  );
  const [resolveAnomaly, setResolveAnomaly] = useState<SecAnomalyDTO | null>(null);
  const [correctDossier, setCorrectDossier] = useState<SecDossierDTO | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const correctable = (dossiers ?? []).filter((dossier) =>
    dossier.anomalies.some((anomaly) => anomaly.status === 'ouverte'),
  );

  const run = async (url: string, body: Record<string, unknown>, done: (text: string) => void) => {
    setActionError(null);
    try {
      const result = await sendSecurite(url, body);
      const item = result.item as { status?: string } | undefined;
      done(
        item?.status
          ? `Résultat : ${item.status}`
          : 'Opération enregistrée.',
      );
      setReason('');
      void refresh();
      void refreshDossiers();
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
        <Typography variant="subtitle1">Demander une correction au chef magasinier</Typography>
        <Stack spacing={1} className="mt-2">
          {correctable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun dossier avec anomalie ouverte.
            </Typography>
          ) : (
            correctable.map((dossier) => (
              <Stack key={dossier.id} direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body2">
                  {dossier.code} — {dossier.anomalies.filter((a) => a.status === 'ouverte').length}{' '}
                  anomalie(s) ouverte(s)
                </Typography>
                <Button size="small" onClick={() => setCorrectDossier(dossier)}>
                  Demander une correction
                </Button>
              </Stack>
            ))
          )}
        </Stack>
      </Paper>

      <Typography variant="subtitle1">Anomalies ({anomalies?.length ?? 0})</Typography>
      {(anomalies?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune anomalie enregistrée.
        </Typography>
      ) : (
        anomalies?.map((anomaly) => (
          <AnomalyCard key={anomaly.id} anomaly={anomaly} onResolve={setResolveAnomaly} />
        ))
      )}

      {resolveAnomaly ? (
        <Dialog open onClose={() => setResolveAnomaly(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Traiter {resolveAnomaly.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Motif / observations factuelles"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {resolveAnomaly.severity === 'critical' ? (
                <Alert severity="warning">
                  Anomalie critique : une contre-vérification par une autre
                  personne habilitée sera exigée avant validation définitive.
                </Alert>
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResolveAnomaly(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  '/api/securite/anomalies',
                  { action: 'resolve', anomalyId: resolveAnomaly.id, reason },
                  setMessage,
                );
                setResolveAnomaly(null);
              }}
            >
              Enregistrer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {correctDossier ? (
        <Dialog open onClose={() => setCorrectDossier(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Correction demandée — {correctDossier.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Motif de la correction"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Alert severity="info">
                Le dossier repart en « retour » vers le chef magasinier ; les
                corrections se font dans son module, puis resoumission.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCorrectDossier(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  '/api/securite/anomalies',
                  { action: 'requestCorrection', dossierId: correctDossier.id, reason },
                  setMessage,
                );
                setCorrectDossier(null);
              }}
            >
              Demander
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
