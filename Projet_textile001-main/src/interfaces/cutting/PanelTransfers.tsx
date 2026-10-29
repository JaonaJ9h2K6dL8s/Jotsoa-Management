'use client';

import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { TransferTicketListDTO } from '@/types/cutting-ticket';
import { atelierAction } from './api';

/**
 * Liste des tickets de transfert Coupe → Couture (étape 17).
 * Consultation seule : consulter, ouvrir ou imprimer un ticket ne
 * déclenche aucun transfert, aucune consommation ni réception.
 * Les transferts antérieurs au ticket numéroté sont présentés comme
 * historiques, sans données inventées.
 */

const RECEPTION_LABEL: Record<TransferTicketListDTO['receptionStatus'], string> = {
  en_attente: 'En attente',
  partielle: 'Réception partielle',
  complete: 'Réceptionné',
};

const RECEPTION_COLOR: Record<TransferTicketListDTO['receptionStatus'], 'success' | 'warning' | 'default'> = {
  en_attente: 'default',
  partielle: 'warning',
  complete: 'success',
};

export default function PanelTransfers() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TransferTicketListDTO[] | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await atelierAction<{ tickets: TransferTicketListDTO[] }>(
        'transfer.tickets', {},
      );
      setTickets(body.tickets);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => { setOpen(true); void load(); }}>
        Tickets de transfert Coupe → Couture
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Tickets de transfert Coupe → Couture</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
          <TableContainer>
            <Table size="small" aria-label="Tickets de transfert">
              <TableHead>
                <TableRow>
                  <TableCell>Numéro</TableCell>
                  <TableCell>Date d&apos;envoi</TableCell>
                  <TableCell>Lot</TableCell>
                  <TableCell>Produit</TableCell>
                  <TableCell>Taille</TableCell>
                  <TableCell>Lignes</TableCell>
                  <TableCell align="right">Qté envoyée</TableCell>
                  <TableCell>Émetteur</TableCell>
                  <TableCell>Réception</TableCell>
                  <TableCell>Ticket</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(tickets ?? []).map((ticket) => (
                  <TableRow key={ticket.transferId}>
                    <TableCell>{ticket.ticketNo ?? '—'}</TableCell>
                    <TableCell>{ticket.confirmedAt}</TableCell>
                    <TableCell>{ticket.lotCode}</TableCell>
                    <TableCell>{ticket.productName ?? 'Non renseigné'}</TableCell>
                    <TableCell>{ticket.sizeLabel ?? 'Non renseigné'}</TableCell>
                    <TableCell align="right">{ticket.pieceRows}</TableCell>
                    <TableCell align="right">{ticket.qtySent}</TableCell>
                    <TableCell>
                      {ticket.emitterName}
                      {ticket.emitterRole ? ` (${ticket.emitterRole})` : ''}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={RECEPTION_COLOR[ticket.receptionStatus]}
                        label={RECEPTION_LABEL[ticket.receptionStatus]}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => window.open(`/coupe/transferts/${ticket.transferId}`, '_blank')}
                      >
                        Imprimer
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {tickets !== null && tickets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10}>
                      Aucun transfert enregistré.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {tickets?.some((ticket) => ticket.ticketNo === null) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              « — » : transfert historique antérieur au ticket numéroté ;
              les informations manquantes ne sont pas inventées.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { void load(); }} disabled={busy}>Rafraîchir</Button>
          <Button onClick={() => setOpen(false)}>Fermer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
