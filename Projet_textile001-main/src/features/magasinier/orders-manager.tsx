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
import type {
  MgCatalogueDTO,
  MgOrderDTO,
} from '@/types/magasinier';
import { sendMagasinier, useMagasinierData } from './use-magasinier';
import ProductSelect from '@/components/common/product-select';

/**
 * Commandes importées : correspondance manuelle au catalogue,
 * validation (exige toutes les lignes reconnues) et annulation
 * contrôlée. Les doublons bloquent la validation.
 */

const STATUS_LABELS: Record<string, string> = {
  a_verifier: 'À vérifier',
  valide: 'Validée',
  en_preparation: 'En préparation',
  partielle: 'Partielle',
  complete: 'Complète',
  anomalie: 'Anomalie',
  soumis: 'Soumise à sécurité',
  retour: 'Retournée',
  annule: 'Annulée',
};

const STATUS_COLORS: Record<string, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  a_verifier: 'warning',
  valide: 'info',
  anomalie: 'error',
  soumis: 'success',
  retour: 'error',
  annule: 'default',
};

interface CataloguePayload {
  item: MgCatalogueDTO;
}

function MatchDialog({
  line,
  catalogue,
  onClose,
  onDone,
}: {
  line: MgOrderDTO['lines'][number];
  catalogue: MgCatalogueDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [productId, setProductId] = useState('');
  const [colorId, setColorId] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Associer la ligne au catalogue</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            Ligne extraite : {line.rawText ?? '—'} — quantité {line.qtyOrdered}
          </Typography>
          <ProductSelect
            label="Produit"
            value={productId}
            onChange={(id) => setProductId(id)}
          />
          <TextField
            select
            label="Couleur (facultative)"
            size="small"
            value={colorId}
            onChange={(event) => setColorId(event.target.value)}
          >
            <MenuItem value="">— aucune —</MenuItem>
            {catalogue.colors.map((color) => (
              <MenuItem key={color.id} value={String(color.id)}>
                {color.nom}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Taille"
            size="small"
            value={sizeId}
            onChange={(event) => setSizeId(event.target.value)}
          >
            {catalogue.sizes.map((size) => (
              <MenuItem key={size.id} value={String(size.id)}>
                {size.nom}
              </MenuItem>
            ))}
          </TextField>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={async () => {
            try {
              await sendMagasinier('/api/magasinier/orders', {
                action: 'matchLine',
                lineId: line.id,
                productId: Number(productId),
                colorId: colorId ? Number(colorId) : null,
                sizeId: Number(sizeId),
              });
              onDone('Ligne associée au catalogue.');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
            }
          }}
          disabled={!productId || !sizeId}
        >
          Associer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function OrdersManager() {
  const { data, loading, error, refresh } = useMagasinierData<MgOrderDTO[]>(
    '/api/magasinier/orders',
  );
  const { data: catalogueData } = useMagasinierData<CataloguePayload>(
    '/api/magasinier/references',
  );
  const catalogue = catalogueData?.item;
  const [matching, setMatching] = useState<MgOrderDTO['lines'][number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const orders = data ?? [];

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      {orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune commande importée. Importez d’abord un PDF.
        </Typography>
      ) : (
        orders.map((order) => (
          <Paper key={order.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {order.code} — document {order.documentCode}
                </Typography>
                <Chip
                  size="small"
                  color={STATUS_COLORS[order.status] ?? 'default'}
                  label={STATUS_LABELS[order.status] ?? order.status}
                />
                {order.externalOrderNo ? (
                  <Chip size="small" variant="outlined" label={`Réf. ${order.externalOrderNo}`} />
                ) : null}
              </Stack>
              {order.clientName ? (
                <Typography variant="body2" color="text.secondary">
                  Client : {order.clientName}
                </Typography>
              ) : null}
              {order.duplicateWarning ? (
                <Alert severity="error">{order.duplicateWarning}</Alert>
              ) : null}
              {order.lines.map((line) => (
                <Stack key={line.id} direction="row" spacing={1} alignItems="center" useFlexGap>
                  <Typography variant="body2">
                    {line.rawText ?? 'Ligne manuelle'} —{' '}
                    {line.matchStatus === 'reconnu'
                      ? `${line.productNom ?? ''} / ${line.colorNom ?? '—'} / ${line.sizeNom ?? ''}`
                      : 'non reconnue'}{' '}
                    — qté {line.qtyOrdered}
                  </Typography>
                  <Chip
                    size="small"
                    color={line.matchStatus === 'reconnu' ? 'success' : 'warning'}
                    label={line.matchStatus === 'reconnu' ? 'Reconnue' : 'À associer'}
                  />
                  {order.status === 'a_verifier' || order.status === 'anomalie' ? (
                    <Button size="small" onClick={() => setMatching(line)}>
                      Associer
                    </Button>
                  ) : null}
                  {order.status === 'a_verifier' && line.qtyPrepared === 0 ? (
                    <Button
                      size="small"
                      color="error"
                      onClick={async () => {
                        try {
                          await sendMagasinier('/api/magasinier/orders', {
                            action: 'removeLine',
                            lineId: line.id,
                          });
                          void refresh();
                        } catch (cause) {
                          setActionError(cause instanceof Error ? cause.message : 'Erreur.');
                        }
                      }}
                    >
                      Supprimer
                    </Button>
                  ) : null}
                </Stack>
              ))}
              <Stack direction="row" spacing={1} useFlexGap>
                {order.status === 'a_verifier' || order.status === 'anomalie' ? (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={async () => {
                      try {
                        await sendMagasinier('/api/magasinier/orders', {
                          action: 'validate',
                          orderId: order.id,
                        });
                        setMessage(`Commande ${order.code} validée.`);
                        void refresh();
                      } catch (cause) {
                        setActionError(cause instanceof Error ? cause.message : 'Erreur.');
                      }
                    }}
                  >
                    Valider la commande
                  </Button>
                ) : null}
                {order.status !== 'soumis' && order.status !== 'annule' ? (
                  <Button size="small" onClick={() => setCancelOrderId(order.id)}>
                    Annuler la commande
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      {matching && catalogue ? (
        <MatchDialog
          line={matching}
          catalogue={catalogue}
          onClose={() => setMatching(null)}
          onDone={(text) => {
            setMatching(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
      {cancelOrderId !== null ? (
        <Dialog open onClose={() => setCancelOrderId(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Annuler la commande</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <Alert severity="info">
                Les réservations actives seront libérées et historisées.
              </Alert>
              <TextField
                label="Motif (obligatoire)"
                size="small"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelOrderId(null)}>Retour</Button>
            <Button
              variant="contained"
              color="error"
              disabled={!cancelReason.trim()}
              onClick={async () => {
                try {
                  await sendMagasinier('/api/magasinier/orders', {
                    action: 'cancel',
                    orderId: cancelOrderId,
                    reason: cancelReason,
                  });
                  setCancelOrderId(null);
                  setCancelReason('');
                  setMessage('Commande annulée, réservations libérées.');
                  void refresh();
                } catch (cause) {
                  setActionError(cause instanceof Error ? cause.message : 'Erreur.');
                }
              }}
            >
              Annuler la commande
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
