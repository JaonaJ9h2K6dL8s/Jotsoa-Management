'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { apiPost } from '@/services/api-client';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';
import { ANOMALY_TYPE_LABELS } from './workflow-common';

/**
 * Confirmation des résultats réels de la coupe : seules les quantités
 * réellement coupées sont saisies — la quantité prévue n'est jamais
 * recopiée automatiquement. Les anomalies sont optionnelles (liste de
 * choix contrôlée, commentaire facultatif).
 */

interface SizeLineInput {
  sizeId: number;
  sizeNom: string;
  plannedQty: number;
  cut: string;
  usable: string;
  anomaly: string;
  waste: string;
}

interface AnomalyInput {
  sizeId: string;
  type: string;
  qty: string;
  motif: string;
}

export default function LotResultsDialog({
  open,
  onClose,
  lot,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  lot: LotWorkflowRow;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<SizeLineInput[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(
      lot.sizes.map((size) => ({
        sizeId: size.sizeId,
        sizeNom: size.sizeNom,
        plannedQty: size.plannedQty,
        cut: '',
        usable: '',
        anomaly: '',
        waste: '',
      })),
    );
    setAnomalies([]);
    setError(null);
  }, [open, lot]);

  function updateRow(sizeId: number, patch: Partial<SizeLineInput>) {
    setRows((prev) =>
      prev.map((row) => (row.sizeId === sizeId ? { ...row, ...patch } : row)),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/coupe/lots/${lot.id}/workflow`, {
        action: 'record_actual',
        lines: rows
          .filter((row) => row.cut !== '')
          .map((row) => ({
            sizeId: row.sizeId,
            cutQty: Number(row.cut),
            usableQty: row.usable === '' ? undefined : Number(row.usable),
            anomalyQty: row.anomaly === '' ? undefined : Number(row.anomaly),
            wasteQty: row.waste === '' ? undefined : Number(row.waste),
          })),
        anomalies: anomalies.map((anomaly) => ({
          sizeId: anomaly.sizeId ? Number(anomaly.sizeId) : undefined,
          type: anomaly.type,
          qty: anomaly.qty === '' ? undefined : Number(anomaly.qty),
          motif: anomaly.motif || undefined,
        })),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de l’enregistrement.');
    } finally {
      setBusy(false);
    }
  }

  const invalid = rows.some((row) => {
    const cut = Number(row.cut || 0);
    const usable = Number(row.usable || 0);
    const anomaly = Number(row.anomaly || 0);
    const waste = Number(row.waste || 0);
    return usable + anomaly > cut;
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Résultats réels de la coupe — lot {lot.code}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="caption" color="text.secondary">
            Prévu : {lot.totalPlannedQty} — déjà coupé : {lot.totalCutQty} —
            reste : {Math.max(0, lot.totalPlannedQty - lot.totalCutQty)}.
            Saisissez uniquement les quantités réellement coupées.
          </Typography>
          {rows.map((row) => (
            <Stack key={row.sizeId} direction="row" spacing={1} alignItems="center">
              <Typography sx={{ width: 90 }}>
                {row.sizeNom}
                <Typography variant="caption" display="block" color="text.secondary">
                  prévu {row.plannedQty}
                </Typography>
              </Typography>
              <TextField
                size="small"
                type="number"
                label="Coupé"
                value={row.cut}
                onChange={(event) =>
                  updateRow(row.sizeId, { cut: event.target.value })
                }
                sx={{ width: 110 }}
              />
              <TextField
                size="small"
                type="number"
                label="Utilisable"
                value={row.usable}
                onChange={(event) =>
                  updateRow(row.sizeId, { usable: event.target.value })
                }
                sx={{ width: 110 }}
              />
              <TextField
                size="small"
                type="number"
                label="Anomalie"
                value={row.anomaly}
                onChange={(event) =>
                  updateRow(row.sizeId, { anomaly: event.target.value })
                }
                sx={{ width: 110 }}
              />
              <TextField
                size="small"
                type="number"
                label="Rebut"
                value={row.waste}
                onChange={(event) =>
                  updateRow(row.sizeId, { waste: event.target.value })
                }
                sx={{ width: 110 }}
              />
            </Stack>
          ))}
          {invalid ? (
            <Alert severity="error">
              La somme utilisable + anomalie ne peut pas dépasser la quantité
              coupée.
            </Alert>
          ) : null}
          <Divider />
          <Typography variant="subtitle2">Anomalies (optionnel)</Typography>
          {anomalies.map((anomaly, index) => (
            <Stack key={index} direction="row" spacing={1} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Type</InputLabel>
                <Select
                  label="Type"
                  value={anomaly.type}
                  onChange={(event) =>
                    setAnomalies((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, type: event.target.value }
                          : row,
                      ),
                    )
                  }
                >
                  {Object.entries(ANOMALY_TYPE_LABELS).map(([key, label]) => (
                    <MenuItem key={key} value={key}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Taille</InputLabel>
                <Select
                  label="Taille"
                  value={anomaly.sizeId}
                  onChange={(event) =>
                    setAnomalies((prev) =>
                      prev.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, sizeId: event.target.value }
                          : row,
                      ),
                    )
                  }
                >
                  <MenuItem value="">—</MenuItem>
                  {lot.sizes.map((size) => (
                    <MenuItem key={size.sizeId} value={size.sizeId}>
                      {size.sizeNom}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label="Quantité"
                value={anomaly.qty}
                onChange={(event) =>
                  setAnomalies((prev) =>
                    prev.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, qty: event.target.value }
                        : row,
                    ),
                  )
                }
                sx={{ width: 100 }}
              />
              <TextField
                size="small"
                label="Commentaire (facultatif)"
                value={anomaly.motif}
                onChange={(event) =>
                  setAnomalies((prev) =>
                    prev.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, motif: event.target.value }
                        : row,
                    ),
                  )
                }
              />
              <IconButton
                aria-label="Supprimer l'anomalie"
                onClick={() =>
                  setAnomalies((prev) =>
                    prev.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          <Button
            startIcon={<AddIcon />}
            onClick={() =>
              setAnomalies((prev) => [
                ...prev,
                { sizeId: '', type: 'tissu_defectueux', qty: '', motif: '' },
              ])
            }
          >
            Signaler une anomalie
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
        <Button
          variant="contained"
          disabled={busy || invalid || !rows.some((row) => row.cut !== '')}
          onClick={() => void submit()}
        >
          Enregistrer les résultats
        </Button>
      </DialogActions>
    </Dialog>
  );
}
