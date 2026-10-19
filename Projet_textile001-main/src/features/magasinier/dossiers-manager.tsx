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
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { MgDossierDTO, MgOrderDTO } from '@/types/magasinier';
import { sendMagasinier, useMagasinierData } from './use-magasinier';

/**
 * Vérification de la préparation puis dossier de sortie soumis au
 * Chef Sécurité. Les écarts sont calculés côté serveur ; la soumission
 * ne signifie pas que les cartons ont quitté l'usine.
 */

const ORDER_STATUS: Record<string, string> = {
  en_preparation: 'En préparation',
  partielle: 'Partielle',
  complete: 'Complète',
  soumis: 'Soumise à sécurité',
  retour: 'Retournée',
  anomalie: 'Anomalie',
};

const DOSSIER_STATUS: Record<string, 'info' | 'warning' | 'default'> = {
  soumis: 'info',
  retour: 'warning',
  annule: 'default',
};

function DossierCard({ dossier }: { dossier: MgDossierDTO }) {
  return (
    <Paper variant="outlined" className="p-3">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Typography variant="body1">{dossier.code}</Typography>
          <Chip
            size="small"
            color={DOSSIER_STATUS[dossier.status] ?? 'default'}
            label={dossier.status}
          />
          <Chip size="small" variant="outlined" label={`Version ${dossier.version}`} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Commande {dossier.orderCode}
          {dossier.externalOrderNo ? ` (réf. ${dossier.externalOrderNo})` : ''} — soumis
          par {dossier.submittedByName ?? '?'} le {dossier.submittedAt}
        </Typography>
        <Typography variant="body2">
          Cartons :{' '}
          {dossier.cartons.length === 0
            ? '—'
            : dossier.cartons
                .map((carton) => `${carton.code} (${carton.totalQty} p.)`)
                .join(', ')}
        </Typography>
        {dossier.checks[0] ? (
          <Alert severity={dossier.checks[0].result === 'conforme' ? 'success' : 'warning'}>
            Dernière vérification : {dossier.checks[0].result} —{' '}
            {dossier.checks[0].gaps ?? 'aucun écart'}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function DossiersManager() {
  const { data: dossiers, loading, error, refresh } = useMagasinierData<MgDossierDTO[]>(
    '/api/magasinier/dossiers',
  );
  const { data: orders } = useMagasinierData<MgOrderDTO[]>('/api/magasinier/orders');
  const [verifyOrder, setVerifyOrder] = useState<MgOrderDTO | null>(null);
  const [submitOrder, setSubmitOrder] = useState<MgOrderDTO | null>(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const submittable = (orders ?? []).filter((order) =>
    ['partielle', 'complete'].includes(order.status),
  );
  const verifiable = (orders ?? []).filter((order) =>
    ['en_preparation', 'partielle', 'complete'].includes(order.status),
  );

  const runAction = async (
    action: 'verify' | 'submit',
    order: MgOrderDTO,
    onDone: (text: string) => void,
  ) => {
    setActionError(null);
    try {
      const result = await sendMagasinier('/api/magasinier/dossiers', {
        action,
        orderId: order.id,
        notes,
      });
      if (action === 'verify') {
        const check = result.item as { result?: string; gaps?: string[] } | undefined;
        onDone(
          `Vérification : ${check?.result ?? '?'}${
            check?.gaps?.length ? ` — ${check.gaps.join(' | ')}` : ' — aucun écart'
          }`,
        );
      } else {
        onDone('Dossier de sortie soumis au Chef Sécurité.');
      }
      setNotes('');
      void refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Stack spacing={2}>
          <Typography variant="subtitle1">Vérification des préparations</Typography>
          {verifiable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune préparation à vérifier.
            </Typography>
          ) : (
            verifiable.map((order) => (
              <Stack
                key={order.id}
                direction="row"
                spacing={1}
                alignItems="center"
                useFlexGap
              >
                <Typography variant="body2">
                  {order.code} — {ORDER_STATUS[order.status] ?? order.status} —{' '}
                  {order.lines.reduce((sum, line) => sum + line.qtyOrdered, 0)} p.
                  commandées, {order.lines.reduce((sum, line) => sum + line.qtyPrepared, 0)}{' '}
                  p. préparées
                </Typography>
                <Button size="small" onClick={() => setVerifyOrder(order)}>
                  Vérifier
                </Button>
              </Stack>
            ))
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" className="p-3">
        <Stack spacing={2}>
          <Typography variant="subtitle1">Soumission au Chef Sécurité</Typography>
          {submittable.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune commande prête à être soumise (vérification préalable exigée).
            </Typography>
          ) : (
            submittable.map((order) => (
              <Stack
                key={order.id}
                direction="row"
                spacing={1}
                alignItems="center"
                useFlexGap
              >
                <Typography variant="body2">
                  {order.code} — {ORDER_STATUS[order.status] ?? order.status}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => setSubmitOrder(order)}
                >
                  Soumettre le dossier
                </Button>
              </Stack>
            ))
          )}
          <Alert severity="info">
            La transmission ne signifie pas que les cartons ont quitté l’usine : le
            comptage indépendant relève du Chef Sécurité.
          </Alert>
        </Stack>
      </Paper>

      <Typography variant="subtitle1">
        Dossiers de sortie ({dossiers?.length ?? 0})
      </Typography>
      {(dossiers?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun dossier soumis.
        </Typography>
      ) : (
        dossiers?.map((dossier) => <DossierCard key={dossier.id} dossier={dossier} />)
      )}

      {verifyOrder ? (
        <Dialog open onClose={() => setVerifyOrder(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Vérifier la préparation — {verifyOrder.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Observations (facultatives)"
                size="small"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setVerifyOrder(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await runAction('verify', verifyOrder, (text) => {
                  setMessage(text);
                  setVerifyOrder(null);
                });
              }}
            >
              Vérifier
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {submitOrder ? (
        <Dialog open onClose={() => setSubmitOrder(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Soumettre le dossier — {submitOrder.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Réserves / notes (facultatives)"
                size="small"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSubmitOrder(null)}>Retour</Button>
            <Button
              variant="contained"
              onClick={async () => {
                await runAction('submit', submitOrder, (text) => {
                  setMessage(text);
                  setSubmitOrder(null);
                });
              }}
            >
              Soumettre
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
