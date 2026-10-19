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
import type { ControlStatus, CqControlDTO, CqReceptionDTO } from '@/types/cq';
import { CONTROL_STATUS_LABELS } from '@/types/cq';
import ControlResultsDialog from './control-results-dialog';
import { sendCq, useCqData } from './use-cq';

/**
 * Contrôles qualité : création à partir d'une réception complète,
 * suivi des statuts et actions (démarrer, saisir, valider, bloquer,
 * clôturer). Les quantités et transitions sont contrôlées côté serveur.
 */

interface ControlsPayload {
  receptions: CqReceptionDTO[];
  controls: CqControlDTO[];
}

function CreateControlDialog({
  receptions,
  onClose,
  onDone,
}: {
  receptions: CqReceptionDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const eligible = receptions.filter(
    (reception) => reception.status === 'complete',
  );
  const [receptionId, setReceptionId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq('/api/controle-qualite/controls', 'POST', {
        receptionId,
        notes: notes || null,
      });
      onDone('Contrôle créé.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Nouveau contrôle qualité</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {eligible.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune réception complète disponible. Une réception partielle
              ne peut pas être contrôlée tant que l’écart n’est pas résolu.
            </Typography>
          ) : (
            <TextField
              select
              label="Réception à contrôler"
              value={receptionId}
              onChange={(event) => setReceptionId(event.target.value)}
              size="small"
            >
              {eligible.map((reception) => (
                <MenuItem key={reception.id} value={String(reception.id)}>
                  {reception.code} — lot {reception.lotCode} —{' '}
                  {reception.productNom} ({reception.colorNom})
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label="Observations (facultatif)"
            size="small"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !receptionId}
        >
          Créer le contrôle
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BlockDialog({
  control,
  action,
  onClose,
  onDone,
}: {
  control: CqControlDTO;
  action: 'block' | 'unblock';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq(`/api/controle-qualite/controls/${control.id}`, 'PATCH', {
        action,
        reason: reason || null,
      });
      onDone(
        action === 'block'
          ? `Contrôle ${control.code} bloqué.`
          : `Contrôle ${control.code} débloqué.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {action === 'block' ? 'Bloquer' : 'Débloquer'} le contrôle{' '}
        {control.code}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            label="Motif obligatoire"
            size="small"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          color={action === 'block' ? 'error' : 'primary'}
          onClick={submit}
          disabled={busy || !reason.trim()}
        >
          Confirmer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

async function runAction(
  control: CqControlDTO,
  action: string,
): Promise<void> {
  await sendCq(`/api/controle-qualite/controls/${control.id}`, 'PATCH', {
    action,
  });
}

export default function ControlsManager() {
  const { data, loading, error, refresh } = useCqData<ControlsPayload>(
    '/api/controle-qualite/controls',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'results'; control: CqControlDTO }
    | { kind: 'block'; control: CqControlDTO }
    | { kind: 'unblock'; control: CqControlDTO }
    | null
  >(null);

  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    setActionError(null);
    void refresh();
  };

  const fail = (cause: unknown) => {
    setMessage(null);
    setActionError(
      cause instanceof Error ? cause.message : 'Erreur inattendue.',
    );
    void refresh();
  };

  const action = async (control: CqControlDTO, name: string) => {
    try {
      await runAction(control, name);
      done(`Action « ${name} » appliquée au contrôle ${control.code}.`);
    } catch (cause) {
      fail(cause);
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1">Contrôles qualité</Typography>
        <Button
          variant="contained"
          onClick={() => setDialog({ kind: 'create' })}
        >
          Nouveau contrôle
        </Button>
      </Stack>

      {(data?.controls.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun contrôle enregistré.
        </Typography>
      ) : (
        data?.controls.map((control) => (
          <Paper key={control.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {control.code} — lot {control.lotCode} — {control.productNom}{' '}
                  ({control.colorNom})
                </Typography>
                <Chip
                  size="small"
                  color={
                    control.status === 'valide' || control.status === 'cloture'
                      ? 'success'
                      : control.status === 'bloque'
                        ? 'error'
                        : 'default'
                  }
                  label={CONTROL_STATUS_LABELS[control.status as ControlStatus]}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {control.lines
                  .map(
                    (line) =>
                      `${line.sizeLabel} : inspec. ${line.inspectedQty}/${line.receivedQty}, conf. ${line.conformeQty}`,
                  )
                  .join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Contrôleur : {control.controlledByName ?? '—'} —{' '}
                {control.defauts.length} défaut(s) déclaré(s)
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap>
                {control.status === 'en_attente' ? (
                  <Button size="small" onClick={() => action(control, 'start')}>
                    Démarrer
                  </Button>
                ) : null}
                {['en_cours', 'incomplet'].includes(control.status) ? (
                  <>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => setDialog({ kind: 'results', control })}
                    >
                      Saisir les résultats
                    </Button>
                    <Button
                      size="small"
                      onClick={() => action(control, 'request_validation')}
                    >
                      Demander validation
                    </Button>
                  </>
                ) : null}
                {control.status === 'attente_validation' ? (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => action(control, 'validate')}
                  >
                    Valider le contrôle
                  </Button>
                ) : null}
                {['en_cours', 'incomplet', 'attente_validation'].includes(
                  control.status,
                ) ? (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setDialog({ kind: 'block', control })}
                  >
                    Bloquer
                  </Button>
                ) : null}
                {control.status === 'bloque' ? (
                  <Button
                    size="small"
                    onClick={() => setDialog({ kind: 'unblock', control })}
                  >
                    Débloquer
                  </Button>
                ) : null}
                {control.status === 'valide' ? (
                  <Button size="small" onClick={() => action(control, 'close')}>
                    Clôturer
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      {dialog?.kind === 'create' ? (
        <CreateControlDialog
          receptions={data?.receptions ?? []}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'results' ? (
        <ControlResultsDialog
          control={dialog.control}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'block' ? (
        <BlockDialog
          control={dialog.control}
          action="block"
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'unblock' ? (
        <BlockDialog
          control={dialog.control}
          action="unblock"
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </Stack>
  );
}
