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
import type { AssignmentDTO, ProductionDTO } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * Enregistrement de la production réellement cousue. Plusieurs
 * enregistrements par affectation sont possibles ; la correction ou
 * l'annulation passe par une seconde validation.
 */

function RecordDialog({
  assignments,
  onClose,
  onDone,
}: {
  assignments: AssignmentDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const usable = assignments.filter((item) =>
    ['affecte', 'en_cours'].includes(item.status),
  );
  const [assignmentId, setAssignmentId] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = usable.find((item) => String(item.id) === assignmentId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCouture('/api/couture/productions', 'POST', {
        assignmentId: Number(assignmentId),
        sizeId: Number(sizeId),
        qty,
        notes: notes || null,
      });
      onDone('Production enregistrée.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Enregistrer une production</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Affectation"
            value={assignmentId}
            onChange={(event) => {
              setAssignmentId(event.target.value);
              setSizeId('');
            }}
            size="small"
          >
            {usable.map((item) => (
              <MenuItem key={item.id} value={String(item.id)}>
                {item.code} — lot {item.lotCode} — {item.lineNom}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Taille"
            value={sizeId}
            onChange={(event) => setSizeId(event.target.value)}
            size="small"
            disabled={!selected}
          >
            {(selected?.sizes ?? []).map((size) => (
              <MenuItem key={size.sizeId} value={String(size.sizeId)}>
                {size.sizeLabel} — cousu {size.sewnQty} / prévu {size.plannedQty}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Quantité réellement cousue"
            type="number"
            size="small"
            value={qty}
            inputProps={{ min: 1, step: 'any' }}
            onChange={(event) => setQty(event.target.value)}
          />
          <TextField
            label="Commentaire (facultatif)"
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
          disabled={busy || !assignmentId || !sizeId}
        >
          Enregistrer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProductionRow({
  production,
  onDone,
}: {
  production: ProductionDTO;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newQty, setNewQty] = useState(String(production.qty));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (action: 'correct' | 'cancel') => {
    setError(null);
    try {
      await sendCouture(`/api/couture/productions/${production.id}`, 'PATCH', {
        action,
        newQty,
        reason,
      });
      setOpen(false);
      setReason('');
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Paper variant="outlined" className="p-3">
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
        <Typography variant="body1">
          #{production.id} — {production.assignmentCode} — taille {production.sizeLabel} :{' '}
          {production.qty} pièce(s)
        </Typography>
        <Chip
          size="small"
          color={production.status === 'normal' ? 'default' : 'warning'}
          label={
            production.status === 'normal'
              ? 'Active'
              : production.status === 'corrigee'
                ? 'Corrigée'
                : 'Annulée'
          }
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Lot {production.lotCode} — enregistrée par {production.recordedByName ?? '—'} le{' '}
        {production.createdAt}
        {production.operatorName ? ` — opérateur : ${production.operatorName}` : ''}
      </Typography>
      {production.status === 'normal' ? (
        <Button size="small" onClick={() => setOpen(true)}>
          Corriger / annuler (seconde validation)
        </Button>
      ) : null}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Correction de la production #{production.id} — opération sensible
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-2">
            <TextField
              label="Nouvelle quantité"
              type="number"
              size="small"
              value={newQty}
              onChange={(event) => setNewQty(event.target.value)}
            />
            <TextField
              label="Motif obligatoire"
              size="small"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button color="error" onClick={() => submit('cancel')}>
              Demander l’annulation totale
            </Button>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Fermer</Button>
          <Button variant="contained" onClick={() => submit('correct')}>
            Soumettre la correction
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default function ProductionsManager() {
  const assignments = useCoutureData<AssignmentDTO[]>('/api/couture/assignments');
  const productions = useCoutureData<ProductionDTO[]>('/api/couture/productions');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshAll = () => {
    void assignments.refresh();
    void productions.refresh();
  };

  return (
    <Stack spacing={3}>
      {assignments.loading || productions.loading ? <LinearProgress /> : null}
      {assignments.error ? <Alert severity="error">{assignments.error}</Alert> : null}
      {productions.error ? <Alert severity="error">{productions.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" onClick={() => setOpen(true)}>
          Enregistrer une production
        </Button>
      </Stack>
      {(productions.data ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune production enregistrée.
        </Typography>
      ) : (
        (productions.data ?? []).map((production) => (
          <ProductionRow
            key={production.id}
            production={production}
            onDone={() => {
              setMessage('Demande soumise : en attente de seconde validation.');
              refreshAll();
            }}
          />
        ))
      )}
      {open ? (
        <RecordDialog
          assignments={assignments.data ?? []}
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false);
            setMessage(text);
            refreshAll();
          }}
        />
      ) : null}
    </Stack>
  );
}
