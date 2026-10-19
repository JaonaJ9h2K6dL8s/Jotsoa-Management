'use client';

import { useMemo, useState } from 'react';
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
import type {
  AssignmentDTO,
  CoutureRoomDTO,
  LotBalanceDTO,
} from '@/types/couture';
import { ASSIGNMENT_STATUS_LABELS, COUTURE_LOT_STATUS_LABELS } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * Affectation des lots reçus aux salles et lignes de couture, avec
 * transitions contrôlées et réaffectation tracée.
 */

interface SizeBalance {
  sizeId: number;
  sizeLabel: string;
  received: number;
  contested: number;
  assigned: number;
}

function AssignDialog({
  lot,
  rooms,
  onClose,
  onDone,
}: {
  lot: LotBalanceDTO;
  rooms: CoutureRoomDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { data: sizes } = useCoutureData<SizeBalance[]>(
    `/api/couture/balances?lotId=${lot.lotId}`,
  );
  const [roomId, setRoomId] = useState('');
  const [lineId, setLineId] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeRooms = rooms.filter((room) => room.isActive);
  const lines = activeRooms
    .find((room) => String(room.id) === roomId)
    ?.lines.filter((line) => line.isActive) ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payloadSizes = Object.entries(quantities)
        .filter(([, value]) => value !== '' && Number(value) > 0)
        .map(([sizeId, value]) => ({ sizeId: Number(sizeId), plannedQty: value }));
      await sendCouture('/api/couture/assignments', 'POST', {
        lotId: lot.lotId,
        roomId: Number(roomId),
        lineId: Number(lineId),
        sizes: payloadSizes,
        notes: notes || null,
      });
      onDone(`Affectation créée pour le lot ${lot.lotCode}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Affecter le lot {lot.lotCode}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Salle"
            value={roomId}
            onChange={(event) => {
              setRoomId(event.target.value);
              setLineId('');
            }}
            size="small"
          >
            {activeRooms.map((room) => (
              <MenuItem key={room.id} value={String(room.id)}>
                {room.nom}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Ligne"
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
            size="small"
            disabled={!roomId}
            helperText={
              roomId && lines.length === 0
                ? 'Aucune ligne active dans cette salle : créez-en dans « Salles et lignes ».'
                : undefined
            }
          >
            {lines.map((line) => (
              <MenuItem key={line.id} value={String(line.id)}>
                {line.nom} ({line.code})
              </MenuItem>
            ))}
          </TextField>
          {(sizes ?? []).map((size) => {
            const available = Math.max(0, size.received - size.contested - size.assigned);
            return (
              <TextField
                key={size.sizeId}
                label={`Taille ${size.sizeLabel} — disponible : ${available}`}
                type="number"
                size="small"
                value={quantities[size.sizeId] ?? ''}
                inputProps={{ min: 0, max: available, step: 'any' }}
                onChange={(event) =>
                  setQuantities((prev) => ({ ...prev, [size.sizeId]: event.target.value }))
                }
              />
            );
          })}
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
          disabled={busy || !roomId || !lineId}
        >
          Créer l’affectation
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignmentActions({ assignment, onDone }: { assignment: AssignmentDTO; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setError(null);
    try {
      await sendCouture(`/api/couture/assignments/${assignment.id}`, 'PATCH', {
        action,
        reason: reason || undefined,
        ...extra,
      });
      setReason('');
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };
  return (
    <Stack direction="row" spacing={1} useFlexGap className="flex-wrap items-center">
      {['affecte', 'en_pause'].includes(assignment.status) ? (
        <Button size="small" onClick={() => act('start')}>Démarrer</Button>
      ) : null}
      {assignment.status === 'en_cours' ? (
        <Button size="small" onClick={() => act('pause')}>Pause</Button>
      ) : null}
      {['en_cours', 'en_pause'].includes(assignment.status) ? (
        <Button size="small" onClick={() => act('finish')}>Terminer</Button>
      ) : null}
      {!['terminee', 'annulee'].includes(assignment.status) ? (
        <Button size="small" color="warning" onClick={() => act('block')}>
          Bloquer
        </Button>
      ) : null}
      {assignment.status === 'bloquee' ? (
        <Button size="small" onClick={() => act('unblock')}>Débloquer</Button>
      ) : null}
      {assignment.status !== 'annulee' ? (
        <Button size="small" color="error" onClick={() => act('cancel')}>Annuler</Button>
      ) : null}
      <TextField
        label="Motif (blocage/annulation)"
        size="small"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="min-w-48"
      />
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
}

export default function AffectationsManager() {
  const balances = useCoutureData<LotBalanceDTO[]>('/api/couture/balances');
  const roomsData = useCoutureData<CoutureRoomDTO[]>('/api/couture/rooms');
  const assignments = useCoutureData<AssignmentDTO[]>('/api/couture/assignments');
  const [assignLot, setAssignLot] = useState<LotBalanceDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshAll = useMemo(
    () => () => {
      void balances.refresh();
      void assignments.refresh();
    },
    [balances, assignments],
  );

  return (
    <Stack spacing={3}>
      {(balances.loading || assignments.loading || roomsData.loading) ? <LinearProgress /> : null}
      {balances.error ? <Alert severity="error">{balances.error}</Alert> : null}
      {assignments.error ? <Alert severity="error">{assignments.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack spacing={1}>
        <Typography variant="subtitle1">
          Soldes des lots (quantités recalculées depuis les mouvements réels)
        </Typography>
        {(balances.data ?? []).map((lot) => (
          <Paper key={lot.lotId} variant="outlined" className="p-3">
            <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap>
              <Stack>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                  <Typography variant="body1">{lot.lotCode}</Typography>
                  <Chip size="small" label={COUTURE_LOT_STATUS_LABELS[lot.status] ?? lot.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {lot.productNom} — {lot.colorNom} · Reçu : {lot.receivedQty} · Contesté :{' '}
                  {lot.contestedQty} · Affecté : {lot.assignedQty} · Cousu : {lot.sewnQty} ·
                  Disponible à affecter : {lot.availableToAssign}
                </Typography>
              </Stack>
              <Button
                variant="contained"
                disabled={lot.availableToAssign <= 0}
                onClick={() => setAssignLot(lot)}
              >
                Affecter
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">Affectations</Typography>
        {(assignments.data ?? []).map((assignment) => (
          <Paper key={assignment.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">{assignment.code}</Typography>
                <Chip size="small" label={ASSIGNMENT_STATUS_LABELS[assignment.status]} />
                <Typography variant="body2" color="text.secondary">
                  lot {assignment.lotCode} — {assignment.roomNom} / {assignment.lineNom} —
                  responsable : {assignment.responsableNom ?? '—'}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {assignment.sizes
                  .map((size) => `${size.sizeLabel} : ${size.sewnQty}/${size.plannedQty}`)
                  .join(' · ')}
              </Typography>
              <AssignmentActions assignment={assignment} onDone={refreshAll} />
            </Stack>
          </Paper>
        ))}
      </Stack>

      {assignLot ? (
        <AssignDialog
          lot={assignLot}
          rooms={roomsData.data ?? []}
          onClose={() => setAssignLot(null)}
          onDone={(text) => {
            setAssignLot(null);
            setMessage(text);
            refreshAll();
          }}
        />
      ) : null}
    </Stack>
  );
}
