'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CqControlDTO } from '@/types/cq';
import { sendCq } from './use-cq';

/**
 * Saisie des résultats d'un contrôle : quantités inspectées et
 * conformes par taille. La cohérence (inspecté ≤ reçu, conforme +
 * décisions ≤ inspecté) est revérifiée côté serveur.
 */
export default function ControlResultsDialog({
  control,
  onClose,
  onDone,
}: {
  control: CqControlDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [inspected, setInspected] = useState<Record<number, string>>(
    Object.fromEntries(control.lines.map((line) => [line.sizeId, String(line.inspectedQty)])),
  );
  const [conforme, setConforme] = useState<Record<number, string>>(
    Object.fromEntries(control.lines.map((line) => [line.sizeId, String(line.conformeQty)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq(`/api/controle-qualite/controls/${control.id}`, 'PATCH', {
        action: 'submit',
        lines: control.lines.map((line) => ({
          sizeId: line.sizeId,
          inspectedQty: inspected[line.sizeId] ?? '0',
          conformeQty: conforme[line.sizeId] ?? '0',
        })),
      });
      onDone(`Résultats du contrôle ${control.code} enregistrés.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Résultats du contrôle {control.code} — lot {control.lotCode}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            {control.productNom} — {control.colorNom}. Les pièces avec
            défauts doivent d’abord être déclarées, puis orientées
            (retouche ou rebut) avant la validation du contrôle.
          </Typography>
          {control.lines.map((line) => (
            <Stack key={line.sizeId} direction="row" spacing={2}>
              <TextField
                label={`Inspecté — ${line.sizeLabel} (reçu : ${line.receivedQty})`}
                type="number"
                size="small"
                fullWidth
                value={inspected[line.sizeId] ?? '0'}
                inputProps={{ min: 0, max: line.receivedQty, step: 'any' }}
                onChange={(event) =>
                  setInspected((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
                }
              />
              <TextField
                label={`Conforme — ${line.sizeLabel}`}
                type="number"
                size="small"
                fullWidth
                value={conforme[line.sizeId] ?? '0'}
                inputProps={{ min: 0, step: 'any' }}
                onChange={(event) =>
                  setConforme((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
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
          Enregistrer les résultats
        </Button>
      </DialogActions>
    </Dialog>
  );
}
