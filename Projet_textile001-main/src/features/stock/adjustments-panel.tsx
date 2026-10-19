'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { StAdjustmentDTO } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Ajustements d'inventaire soumis à seconde validation : seul un
 * AUTRE chef_stock peut approuver ou refuser (l'auteur ne peut pas
 * décider — contrôle serveur). L'application crée un mouvement
 * correctif traçable.
 */

interface AdjustmentsPayload {
  items: StAdjustmentDTO[];
}

export default function AdjustmentsPanel() {
  const { data, loading, error, refresh } = useStockData<AdjustmentsPayload>(
    '/api/stock/adjustments',
  );
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (adjustment: StAdjustmentDTO, decision: 'approve' | 'refuse') => {
    setActionError(null);
    try {
      await sendStock('/api/stock/adjustments', {
        adjustmentId: adjustment.id,
        decision,
        note: notes[adjustment.id] ?? '',
      });
      setMessage(
        decision === 'approve'
          ? `Ajustement ${adjustment.code} approuvé : mouvement correctif créé.`
          : `Ajustement ${adjustment.code} refusé : le stock reste inchangé.`,
      );
      void refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  const pending = data?.items.filter((item) => item.status === 'en_attente') ?? [];
  const decided = data?.items.filter((item) => item.status !== 'en_attente') ?? [];

  return (
    <Stack spacing={2}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">
        Ajustements en attente de seconde validation
      </Typography>
      {pending.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun ajustement en attente.
        </Typography>
      ) : (
        pending.map((adjustment) => (
          <Paper key={adjustment.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {adjustment.code} — carton {adjustment.cartonCode} — lot{' '}
                  {adjustment.lotCode} — {adjustment.sizeLabel}
                </Typography>
                <Chip
                  size="small"
                  color={adjustment.deltaQty > 0 ? 'success' : 'error'}
                  label={`${adjustment.deltaQty > 0 ? '+' : ''}${adjustment.deltaQty} pièce(s)`}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Inventaire {adjustment.inventoryCode} — soumis par{' '}
                {adjustment.requestedByName ?? '—'} — motif : {adjustment.reason}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap>
                <TextField
                  label="Commentaire de décision"
                  size="small"
                  value={notes[adjustment.id] ?? ''}
                  onChange={(event) =>
                    setNotes((prev) => ({
                      ...prev,
                      [adjustment.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  variant="contained"
                  color="success"
                  onClick={() => void decide(adjustment, 'approve')}
                >
                  Approuver
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  onClick={() => void decide(adjustment, 'refuse')}
                >
                  Refuser
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Ajustements traités</Typography>
      {decided.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun ajustement traité.
        </Typography>
      ) : (
        decided.map((adjustment) => (
          <Typography key={adjustment.id} variant="body2" color="text.secondary">
            {adjustment.code} — {adjustment.status === 'approuve' ? 'Approuvé' : 'Refusé'}{' '}
            par {adjustment.decidedByName ?? '—'} — {adjustment.deltaQty > 0 ? '+' : ''}
            {adjustment.deltaQty} — inventaire {adjustment.inventoryCode}
          </Typography>
        ))
      )}
    </Stack>
  );
}
