'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PrintIcon from '@mui/icons-material/Print';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { useCallback, useEffect, useState } from 'react';
import { downloadTicketPdf, printTicketPdf } from './ticket-pdf';
import type { TicketDetail } from '@/server/coupe/tickets';

/**
 * Écran des tickets de production (cahier §20) : génération, recherche
 * par code (scan QR), impression / PDF thermique ou A4, réimpression
 * avec DUPLICATA et annulation — tout passe par l'API locale.
 */

const TYPE_LABEL: Record<string, string> = {
  coupe: 'Coupe',
  transfert: 'Transfert couture',
  suivi: 'Suivi',
};

export default function TicketsManager() {
  const [tickets, setTickets] = useState<TicketDetail[]>([]);
  const [lots, setLots] = useState<Array<{ id: number; code: string; productNom: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchCode, setSearchCode] = useState('');
  const [type, setType] = useState('coupe');
  const [lotId, setLotId] = useState('');
  const [refOperation, setRefOperation] = useState('');
  const [observations, setObservations] = useState('');

  const reload = useCallback(
    async (code?: string) => {
      try {
        const query = code ? `?code=${encodeURIComponent(code)}` : '';
        const response = await fetch(`/api/coupe/tickets${query}`, { cache: 'no-store' });
        const body = (await response.json()) as {
          status: string;
          items?: TicketDetail[];
          message?: string;
        };
        if (!response.ok) throw new Error(body.message ?? 'Erreur.');
        setTickets(body.items ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Erreur réseau.');
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/coupe/lots', { cache: 'no-store' });
        const body = (await response.json()) as {
          status: string;
          items?: Array<{ id: number; code: string; productNom: string }>;
        };
        if (response.ok && body.items) setLots(body.items);
      } catch {
        // Facultatif : les tickets peuvent exister sans lot.
      }
    })();
    void reload();
  }, [reload]);

  const generate = async () => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/coupe/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          lotId: lotId || null,
          refOperation: refOperation || null,
          observations: observations || null,
        }),
      });
      const body = (await response.json()) as {
        status: string;
        item?: TicketDetail;
        message?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.message ?? 'Erreur.');
      }
      setSuccess(`Ticket ${body.item.code} généré.`);
      setObservations('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  };

  const action = async (ticket: TicketDetail, kind: 'reprint' | 'cancel') => {
    setError(null);
    try {
      const response = await fetch(`/api/coupe/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind, reason: kind === 'cancel' ? 'Annulé depuis l’écran tickets.' : null }),
      });
      const body = (await response.json()) as { status: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Erreur.');
      setSuccess(
        kind === 'reprint'
          ? `Ticket ${ticket.code} réimprimé (DUPLICATA).`
          : `Ticket ${ticket.code} annulé.`,
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  };

  return (
    <Stack spacing={2}>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert severity="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      ) : null}

      <Typography variant="h6">Tickets de production (QR code)</Typography>

      {/* Génération */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Type de ticket"
            value={type}
            onChange={(e) => setType(e.target.value)}
            sx={{ width: 200 }}
          >
            <MenuItem value="coupe">Ticket de coupe</MenuItem>
            <MenuItem value="transfert">Transfert vers la couture</MenuItem>
            <MenuItem value="suivi">Suivi de production</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Lot de coupe"
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            sx={{ width: 240 }}
          >
            <MenuItem value="">— aucun —</MenuItem>
            {lots.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.code} — {l.productNom}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Référence opération"
            value={refOperation}
            onChange={(e) => setRefOperation(e.target.value)}
            sx={{ width: 200 }}
          />
          <TextField
            size="small"
            label="Observations"
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            sx={{ width: 220 }}
          />
          <Button variant="contained" onClick={generate}>
            Générer le ticket
          </Button>
        </Box>
      </Paper>

      {/* Recherche / scan */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
          <QrCode2Icon sx={{ color: '#1b7d5f' }} />
          <TextField
            size="small"
            label="Scanner ou saisir le code du ticket (ex. TICK-000001)"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            sx={{ flex: 1, minWidth: 260 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void reload(searchCode.trim() || undefined);
              }
            }}
          />
          <Button variant="outlined" onClick={() => reload(searchCode.trim() || undefined)}>
            Consulter
          </Button>
          {searchCode ? (
            <Button onClick={() => { setSearchCode(''); void reload(); }}>Tout afficher</Button>
          ) : null}
        </Box>
      </Paper>

      {/* Liste */}
      {tickets.map((ticket) => (
        <Paper key={ticket.id} variant="outlined" sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 700 }}>{ticket.code}</Typography>
            <Chip size="small" label={TYPE_LABEL[ticket.type] ?? ticket.type} color="primary" />
            {ticket.status === 'annule' ? (
              <Chip size="small" label="Annulé" color="error" />
            ) : null}
            {ticket.reprintCount > 0 ? (
              <Chip size="small" label={`${ticket.reprintCount} réimpression(s)`} variant="outlined" />
            ) : null}
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              startIcon={<PrintIcon />}
              onClick={() => printTicketPdf(ticket, 'thermique')}
            >
              Thermique
            </Button>
            <Button
              size="small"
              startIcon={<PrintIcon />}
              onClick={() => printTicketPdf(ticket, 'a4')}
            >
              A4
            </Button>
            <Button
              size="small"
              onClick={() => downloadTicketPdf(ticket, 'a4')}
            >
              PDF
            </Button>
            {ticket.status === 'actif' ? (
              <Button size="small" onClick={() => action(ticket, 'reprint')}>
                Réimprimer
              </Button>
            ) : null}
            {ticket.status === 'actif' ? (
              <Button
                size="small"
                color="error"
                onClick={() => action(ticket, 'cancel')}
              >
                Annuler
              </Button>
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1 }}>
            {ticket.qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ticket.qrDataUrl}
                alt={`QR code du ticket ${ticket.code}`}
                width={92}
                height={92}
              />
            ) : null}
            <Box>
              <Typography variant="caption" display="block">
                Lot : {ticket.lotCode ?? '—'} · Réf. opération : {ticket.refOperation ?? '—'}
              </Typography>
              <Typography variant="caption" display="block">
                Créé le {ticket.createdAt} par {ticket.createdByName ?? '—'} · Statut : {ticket.status}
              </Typography>
              {ticket.observations ? (
                <Typography variant="caption" display="block" color="text.secondary">
                  {ticket.observations}
                </Typography>
              ) : null}
            </Box>
          </Box>
        </Paper>
      ))}
      {tickets.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Aucun ticket. Générez un ticket de coupe ou de transfert, ou scannez un code.
          </Typography>
        </Paper>
      ) : null}
    </Stack>
  );
}
