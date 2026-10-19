'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { MgOrderDTO, MgReservationDTO } from '@/types/magasinier';
import { sendMagasinier, useMagasinierData } from './use-magasinier';

/**
 * Préparation sur stock réel : pour chaque ligne, les cartons
 * clôturés disponibles et leur reste réservable. Les réservations
 * sont atomiques et traçables ; la libération exige un motif.
 */

interface ReservationsPayload {
  items: MgReservationDTO[];
}

interface PrepOrderPayload {
  item: MgOrderDTO;
}

const ORDER_STATUS: Record<string, string> = {
  valide: 'Validée',
  en_preparation: 'En préparation',
  partielle: 'Partielle',
  complete: 'Complète',
  soumis: 'Soumise',
  retour: 'Retournée',
  anomalie: 'Anomalie',
};

export default function PreparationsManager() {
  const { data, loading, error, refresh } = useMagasinierData<ReservationsPayload>(
    '/api/magasinier/preparations',
  );
  const { data: ordersData } = useMagasinierData<MgOrderDTO[]>('/api/magasinier/orders');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [cartonChoice, setCartonChoice] = useState<Record<number, string>>({});
  const [qtyChoice, setQtyChoice] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const preperableOrders = (ordersData ?? []).filter((order) =>
    ['valide', 'en_preparation', 'partielle'].includes(order.status),
  );
  const [prepOrder, setPrepOrder] = useState<PrepOrderPayload['item'] | null>(null);

  const loadPreparation = async (orderId: string) => {
    setSelectedOrderId(orderId);
    if (!orderId) {
      setPrepOrder(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/magasinier/preparations?orderId=${orderId}`,
        { cache: 'no-store' },
      );
      const body = (await response.json()) as PrepOrderPayload & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Erreur de chargement.');
      setPrepOrder(body.item);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  const reservations = data?.items ?? [];
  const activeReservations = reservations.filter((r) => r.status === 'active');

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Stack spacing={2}>
          <Typography variant="subtitle1">Préparer une commande validée</Typography>
          <TextField
            select
            label="Commande"
            size="small"
            value={selectedOrderId}
            onChange={(event) => void loadPreparation(event.target.value)}
          >
            {preperableOrders.map((order) => (
              <MenuItem key={order.id} value={String(order.id)}>
                {order.code} — {ORDER_STATUS[order.status] ?? order.status}
                {order.externalOrderNo ? ` (réf. ${order.externalOrderNo})` : ''}
              </MenuItem>
            ))}
          </TextField>
          {prepOrder ? (
            <Stack spacing={2}>
              {prepOrder.lines.map((line) => (
                <Paper key={line.id} variant="outlined" className="p-2">
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      {line.productNom ?? 'Produit non associé'}
                      {line.colorNom ? ` — ${line.colorNom}` : ''} — taille{' '}
                      {line.sizeNom ?? '?'} : commandé {line.qtyOrdered}, préparé{' '}
                      {line.qtyPrepared}, reste{' '}
                      {Math.max(0, line.qtyOrdered - line.qtyPrepared)}
                    </Typography>
                    {line.qtyOrdered - line.qtyPrepared > 0 &&
                    'reservableCartons' in line &&
                    Array.isArray(line.reservableCartons) &&
                    (line.reservableCartons as unknown[]).length > 0 ? (
                      <Stack direction="row" spacing={1} useFlexGap alignItems="center">
                        <TextField
                          select
                          label="Carton"
                          size="small"
                          value={cartonChoice[line.id] ?? ''}
                          onChange={(event) =>
                            setCartonChoice((prev) => ({
                              ...prev,
                              [line.id]: event.target.value,
                            }))
                          }
                        >
                          {(
                            line.reservableCartons as Array<{
                              cartonId: number;
                              cartonCode: string;
                              lotCode: string;
                              reservableQty: number;
                            }>
                          ).map((carton) => (
                            <MenuItem key={carton.cartonId} value={String(carton.cartonId)}>
                              {carton.cartonCode} — lot {carton.lotCode} —{' '}
                              {carton.reservableQty} dispo.
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          label="Quantité"
                          size="small"
                          type="number"
                          value={qtyChoice[line.id] ?? ''}
                          onChange={(event) =>
                            setQtyChoice((prev) => ({
                              ...prev,
                              [line.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          size="small"
                          variant="contained"
                          onClick={async () => {
                            setActionError(null);
                            try {
                              await sendMagasinier('/api/magasinier/preparations', {
                                orderId: prepOrder.id,
                                items: [
                                  {
                                    lineId: line.id,
                                    cartonId: Number(cartonChoice[line.id]),
                                    qty: qtyChoice[line.id],
                                  },
                                ],
                              });
                              setMessage('Réservation enregistrée.');
                              setQtyChoice((prev) => ({ ...prev, [line.id]: '' }));
                              await loadPreparation(String(prepOrder.id));
                              void refresh();
                            } catch (cause) {
                              setActionError(
                                cause instanceof Error ? cause.message : 'Erreur.',
                              );
                            }
                          }}
                          disabled={!cartonChoice[line.id] || !qtyChoice[line.id]}
                        >
                          Réserver
                        </Button>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Aucun carton disponible pour cette ligne (ou quantité
                        déjà préparée).
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <Typography variant="subtitle1">
        Réservations actives ({activeReservations.length})
      </Typography>
      {activeReservations.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune réservation active.
        </Typography>
      ) : (
        activeReservations.map((reservation) => (
          <Paper key={reservation.id} variant="outlined" className="p-2">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body2">
                {reservation.code} — commande {reservation.orderCode} — carton{' '}
                {reservation.cartonCode} — lot {reservation.lotCode} — taille{' '}
                {reservation.sizeLabel} — {reservation.qty} pièce(s)
              </Typography>
              <Button
                size="small"
                color="error"
                onClick={async () => {
                  const reason = window.prompt(
                    'Motif de la libération (obligatoire) :',
                  );
                  if (!reason?.trim()) return;
                  try {
                    await sendMagasinier('/api/magasinier/preparations', {
                      action: 'release',
                      reservationId: reservation.id,
                      reason,
                    });
                    setMessage(`Réservation ${reservation.code} libérée.`);
                    void refresh();
                    if (selectedOrderId) await loadPreparation(selectedOrderId);
                  } catch (cause) {
                    setActionError(cause instanceof Error ? cause.message : 'Erreur.');
                  }
                }}
              >
                Libérer
              </Button>
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}
