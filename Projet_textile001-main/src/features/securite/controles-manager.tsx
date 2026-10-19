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
import type { SecControlDTO, SecControlLevel, SecDossierDTO } from '@/types/securite';
import { sendSecurite, useSecuriteData } from './use-securite';

/**
 * File des contrôles : démarrage sur dossier soumis, comptage par scan
 * QR ou saisie manuelle, vérifications détaillées, clôture calculée
 * côté serveur.
 */

const LEVELS: Array<{ value: SecControlLevel; label: string }> = [
  { value: 'cartons', label: 'Niveau 1 : nombre de cartons' },
  { value: 'references', label: 'Niveau 2 : références' },
  { value: 'quantites', label: 'Niveau 3 : quantités' },
];

const STATUS_COLOR: Record<string, 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  en_cours: 'info',
  conforme: 'success',
  non_conforme: 'error',
  attente_correction: 'warning',
  invalide: 'default',
};

function ControlCard({
  control,
  onScan,
  onFinish,
}: {
  control: SecControlDTO;
  onScan: (control: SecControlDTO) => void;
  onFinish: (control: SecControlDTO) => void;
}) {
  const counted = control.observations.length;
  const expected = control.expectedCartons.length;
  return (
    <Paper variant="outlined" className="p-3">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Typography variant="body1">{control.code}</Typography>
          <Chip size="small" color={STATUS_COLOR[control.status] ?? 'default'} label={control.status} />
          <Chip size="small" variant="outlined" label={control.level} />
          <Chip size="small" variant="outlined" label={`Dossier ${control.dossierCode}`} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Commande {control.orderCode} — version dossier {control.version} — démarré
          par {control.startedByName ?? '?'} le {control.startedAt}
        </Typography>
        <Typography variant="body2">
          Cartons : {counted} / {expected} comptés
        </Typography>
        {control.status === 'en_cours' ? (
          <Stack direction="row" spacing={1} useFlexGap>
            <Button size="small" variant="contained" onClick={() => onScan(control)}>
              Compter un carton
            </Button>
            <Button size="small" onClick={() => onFinish(control)}>
              Clôturer le contrôle
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function ControlesManager() {
  const { data: dossiers, loading, error, refresh } = useSecuriteData<SecDossierDTO[]>(
    '/api/securite/dossiers',
  );
  const { data: controls, refresh: refreshControls } = useSecuriteData<SecControlDTO[]>(
    '/api/securite/controles',
  );
  const [scanControl, setScanControl] = useState<SecControlDTO | null>(null);
  const [finishControl, setFinishControl] = useState<SecControlDTO | null>(null);
  const [startDossier, setStartDossier] = useState<SecDossierDTO | null>(null);
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [level, setLevel] = useState<SecControlLevel | ''>('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const submittable = (dossiers ?? []).filter(
    (dossier) => dossier.status === 'soumis' && dossier.securityResult === null,
  );

  const run = async (
    body: Record<string, unknown>,
    onDone: (result: Record<string, unknown>) => void,
  ) => {
    setActionError(null);
    try {
      const result = await sendSecurite('/api/securite/controles', body);
      onDone(result);
      void refresh();
      void refreshControls();
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
        <Typography variant="subtitle1">Dossiers à contrôler</Typography>
        <Stack spacing={1} className="mt-2">
          {submittable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun dossier en attente.
            </Typography>
          ) : (
            submittable.map((dossier) => (
              <Stack key={dossier.id} direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body2">
                  {dossier.code} — commande {dossier.orderCode} — v{dossier.version} —{' '}
                  {dossier.cartons.length} carton(s) attendu(s) — préparé par{' '}
                  {dossier.submittedByName ?? '?'}
                </Typography>
                <Button size="small" variant="contained" onClick={() => setStartDossier(dossier)}>
                  Démarrer le contrôle
                </Button>
              </Stack>
            ))
          )}
        </Stack>
      </Paper>

      <Typography variant="subtitle1">Contrôles ({controls?.length ?? 0})</Typography>
      {(controls?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun contrôle.
        </Typography>
      ) : (
        controls?.map((control) => (
          <ControlCard
            key={control.id}
            control={control}
            onScan={setScanControl}
            onFinish={setFinishControl}
          />
        ))
      )}

      {startDossier ? (
        <Dialog open onClose={() => setStartDossier(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Démarrer le contrôle — {startDossier.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                select
                label="Niveau de contrôle"
                value={level}
                onChange={(event) => setLevel(event.target.value as SecControlLevel | '')}
                size="small"
              >
                {LEVELS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <Alert severity="info">
                Le niveau ne peut pas être inférieur au niveau configuré par
                l’entreprise.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStartDossier(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  { action: 'start', dossierId: startDossier.id, level: level || undefined },
                  (result) => {
                    const item = result.item as { code?: string } | undefined;
                    setMessage(`Contrôle ${item?.code ?? ''} démarré.`);
                    setStartDossier(null);
                    setLevel('');
                  },
                );
              }}
            >
              Démarrer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {scanControl ? (
        <Dialog open onClose={() => setScanControl(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Compter un carton — {scanControl.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                autoFocus
                label="QR code ou code manuel (ex. CT-000001)"
                size="small"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Typography variant="caption" color="text.secondary">
                Format QR : JO|CARTON|CODE. Chaque carton ne compte qu’une fois ;
                les doublons, cartons inconnus et supplémentaires créent des anomalies.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setScanControl(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  { action: 'scan', controleId: scanControl.id, code },
                  (result) => {
                    const item = result.item as { message?: string; result?: string } | undefined;
                    setMessage(`${item?.result ?? ''} — ${item?.message ?? ''}`);
                    setCode('');
                    setScanControl(null);
                  },
                );
              }}
            >
              Enregistrer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {finishControl ? (
        <Dialog open onClose={() => setFinishControl(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Clôturer le contrôle — {finishControl.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Observations (facultatives)"
                size="small"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              <Alert severity="info">
                Les écarts sont calculés côté serveur : cartons manquants,
                références incohérentes, quantités non vérifiées.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFinishControl(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await run(
                  { action: 'finish', controleId: finishControl.id, notes },
                  (result) => {
                    const item = result.item as { status?: string } | undefined;
                    setMessage(`Contrôle clôturé : ${item?.status ?? '?'}`);
                    setNotes('');
                    setFinishControl(null);
                  },
                );
              }}
            >
              Clôturer
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
