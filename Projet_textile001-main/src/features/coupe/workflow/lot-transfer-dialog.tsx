'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { apiPost } from '@/services/api-client';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';

/**
 * Confirmation de la remise physique à la couture : la couture saisit
 * les quantités réellement reçues ; les écarts sont enregistrés avec
 * leur motif. Les pièces retournées ne comptent pas comme production.
 */

interface TransferLineInput {
  sizeId: number;
  sizeNom: string;
  available: number;
  received: string;
}

export default function LotTransferDialog({
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
  const [rows, setRows] = useState<TransferLineInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(
      lot.sizes
        .filter((size) => size.cutQty > 0)
        .map((size) => ({
          sizeId: size.sizeId,
          sizeNom: size.sizeNom,
          available: size.cutQty,
          received: '',
        })),
    );
    setError(null);
  }, [open, lot]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/coupe/lots/${lot.id}/workflow`, {
        action: 'confirm_transfer',
        lines: rows.map((row) => ({
          sizeId: row.sizeId,
          qty: row.received === '' ? row.available : Number(row.received),
        })),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de la confirmation.');
    } finally {
      setBusy(false);
    }
  }

  const hasGap = rows.some(
    (row) => row.received !== '' && Number(row.received) !== row.available,
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Confirmation de réception — lot {lot.code}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="caption" color="text.secondary">
            Quantités disponibles pour transfert. Laissez vide pour confirmer
            la quantité complète, ou saisissez la quantité réellement reçue.
          </Typography>
          {rows.map((row) => (
            <Stack key={row.sizeId} direction="row" spacing={2} alignItems="center">
              <Typography sx={{ width: 100 }}>{row.sizeNom}</Typography>
              <Typography variant="caption" sx={{ width: 140 }}>
                Disponible : {row.available}
              </Typography>
              <TextField
                size="small"
                type="number"
                label="Reçu"
                value={row.received}
                onChange={(event) =>
                  setRows((prev) =>
                    prev.map((line) =>
                      line.sizeId === row.sizeId
                        ? { ...line, received: event.target.value }
                        : line,
                    ),
                  )
                }
                sx={{ width: 120 }}
              />
            </Stack>
          ))}
          {hasGap ? (
            <Alert severity="warning">
              Un écart sera enregistré avec son motif (pièces manquantes ou
              retournées — une pièce retournée n&apos;est pas comptée comme
              nouvelle production).
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
        <Button
          variant="contained"
          disabled={busy || rows.length === 0}
          onClick={() => void submit()}
        >
          Confirmer la réception
        </Button>
      </DialogActions>
    </Dialog>
  );
}
