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
import type { FinalControlDTO, ReworkRequestDTO } from '@/types/cq';
import { REWORK_STATUS_LABELS } from '@/types/cq';
import { sendCq, useCqData } from './use-cq';

/**
 * Demandes de retouche et contrôles finaux après retouche. Les
 * quantités revenues sont saisies par taille puis orientées :
 * conforme (vers le stock), nouvelle retouche ou rebut.
 */

function FinalResultsDialog({
  final,
  onClose,
  onDone,
}: {
  final: FinalControlDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      final.lines.map((line) => [
        line.sizeId,
        {
          returnedQty: String(line.returnedQty),
          conformeQty: String(line.conformeQty),
          reworkQty: String(line.reworkQty),
          rebutQty: String(line.rebutQty),
        },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq(`/api/controle-qualite/final/${final.id}`, 'PATCH', {
        action: 'submit',
        lines: final.lines.map((line) => ({
          sizeId: line.sizeId,
          returnedQty: lines[line.sizeId]?.returnedQty ?? '0',
          conformeQty: lines[line.sizeId]?.conformeQty ?? '0',
          reworkQty: lines[line.sizeId]?.reworkQty ?? '0',
          rebutQty: lines[line.sizeId]?.rebutQty ?? '0',
        })),
      });
      onDone(`Résultats du contrôle final ${final.code} enregistrés.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  const update = (sizeId: number, field: string, value: string) =>
    setLines((prev) => ({
      ...prev,
      [sizeId]: { ...prev[sizeId], [field]: value },
    }));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Contrôle final {final.code} — lot {final.lotCode} (demande{' '}
        {final.requestCode})
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {final.lines.map((line) => (
            <Stack key={line.sizeId} direction="row" spacing={1}>
              <Typography variant="caption" className="w-24 pt-3">
                {line.sizeLabel} (envoyé : {line.sentQty})
              </Typography>
              <TextField
                label="Revenu"
                size="small"
                type="number"
                fullWidth
                inputProps={{ min: 0, max: line.sentQty, step: 'any' }}
                value={lines[line.sizeId]?.returnedQty ?? '0'}
                onChange={(event) =>
                  update(line.sizeId, 'returnedQty', event.target.value)
                }
              />
              <TextField
                label="Conforme"
                size="small"
                type="number"
                fullWidth
                inputProps={{ min: 0, step: 'any' }}
                value={lines[line.sizeId]?.conformeQty ?? '0'}
                onChange={(event) =>
                  update(line.sizeId, 'conformeQty', event.target.value)
                }
              />
              <TextField
                label="À retoucher"
                size="small"
                type="number"
                fullWidth
                inputProps={{ min: 0, step: 'any' }}
                value={lines[line.sizeId]?.reworkQty ?? '0'}
                onChange={(event) =>
                  update(line.sizeId, 'reworkQty', event.target.value)
                }
              />
              <TextField
                label="Rebut"
                size="small"
                type="number"
                fullWidth
                inputProps={{ min: 0, step: 'any' }}
                value={lines[line.sizeId]?.rebutQty ?? '0'}
                onChange={(event) =>
                  update(line.sizeId, 'rebutQty', event.target.value)
                }
              />
            </Stack>
          ))}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Enregistrer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ValidateFinalDialog({
  final,
  onClose,
  onDone,
}: {
  final: FinalControlDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const hasRework = final.lines.some((line) => line.reworkQty > 0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq(`/api/controle-qualite/final/${final.id}`, 'PATCH', {
        action: 'validate',
        reason: reason || null,
      });
      onDone(`Contrôle final ${final.code} validé.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Valider le contrôle final {final.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {hasRework ? (
            <Typography variant="body2" color="text.secondary">
              Des quantités partent en nouvelle retouche : un motif est
              obligatoire et une nouvelle demande traçable sera créée.
            </Typography>
          ) : null}
          <TextField
            label={hasRework ? 'Motif obligatoire' : 'Motif (facultatif)'}
            size="small"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Valider
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ReworkManager() {
  const rework = useCqData<ReworkRequestDTO[]>('/api/controle-qualite/rework');
  const finals = useCqData<FinalControlDTO[]>('/api/controle-qualite/final');
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'results'; final: FinalControlDTO }
    | { kind: 'validate'; final: FinalControlDTO }
    | null
  >(null);

  const refreshAll = () => {
    void rework.refresh();
    void finals.refresh();
  };

  const openFinal = async (request: ReworkRequestDTO) => {
    try {
      await sendCq('/api/controle-qualite/final', 'POST', {
        requestId: request.id,
      });
      setMessage(`Contrôle final ouvert pour la demande ${request.code}.`);
      refreshAll();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Erreur inattendue.',
      );
    }
  };

  return (
    <Stack spacing={3}>
      {rework.loading || finals.loading ? <LinearProgress /> : null}
      {rework.error ? <Alert severity="error">{rework.error}</Alert> : null}
      {finals.error ? <Alert severity="error">{finals.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">Demandes de retouche</Typography>
      {(rework.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune demande de retouche.
        </Typography>
      ) : (
        rework.data?.map((request) => (
          <Paper key={request.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                {request.code} — lot {request.lotCode} —{' '}
                {request.lines
                  .map((line) => `${line.sizeLabel} : ${line.qty}`)
                  .join(', ')}
              </Typography>
              <Chip
                size="small"
                color={request.status === 'en_attente' ? 'warning' : 'default'}
                label={REWORK_STATUS_LABELS[request.status]}
              />
              {request.origin === 'final' ? (
                <Chip size="small" variant="outlined" label="Nouvelle retouche" />
              ) : null}
              {request.status === 'en_attente' ? (
                <Button size="small" onClick={() => openFinal(request)}>
                  Ouvrir le contrôle final
                </Button>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {request.reason} — par {request.requestedByName ?? '—'}
            </Typography>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Contrôles finaux</Typography>
      {(finals.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun contrôle final.
        </Typography>
      ) : (
        finals.data?.map((final) => (
          <Paper key={final.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {final.code} — lot {final.lotCode} — demande{' '}
                  {final.requestCode}
                </Typography>
                <Chip
                  size="small"
                  color={final.status === 'valide' ? 'success' : 'warning'}
                  label={
                    final.status === 'valide'
                      ? 'Validé'
                      : 'En cours'
                  }
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {final.lines
                  .map(
                    (line) =>
                      `${line.sizeLabel} : revenu ${line.returnedQty}/${line.sentQty}, conf. ${line.conformeQty}, ret. ${line.reworkQty}, reb. ${line.rebutQty}`,
                  )
                  .join(' · ')}
              </Typography>
              {final.status === 'en_cours' ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setDialog({ kind: 'results', final })}
                  >
                    Saisir les résultats
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setDialog({ kind: 'validate', final })}
                  >
                    Valider
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      {dialog?.kind === 'results' ? (
        <FinalResultsDialog
          final={dialog.final}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            refreshAll();
          }}
        />
      ) : null}
      {dialog?.kind === 'validate' ? (
        <ValidateFinalDialog
          final={dialog.final}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            refreshAll();
          }}
        />
      ) : null}
    </Stack>
  );
}
