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
import type { RtAssignmentDTO, RtInterventionDTO } from '@/types/retouche';
import { RT_RESULT_LABELS } from '@/types/retouche';
import { sendRt, useRtData } from './use-retouche';

/**
 * Interventions de retouche : démarrage puis saisie des quantités
 * traitées par taille avec résultat. Seul le retoucheur affecté peut
 * intervenir (vérifié côté serveur).
 */

interface AssignmentsPayload {
  assignments: RtAssignmentDTO[];
}

function FinishDialog({
  intervention,
  onClose,
  onDone,
}: {
  intervention: RtInterventionDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      intervention.lines.map((line) => [
        line.sizeId,
        { processedQty: String(line.processedQty), result: line.result },
      ]),
    ),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendRt('/api/retouche/interventions', 'POST', {
        action: 'finish',
        interventionId: intervention.id,
        notes: notes || null,
        lines: intervention.lines.map((line) => ({
          sizeId: line.sizeId,
          processedQty: lines[line.sizeId]?.processedQty ?? '0',
          result: lines[line.sizeId]?.result ?? 'repare',
        })),
      });
      onDone(`Intervention ${intervention.code} terminée.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Terminer l’intervention {intervention.code} —{' '}
        {intervention.requestCode}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {intervention.lines.map((line) => (
            <Stack key={line.sizeId} direction="row" spacing={1}>
              <TextField
                label={`Traité — ${line.sizeLabel}`}
                size="small"
                type="number"
                fullWidth
                inputProps={{ min: 0, step: 'any' }}
                value={lines[line.sizeId]?.processedQty ?? '0'}
                onChange={(event) =>
                  setLines((prev) => ({
                    ...prev,
                    [line.sizeId]: {
                      ...prev[line.sizeId],
                      processedQty: event.target.value,
                    },
                  }))
                }
              />
              <TextField
                select
                label="Résultat"
                size="small"
                fullWidth
                value={lines[line.sizeId]?.result ?? 'repare'}
                onChange={(event) =>
                  setLines((prev) => ({
                    ...prev,
                    [line.sizeId]: {
                      ...prev[line.sizeId],
                      result: event.target.value as 'repare' | 'irreparable' | 'partiel',
                    },
                  }))
                }
              >
                {Object.entries(RT_RESULT_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
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
          Enregistrer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function InterventionsManager() {
  const assignments = useRtData<AssignmentsPayload['assignments']>(
    '/api/retouche/assignments',
  );
  const interventions = useRtData<RtInterventionDTO[]>(
    '/api/retouche/interventions',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finishTarget, setFinishTarget] = useState<RtInterventionDTO | null>(null);

  const refreshAll = () => {
    void assignments.refresh();
    void interventions.refresh();
  };

  const start = async (assignment: RtAssignmentDTO) => {
    setActionError(null);
    try {
      await sendRt('/api/retouche/interventions', 'POST', {
        action: 'start',
        assignmentId: assignment.id,
      });
      setMessage(`Intervention démarrée sur ${assignment.code}.`);
      refreshAll();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Erreur inattendue.',
      );
    }
  };

  return (
    <Stack spacing={3}>
      {assignments.loading || interventions.loading ? <LinearProgress /> : null}
      {assignments.error ? <Alert severity="error">{assignments.error}</Alert> : null}
      {interventions.error ? <Alert severity="error">{interventions.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      <Typography variant="subtitle1">Interventions</Typography>
      {(interventions.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune intervention enregistrée.
        </Typography>
      ) : (
        interventions.data?.map((intervention) => (
          <Paper key={intervention.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {intervention.code} — {intervention.assignmentCode} —{' '}
                  {intervention.requestCode}
                </Typography>
                <Chip
                  size="small"
                  color={intervention.status === 'terminee' ? 'success' : 'primary'}
                  label={intervention.status === 'terminee' ? 'Terminée' : 'En cours'}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {intervention.lines
                  .map(
                    (line) =>
                      `${line.sizeLabel} : ${line.processedQty} (${RT_RESULT_LABELS[line.result]})`,
                  )
                  .join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Par {intervention.retoucheurNom} — début {intervention.startedAt}
                {intervention.endedAt ? ` — fin ${intervention.endedAt}` : ''}
                {intervention.action ? ` — action : ${intervention.action}` : ''}
                {intervention.notes ? ` — ${intervention.notes}` : ''}
              </Typography>
              {intervention.status === 'en_cours' ? (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => setFinishTarget(intervention)}
                >
                  Terminer l’intervention
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">
        Mes affectations prêtes à démarrer
      </Typography>
      {(assignments.data?.filter((item) => ['affectee', 'en_cours'].includes(item.status))
        .length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune affectation en cours.
        </Typography>
      ) : (
        assignments.data
          ?.filter((item) => ['affectee', 'en_cours'].includes(item.status))
          .map((assignment) => (
            <Paper key={assignment.id} variant="outlined" className="p-3">
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                useFlexGap
              >
                <Stack>
                  <Typography variant="body1">
                    {assignment.code} — {assignment.requestCode} — lot{' '}
                    {assignment.lotCode}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {assignment.lines
                      .map((line) => `${line.sizeLabel} : ${line.qty}`)
                      .join(' · ')}
                  </Typography>
                </Stack>
                <Button variant="contained" onClick={() => start(assignment)}>
                  Démarrer une intervention
                </Button>
              </Stack>
            </Paper>
          ))
      )}

      {finishTarget ? (
        <FinishDialog
          intervention={finishTarget}
          onClose={() => setFinishTarget(null)}
          onDone={(text) => {
            setFinishTarget(null);
            setMessage(text);
            setActionError(null);
            refreshAll();
          }}
        />
      ) : null}
    </Stack>
  );
}
