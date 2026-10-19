'use client';

import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { apiPost, apiPut } from '@/services/api-client';
import type { OrderRow } from '@/server/orders/orders';
import type { ReferenceOption } from '@/server/coupe/references';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';

/**
 * Création automatisée d'un lot : sélection d'une commande prête pour
 * la coupe (statut 'a_couper') — toutes les autres données sont
 * reprises de la commande. Une création de commande minimale est
 * proposée si aucune commande n'est disponible.
 */

interface SizeLine {
  sizeId: number;
  qty: string;
}

export default function LotCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (lot: LotWorkflowRow) => void;
}) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [references, setReferences] = useState<{
    products: ReferenceOption[];
    colors: ReferenceOption[];
    sizes: ReferenceOption[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [type, setType] = useState<'interne' | 'externe'>('externe');
  const [clientNom, setClientNom] = useState('');
  const [productId, setProductId] = useState('');
  const [colorId, setColorId] = useState('');
  const [lines, setLines] = useState<SizeLine[]>([]);

  const readyOrders = useMemo(
    () => (orders ?? []).filter((order) => order.status === 'a_couper'),
    [orders],
  );

  async function load() {
    setError(null);
    try {
      const [ordersBody, refsBody] = await Promise.all([
        fetch('/api/orders?status=a_couper', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        }).then((r) => r.json()),
        fetch('/api/coupe/references', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        }).then((r) => r.json()),
      ]);
      setOrders((ordersBody.items ?? []) as OrderRow[]);
      setReferences(refsBody.item ?? refsBody);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    }
  }

  async function createOrder(): Promise<OrderRow | null> {
    const filled = lines
      .map((line) => ({ sizeId: line.sizeId, qty: Number(line.qty) }))
      .filter((line) => line.sizeId > 0 && line.qty > 0);
    const body = await apiPost<{ item: OrderRow }>('/api/orders', {
      type,
      clientNom: type === 'externe' ? clientNom || null : null,
      productId: Number(productId),
      colorId: colorId ? Number(colorId) : null,
      lines: filled,
    });
    return body.item;
  }

  async function createLot(orderId: number) {
    setBusy(true);
    setError(null);
    try {
      const body = await apiPut<{ lot: LotWorkflowRow }>(
        '/api/coupe/lots/workflow',
        { orderId },
      );
      onCreated(body.lot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de la création.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFromOrder(order: OrderRow) {
    await createLot(order.id);
  }

  async function handleCreateOrderAndLot() {
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder();
      if (order) await createLot(order.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de la création.');
      setBusy(false);
    }
  }

  function reset() {
    setShowOrderForm(false);
    setClientNom('');
    setProductId('');
    setColorId('');
    setLines([]);
    setError(null);
    setOrders(null);
    setReferences(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const ready = Boolean(productId) && lines.some((l) => Number(l.qty) > 0);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="md"
      TransitionProps={{ onEnter: () => void load() }}
    >
      <DialogTitle>Créer un lot de coupe</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {showOrderForm ? (
            <>
              <Typography variant="subtitle2">Nouvelle commande</Typography>
              <Stack direction="row" spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Type</InputLabel>
                  <Select
                    label="Type"
                    value={type}
                    onChange={(event) =>
                      setType(event.target.value as 'interne' | 'externe')
                    }
                  >
                    <MenuItem value="externe">Externe (client)</MenuItem>
                    <MenuItem value="interne">Interne</MenuItem>
                  </Select>
                </FormControl>
                {type === 'externe' ? (
                  <TextField
                    size="small"
                    fullWidth
                    label="Client"
                    value={clientNom}
                    onChange={(event) => setClientNom(event.target.value)}
                  />
                ) : null}
              </Stack>
              <Stack direction="row" spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Produit</InputLabel>
                  <Select
                    label="Produit"
                    value={productId}
                    onChange={(event) => {
                      setProductId(event.target.value);
                      setLines([]);
                    }}
                  >
                    {(references?.products ?? []).map((product) => (
                      <MenuItem key={product.id} value={product.id}>
                        {product.nom}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Couleur</InputLabel>
                  <Select
                    label="Couleur"
                    value={colorId}
                    onChange={(event) => setColorId(event.target.value)}
                  >
                    {(references?.colors ?? []).map((color) => (
                      <MenuItem key={color.id} value={color.id}>
                        {color.nom}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <Typography variant="subtitle2">Quantités par taille</Typography>
              {(references?.sizes ?? []).map((size) => (
                <Stack key={size.id} direction="row" spacing={2} alignItems="center">
                  <Typography sx={{ width: 120 }}>{size.nom}</Typography>
                  <TextField
                    size="small"
                    type="number"
                    label="Quantité"
                    value={
                      lines.find((line) => line.sizeId === size.id)?.qty ?? ''
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setLines((prev) => {
                        const others = prev.filter((l) => l.sizeId !== size.id);
                        return value === ''
                          ? others
                          : [...others, { sizeId: size.id, qty: value }];
                      });
                    }}
                  />
                </Stack>
              ))}
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                Sélectionnez la commande prête pour la coupe : le lot est
                créé automatiquement avec ses données.
              </Typography>
              {orders === null ? (
                <Typography>Chargement…</Typography>
              ) : readyOrders.length === 0 ? (
                <Alert severity="info">
                  Aucune commande prête pour la coupe.
                </Alert>
              ) : (
                readyOrders.map((order) => (
                  <Stack
                    key={order.id}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Stack>
                      <Typography>
                        {order.code} — {order.productNom}
                        {order.colorNom ? ` (${order.colorNom})` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {order.type === 'externe'
                          ? `Client : ${order.clientNom ?? '—'} — `
                          : 'Interne — '}
                        {order.totalQty} pièce(s)
                      </Typography>
                    </Stack>
                    <Button
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void handleCreateFromOrder(order)}
                    >
                      Créer le lot
                    </Button>
                  </Stack>
                ))
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {showOrderForm ? (
          <>
            <Button onClick={() => setShowOrderForm(false)}>Retour</Button>
            <Button
              variant="contained"
              disabled={!ready || busy}
              onClick={() => void handleCreateOrderAndLot()}
            >
              Créer la commande et le lot
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setShowOrderForm(true)}>
              Nouvelle commande
            </Button>
            <Button onClick={handleClose}>Fermer</Button>
          </>
        )}
      </DialogActions>
      <Divider />
    </Dialog>
  );
}
