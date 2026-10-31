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
import WorkTimer from '@/components/common/work-timer';
import type {
  RtAssignmentDTO,
  RtInterventionDTO,
  RtRequestDTO,
} from '@/types/retouche';
import { sendRt, useRtData } from './use-retouche';

/**
 * Affectation des demandes réceptionnées aux retoucheurs réellement
 * configurés. Les quantités disponibles pour affectation sont
 * recalculées côté serveur depuis les mouvements réels.
 */

interface ReferencesPayload {
  retoucheurs: Array<{ id: number; nom: string; prenom: string | null }>;
}

interface RequestsPayload {
  requests: RtRequestDTO[];
  receptions: unknown[];
}

/** Disponible à l'affectation, calculé côté client pour l'affichage. */
function availableFor(
  request: RtRequestDTO,
  assignments: RtAssignmentDTO[],
): Array<{ sizeId: number; sizeLabel: string; available: number }> {
  return request.lines.map((line) => {
    const assigned = assignments
      .filter(
        (assignment) =>
          assignment.requestId === request.id && assignment.status !== 'annulee',
      )
      .flatMap((assignment) => assignment.lines)
      .filter((assignmentLine) => assignmentLine.sizeId === line.sizeId)
      .reduce((acc, assignmentLine) => acc + assignmentLine.qty, 0);
    return {
      sizeId: line.sizeId,
      sizeLabel: line.sizeLabel,
      available: Math.max(0, line.receivedQty - assigned),
    };
  });
}

function AssignDialog({
  request,
  retoucheurs,
  available,
  onClose,
  onDone,
}: {
  request: RtRequestDTO;
  retoucheurs: ReferencesPayload['retoucheurs'];
  available: Array<{ sizeId: number; sizeLabel: string; available: number }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [retoucheurId, setRetoucheurId] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendRt('/api/retouche/assignments', 'POST', {
        requestId: request.id,
        retoucheurId,
        notes: notes || null,
        lines: request.lines
          .filter((line) => Number(qty[line.sizeId] ?? '0') > 0)
          .map((line) => ({ sizeId: line.sizeId, qty: qty[line.sizeId] ?? '0' })),
      });
      onDone(`Affectation créée pour la demande ${request.code}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Affecter la demande {request.code} — lot {request.lotCode}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Retoucheur"
            size="small"
            value={retoucheurId}
            onChange={(event) => setRetoucheurId(event.target.value)}
          >
            {retoucheurs.map((retoucheur) => (
              <MenuItem key={retoucheur.id} value={String(retoucheur.id)}>
                {retoucheur.prenom ? `${retoucheur.prenom} ` : ''}
                {retoucheur.nom}
              </MenuItem>
            ))}
          </TextField>
          {request.lines.map((line) => {
            const remaining =
              available.find((item) => item.sizeId === line.sizeId)?.available ?? 0;
            return (
              <TextField
                key={line.sizeId}
                label={`Quantité à affecter — ${line.sizeLabel} (disponible : ${remaining})`}
                type="number"
                size="small"
                value={qty[line.sizeId] ?? ''}
                inputProps={{ min: 0, max: remaining, step: 'any' }}
                disabled={remaining === 0}
                onChange={(event) =>
                  setQty((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
                }
              />
            );
          })}
          <TextField
            label="Consignes (facultatif)"
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
          disabled={busy || !retoucheurId}
        >
          Affecter
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AssignmentsManager() {
  const requests = useRtData<RequestsPayload>('/api/retouche/requests');
  const assignments = useRtData<RtAssignmentDTO[]>('/api/retouche/assignments');
  const references = useRtData<ReferencesPayload>('/api/retouche/references');
  const interventions = useRtData<RtInterventionDTO[]>('/api/retouche/interventions');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RtRequestDTO | null>(null);

  // Chrono temps réel : l'ancre du segment en cours est l'intervention
  // ouverte de l'affectation (le cumul serveur n'inclut que les
  // interventions terminées).
  const openByAssignment = useMemo(() => {
    const map = new Map<number, RtInterventionDTO>();
    for (const intervention of interventions.data ?? []) {
      if (intervention.status === 'en_cours') {
        map.set(intervention.assignmentId, intervention);
      }
    }
    return map;
  }, [interventions.data]);

  const refreshAll = () => {
    void requests.refresh();
    void assignments.refresh();
  };

  return (
    <Stack spacing={3}>
      {requests.loading || assignments.loading || references.loading ? (
        <LinearProgress />
      ) : null}
      {requests.error ? <Alert severity="error">{requests.error}</Alert> : null}
      {assignments.error ? <Alert severity="error">{assignments.error}</Alert> : null}
      {references.error ? <Alert severity="error">{references.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      <Typography variant="subtitle1">Affectations</Typography>
      {(assignments.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune affectation enregistrée.
        </Typography>
      ) : (
        assignments.data?.map((assignment) => {
          const openIntervention = openByAssignment.get(assignment.id);
          return (
          <Paper key={assignment.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {assignment.code} — {assignment.requestCode} — lot{' '}
                  {assignment.lotCode}
                </Typography>
                <Chip
                  size="small"
                  color={
                    assignment.status === 'terminee'
                      ? 'success'
                      : assignment.status === 'annulee'
                        ? 'default'
                        : 'primary'
                  }
                  label={
                    assignment.status === 'terminee'
                      ? 'Terminée'
                      : assignment.status === 'en_cours'
                        ? 'En cours'
                        : 'Affectée'
                  }
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Retoucheur : {assignment.retoucheurNom} —{' '}
                {assignment.lines
                  .map((line) => `${line.sizeLabel} : ${line.qty}`)
                  .join(' · ')}
              </Typography>
              <WorkTimer
                startedAt={assignment.startedAt}
                endedAt={assignment.endedAt}
                workedSeconds={assignment.workedSeconds}
                anchorAt={openIntervention?.startedAt ?? assignment.startedAt ?? assignment.createdAt}
                live={Boolean(openIntervention)}
              />
              <Typography variant="caption" color="text.secondary">
                Affectée par {assignment.assignedByName ?? '—'} le{' '}
                {assignment.createdAt}
                {assignment.notes ? ` — ${assignment.notes}` : ''}
              </Typography>
            </Stack>
          </Paper>
          );
        })
      )}

      <Typography variant="subtitle1">
        Demandes réceptionnées à affecter
      </Typography>
      {(requests.data?.requests.filter(
        (request) => request.receptionId && request.status === 'en_attente',
      ).length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune demande réceptionnée en attente d’affectation.
        </Typography>
      ) : (
        requests.data?.requests
          .filter(
            (request) => request.receptionId && request.status === 'en_attente',
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
                    {request.code} — lot {request.lotCode} — {request.productNom}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Reçu :{' '}
                    {request.lines
                      .map((line) => `${line.sizeLabel} : ${line.receivedQty}`)
                      .join(' · ')}
                  </Typography>
                </Stack>
                <Button
                  variant="contained"
                  onClick={() => setSelected(request)}
                >
                  Affecter
                </Button>
              </Stack>
            </Paper>
          ))
      )}

      {selected && references.data ? (
        <AssignDialog
          request={selected}
          retoucheurs={references.data.retoucheurs}
          available={availableFor(selected, assignments.data ?? [])}
          onClose={() => setSelected(null)}
          onDone={(text) => {
            setSelected(null);
            setMessage(text);
            setActionError(null);
            refreshAll();
          }}
        />
      ) : null}
    </Stack>
  );
}
