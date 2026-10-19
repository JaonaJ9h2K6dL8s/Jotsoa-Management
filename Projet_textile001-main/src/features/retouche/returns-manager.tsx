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
import type { RtRequestDTO, RtReturnDTO } from '@/types/retouche';
import { sendRt, useRtData } from './use-retouche';

/**
 * Retour des quantités réparées au Contrôle qualité (contrôle final)
 * et propositions de rebut pour les pièces non réparables. Les
 * disponibilités affichées sont revérifiées côté serveur.
 */

interface RebutPayload {
  proposals: Array<{
    id: number;
    code: string;
    requestCode: string;
    sizeId: number;
    sizeLabel: string;
    qty: number;
    motif: string;
    retoucheurNom: string;
    status: 'en_attente' | 'approuvee' | 'refusee';
    decidedByName: string | null;
    decisionNote: string | null;
    createdAt: string;
  }>;
}

/** Réparé non retourné, par taille (affichage ; recalculé côté serveur). */
function ReturnDialog({
  request,
  onClose,
  onDone,
}: {
  request: RtRequestDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendRt('/api/retouche/returns', 'POST', {
        requestId: request.id,
        notes: notes || null,
        lines: request.lines
          .filter((line) => Number(qty[line.sizeId] ?? '0') > 0)
          .map((line) => ({ sizeId: line.sizeId, qty: qty[line.sizeId] ?? '0' })),
      });
      onDone(`Retour transmis au Contrôle qualité pour ${request.code}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Transmettre au contrôle final — {request.code}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            Seules les quantités réellement réparées peuvent être
            retournées. Le Contrôle qualité décidera de la conformité.
          </Typography>
          {request.lines.map((line) => (
            <TextField
              key={line.sizeId}
              label={`Quantité retournée — ${line.sizeLabel} (réparée non retournée : à saisir)`}
              type="number"
              size="small"
              value={qty[line.sizeId] ?? ''}
              inputProps={{ min: 0, step: 'any' }}
              onChange={(event) =>
                setQty((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
              }
            />
          ))}
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
        <Button variant="contained" onClick={submit} disabled={busy}>
          Transmettre
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RebutDialog({
  request,
  onClose,
  onDone,
}: {
  request: RtRequestDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [sizeId, setSizeId] = useState('');
  const [qty, setQty] = useState('');
  const [motif, setMotif] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendRt('/api/retouche/rebuts', 'POST', {
        action: 'create',
        requestId: request.id,
        sizeId,
        qty,
        motif,
      });
      onDone(
        'Proposition de rebut soumise : elle attend la décision du Contrôle qualité.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Proposer un rebut — {request.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Taille"
            size="small"
            value={sizeId}
            onChange={(event) => setSizeId(event.target.value)}
          >
            {request.lines.map((line) => (
              <MenuItem key={line.sizeId} value={String(line.sizeId)}>
                {line.sizeLabel}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Quantité déclarée non réparable"
            type="number"
            size="small"
            inputProps={{ min: 0, step: 'any' }}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
          <TextField
            label="Motif obligatoire"
            size="small"
            value={motif}
            onChange={(event) => setMotif(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          color="error"
          onClick={submit}
          disabled={busy || !sizeId || !motif.trim()}
        >
          Soumettre
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ReturnsManager() {
  const requests = useRtData<RtRequestDTO[]>('/api/retouche/requests');
  const returnsList = useRtData<RtReturnDTO[]>('/api/retouche/returns');
  const rebuts = useRtData<RebutPayload['proposals']>('/api/retouche/rebuts');
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'return'; request: RtRequestDTO }
    | { kind: 'rebut'; request: RtRequestDTO }
    | null
  >(null);

  const refreshAll = () => {
    void requests.refresh();
    void returnsList.refresh();
    void rebuts.refresh();
  };

  return (
    <Stack spacing={3}>
      {requests.loading || returnsList.loading || rebuts.loading ? (
        <LinearProgress />
      ) : null}
      {requests.error ? <Alert severity="error">{requests.error}</Alert> : null}
      {returnsList.error ? <Alert severity="error">{returnsList.error}</Alert> : null}
      {rebuts.error ? <Alert severity="error">{rebuts.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">
        Retours au Contrôle qualité
      </Typography>
      {(returnsList.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun retour transmis pour le moment.
        </Typography>
      ) : (
        returnsList.data?.map((item) => (
          <Paper key={item.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                {item.code} — {item.requestCode} — lot {item.lotCode}
              </Typography>
              <Chip
                size="small"
                color={item.status === 'transmis' ? 'success' : 'default'}
                label={item.status === 'transmis' ? 'Transmis' : 'Annulé'}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {item.lines
                .map((line) => `${line.sizeLabel} : ${line.qty}`)
                .join(' · ')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Par {item.returnedByName ?? '—'} le {item.createdAt}
              {item.notes ? ` — ${item.notes}` : ''}
            </Typography>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">
        Demandes prêtes pour le contrôle final
      </Typography>
      {(requests.data?.filter(
        (request) =>
          request.receptionId &&
          request.status === 'en_attente' &&
          request.processedQty > 0,
      ).length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune demande avec des quantités traitées en attente de transmission.
        </Typography>
      ) : (
        requests.data
          ?.filter(
            (request) =>
              request.receptionId &&
              request.status === 'en_attente' &&
              request.processedQty > 0,
          )
          .map((request) => (
            <Paper key={request.id} variant="outlined" className="p-3">
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                useFlexGap
              >
                <Stack>
                  <Typography variant="body1">
                    {request.code} — lot {request.lotCode}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Traité : {request.processedQty} — retourné :{' '}
                    {request.returnedQty}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() => setDialog({ kind: 'return', request })}
                  >
                    Transmettre au CQ
                  </Button>
                  <Button
                    color="error"
                    onClick={() => setDialog({ kind: 'rebut', request })}
                  >
                    Proposer un rebut
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))
      )}

      <Typography variant="subtitle1">Propositions de rebut</Typography>
      {(rebuts.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune proposition de rebut.
        </Typography>
      ) : (
        rebuts.data?.map((proposal) => (
          <Paper key={proposal.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                {proposal.code} — {proposal.requestCode} — {proposal.qty}{' '}
                pièce(s) en taille {proposal.sizeLabel}
              </Typography>
              <Chip
                size="small"
                color={
                  proposal.status === 'approuvee'
                    ? 'success'
                    : proposal.status === 'refusee'
                      ? 'error'
                      : 'warning'
                }
                label={
                  proposal.status === 'approuvee'
                    ? 'Approuvée'
                    : proposal.status === 'refusee'
                      ? 'Refusée'
                      : 'En attente du CQ'
                }
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Motif : {proposal.motif} — par {proposal.retoucheurNom}
              {proposal.decidedByName
                ? ` — décidée par ${proposal.decidedByName}`
                : ''}
              {proposal.decisionNote ? ` — ${proposal.decisionNote}` : ''}
            </Typography>
          </Paper>
        ))
      )}

      {dialog?.kind === 'return' ? (
        <ReturnDialog
          request={dialog.request}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            refreshAll();
          }}
        />
      ) : null}
      {dialog?.kind === 'rebut' ? (
        <RebutDialog
          request={dialog.request}
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
