'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { CutTransferResult } from './api';

/**
 * Confirmation du transfert réel vers Couture (étape 8).
 * Les quantités coupées ne sont PAS saisies : elles sont calculées
 * automatiquement à partir du placement enregistré du plan validé
 * (par couche × nombre de couches), puis revérifiées par le serveur,
 * qui crée lot, transfert et tickets en une transaction. Le chef
 * confirme explicitement la coupe physique. Une pièce simplement
 * dessinée sur le canvas n'est jamais considérée coupée.
 */

export interface TransferRow {
  pieceId: number;
  label: string;
  placed: number;
  expected: number;
}

interface TransferDialogProps {
  open: boolean;
  planId: number;
  layers: number;
  rows: TransferRow[];
  onClose: () => void;
  onConfirm: (input: {
    planId: number;
    cutPieces: Array<{ pieceId: number; qty: number }>;
    confirmCut: true;
  }) => Promise<CutTransferResult>;
}

export default function TransferDialog(props: TransferDialogProps) {
  const { open, planId, layers, rows, onClose, onConfirm } = props;
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CutTransferResult | null>(null);

  const cutRows = rows.filter((row) => row.placed > 0);
  const declarations = cutRows.map((row) => ({
    pieceId: row.pieceId,
    qty: row.placed,
  }));
  const totalCut = cutRows.reduce((sum, row) => sum + row.placed * layers, 0);
  // Aperçu fidèle au calcul serveur (transfer.ts) : le nombre de
  // vêtements transférables est le minimum des (coupé ÷ quantité
  // requise par vêtement) sur toutes les pièces du patron complet.
  const piecesPerGarment = cutRows.reduce((sum, row) => sum + Math.max(1, row.expected), 0);
  const garments = cutRows.length > 0
    ? Math.min(...cutRows.map((row) => Math.floor((row.placed * layers) / Math.max(1, row.expected))))
    : 0;
  const surplusPieces = totalCut - garments * piecesPerGarment;

  const reset = (): void => {
    setConfirmed(false);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const transfer = await onConfirm({
        planId, cutPieces: declarations, confirmCut: true,
      });
      setResult(transfer);
    } catch (transferError) {
      setError((transferError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transférer les pièces coupées vers la Couture</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {result ? (
          <>
            <Alert severity="success">
              Transfert confirmé : lot {result.lotCode}, transfert {result.transferCode}.
              {result.fabricConsumedKg !== null
                ? ` Tissu consommé : ${result.fabricConsumedKg.toFixed(3)} kg `
                  + '(estimation sur matelas déclaré, largeur nominale).'
                : ` Consommation tissu non décomptée : `
                  + `${result.fabricKgUnavailableReason ?? 'données de conversion incertaines'}`}
            </Alert>
            <Typography variant="body2">
              Vêtements transférés : {result.transferredQty}
              ({result.garmentsPerLayer} par couche × {result.layers} couches).
              Total des pièces coupées : {' '}
              {result.cutPieces.reduce((sum, piece) => sum + piece.totalQty, 0)}.
              Ticket de transfert : {result.ticketTransfertCode}.
            </Typography>
            {result.cutPieces.map((piece) => (
              <Typography key={piece.pieceId} variant="body2">
                {piece.label} : {piece.qtyPerLayer} par couche × {piece.layers} = {piece.totalQty}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary">
              La Couture peut réceptionner le transfert {result.transferCode}.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => window.open(`/coupe/transferts/${result.transferId}`, '_blank')}
            >
              Imprimer le ticket {result.ticketNo}
            </Button>
          </>
        ) : (
          <>
            <Alert severity="info" sx={{ py: 0.5 }}>
              Les pièces coupées sont calculées automatiquement à partir du
              placement enregistré du plan validé ({layers} couche(s)).
              Le serveur vérifie que chaque quantité ne dépasse pas ce
              placement, puis crée le lot, le transfert et les tickets de
              production.
            </Alert>
            <TableContainer>
              <Table size="small" aria-label="Pièces coupées calculées automatiquement">
                <TableHead>
                  <TableRow>
                    <TableCell>Pièce</TableCell>
                    <TableCell align="right">Par couche</TableCell>
                    <TableCell align="right">Total coupé</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cutRows.map((row) => (
                    <TableRow key={row.pieceId}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell align="right">{row.placed}</TableCell>
                      <TableCell align="right">{row.placed * layers}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Total : {totalCut} pièce(s) coupée(s).
            </Typography>
            <Alert severity="success" sx={{ py: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                → {garments} vêtement(s) prêt(s) pour la Couture
              </Typography>
              <Typography variant="caption" color="text.secondary">
                1 vêtement = {piecesPerGarment} pièce(s) de patron (jeu complet),
                {layers} couche(s) incluses.
                {surplusPieces > 0
                  ? ` ${surplusPieces} pièce(s) en surplus au-delà des vêtements complets.`
                  : ' Aucune pièce en surplus.'}
              </Typography>
            </Alert>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
              )}
              label="Je confirme que les pièces listées sont physiquement coupées."
            />
            {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          {result ? 'Fermer' : 'Annuler'}
        </Button>
        {!result && (
          <Button
            variant="contained"
            disabled={busy || !confirmed || declarations.length === 0}
            onClick={submit}
          >
            Confirmer le transfert
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
