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
import type { CqControlDTO, CqDefautDTO } from '@/types/cq';
import { DECISION_LABELS, SEVERITY_LABELS } from '@/types/cq';
import { sendCq, useCqData } from './use-cq';

/**
 * Défauts qualité : déclaration pendant un contrôle, puis décision
 * (demande de retouche traçable ou rebut soumis à seconde validation).
 */

interface ReferencesPayload {
  defects: Array<{ id: number; nom: string; category: string | null }>;
  zones: Array<{ id: number; nom: string }>;
  controls: CqControlDTO[];
}

function DeclareDefautDialog({
  references,
  onClose,
  onDone,
}: {
  references: ReferencesPayload;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [controleId, setControleId] = useState('');
  const [defectId, setDefectId] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [qty, setQty] = useState('1');
  const [severity, setSeverity] = useState('mineure');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const control = references.controls.find(
    (item) => String(item.id) === controleId,
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq('/api/controle-qualite/defauts', 'POST', {
        controleId,
        sizeId,
        defectId,
        reworkZoneId: zoneId ? Number(zoneId) : null,
        qtyPieces: qty,
        severity,
        description: description || null,
      });
      onDone('Défaut déclaré.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Déclarer un défaut</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Contrôle (en cours ou incomplet)"
            size="small"
            value={controleId}
            onChange={(event) => {
              setControleId(event.target.value);
              setSizeId('');
            }}
          >
            {references.controls.map((item) => (
              <MenuItem key={item.id} value={String(item.id)}>
                {item.code} — lot {item.lotCode}
              </MenuItem>
            ))}
          </TextField>
          {control ? (
            <TextField
              select
              label="Taille inspectée"
              size="small"
              value={sizeId}
              onChange={(event) => setSizeId(event.target.value)}
            >
              {control.lines
                .filter((line) => line.inspectedQty > 0)
                .map((line) => (
                  <MenuItem key={line.sizeId} value={String(line.sizeId)}>
                    {line.sizeLabel} (inspecté : {line.inspectedQty})
                  </MenuItem>
                ))}
            </TextField>
          ) : null}
          <TextField
            select
            label="Catégorie de défaut"
            size="small"
            value={defectId}
            onChange={(event) => setDefectId(event.target.value)}
          >
            {references.defects.map((defect) => (
              <MenuItem key={defect.id} value={String(defect.id)}>
                {defect.nom}
                {defect.category ? ` (${defect.category})` : ''}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Zone (facultatif)"
              size="small"
              fullWidth
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
            >
              <MenuItem value="">—</MenuItem>
              {references.zones.map((zone) => (
                <MenuItem key={zone.id} value={String(zone.id)}>
                  {zone.nom}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Pièces concernées"
              size="small"
              type="number"
              fullWidth
              value={qty}
              inputProps={{ min: 1, step: 'any' }}
              onChange={(event) => setQty(event.target.value)}
            />
            <TextField
              select
              label="Gravité"
              size="small"
              fullWidth
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Description (facultatif)"
            size="small"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !controleId || !sizeId || !defectId}
        >
          Déclarer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DecisionDialog({
  defaut,
  kind,
  onClose,
  onDone,
}: {
  defaut: CqDefautDTO;
  kind: 'rework' | 'rebut';
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
      if (kind === 'rework') {
        await sendCq('/api/controle-qualite/rework', 'POST', {
          defautId: defaut.id,
          reason: reason || null,
        });
        onDone('Demande de retouche créée.');
      } else {
        await sendCq(`/api/controle-qualite/defauts/${defaut.id}`, 'POST', {
          reason: reason || null,
        });
        onDone(
          'Demande de rebut soumise : elle attend une seconde validation.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {kind === 'rework' ? 'Envoyer en retouche' : 'Décider un rebut'} —{' '}
        {defaut.defectNom}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            {defaut.qtyPieces} pièce(s) en taille {defaut.sizeLabel}.
          </Typography>
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
          color={kind === 'rebut' ? 'error' : 'primary'}
          onClick={submit}
          disabled={busy || !reason.trim()}
        >
          Confirmer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function DefautsManager() {
  const refs = useCqData<ReferencesPayload>('/api/controle-qualite/references');
  // L'API renvoie { items: [...] } et useCqData déballe « items » : data est le tableau.
  const defauts = useCqData<CqDefautDTO[]>('/api/controle-qualite/defauts');
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'declare' }
    | { kind: 'decision'; defaut: CqDefautDTO; kind2: 'rework' | 'rebut' }
    | null
  >(null);

  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    void refs.refresh();
    void defauts.refresh();
  };

  // useCqData déballe déjà le champ « items » de la réponse : data est le tableau.
  const defautsItems = defauts.data ?? [];

  return (
    <Stack spacing={3}>
      {refs.loading || defauts.loading ? <LinearProgress /> : null}
      {refs.error ? <Alert severity="error">{refs.error}</Alert> : null}
      {defauts.error ? <Alert severity="error">{defauts.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1">Défauts déclarés</Typography>
        <Button
          variant="contained"
          onClick={() => setDialog({ kind: 'declare' })}
        >
          Déclarer un défaut
        </Button>
      </Stack>

      {defautsItems.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun défaut déclaré.
        </Typography>
      ) : (
        defautsItems.map((defaut) => (
          <Paper key={defaut.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {defaut.defectNom} — {defaut.qtyPieces} pièce(s) — taille{' '}
                  {defaut.sizeLabel} — lot {defaut.lotCode}
                </Typography>
                <Chip
                  size="small"
                  color={
                    defaut.decision === 'rebut'
                      ? 'error'
                      : defaut.decision === 'retouche'
                        ? 'warning'
                        : 'default'
                  }
                  label={DECISION_LABELS[defaut.decision]}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={SEVERITY_LABELS[defaut.severity]}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Contrôle #{defaut.controleId}
                {defaut.reworkZoneNom ? ` — zone : ${defaut.reworkZoneNom}` : ''}
                {defaut.description ? ` — ${defaut.description}` : ''}
              </Typography>
              {defaut.decision === 'attente' ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() =>
                      setDialog({
                        kind: 'decision',
                        defaut,
                        kind2: 'rework',
                      })
                    }
                  >
                    Envoyer en retouche
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      setDialog({ kind: 'decision', defaut, kind2: 'rebut' })
                    }
                  >
                    Décider un rebut
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      {dialog?.kind === 'declare' && refs.data ? (
        <DeclareDefautDialog
          references={refs.data}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'decision' ? (
        <DecisionDialog
          defaut={dialog.defaut}
          kind={dialog.kind2}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </Stack>
  );
}
