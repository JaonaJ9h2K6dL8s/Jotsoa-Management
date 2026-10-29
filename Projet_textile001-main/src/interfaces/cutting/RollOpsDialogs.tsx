'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import {
  atelierAction,
  type MovementDTO,
  type RollDetailDTO,
} from './api';

/**
 * Étape 13 — opérations d'exploitation sur un rouleau :
 * - correction de stock (longueur et/ou poids restant) avec motif
 *   OBLIGATOIRE : chaque correction crée un mouvement historisé
 *   (utilisateur, date) — jamais de modification silencieuse ;
 * - changement d'état (bloquer / défectueux / débloquer) avec motif ;
 * - historique complet des mouvements.
 */

export type RollOpsMode = 'adjust' | 'status' | 'history' | null;

interface RollOpsDialogsProps {
  mode: RollOpsMode;
  statusTarget?: 'bloque' | 'defectueux' | 'disponible';
  roll: RollDetailDTO | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
  onError: (message: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  disponible: 'disponible', en_utilisation: 'en utilisation',
  epuise: 'épuisé', bloque: 'bloqué', defectueux: 'défectueux',
};

const TYPE_LABEL: Record<string, string> = {
  creation: 'Création', affectation: 'Affectation',
  consommation: 'Consommation', correction_poids: 'Correction',
  blocage: 'Blocage', deblocage: 'Déblocage', statut: 'État',
};

export default function RollOpsDialogs(props: RollOpsDialogsProps) {
  const { mode, statusTarget, roll, onClose, onChanged, onToast, onError } = props;
  const [reason, setReason] = useState('');
  const [remainingM, setRemainingM] = useState('');
  const [remainingKg, setRemainingKg] = useState('');
  const [movements, setMovements] = useState<MovementDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason('');
    setRemainingM('');
    setRemainingKg('');
    setMovements(null);
    if (mode === 'adjust' && roll) {
      if (roll.remainingM !== null) setRemainingM(String(roll.remainingM));
      if (roll.remainingWeightKg !== null) setRemainingKg(String(roll.remainingWeightKg));
    }
    if (mode === 'history' && roll) {
      atelierAction<{ movements: MovementDTO[] }>('roll.movements', { rollId: roll.id })
        .then((result) => setMovements(result.movements))
        .catch((error) => onError(error instanceof Error ? error.message : 'Erreur.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roll?.id]);

  const submitAdjust = async () => {
    if (!roll) return;
    setBusy(true);
    try {
      await atelierAction<never>('roll.adjust', {
        rollId: roll.id, reason,
        newRemainingM: remainingM === '' ? undefined : Number(remainingM),
        newRemainingKg: remainingKg === '' ? undefined : Number(remainingKg),
      });
      onToast(`Rouleau ${roll.code} corrigé.`);
      await onChanged();
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Erreur de correction.');
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async () => {
    if (!roll || !statusTarget) return;
    setBusy(true);
    try {
      await atelierAction<never>('roll.status', {
        rollId: roll.id, status: statusTarget, reason,
      });
      onToast(`Rouleau ${roll.code} : état « ${STATUS_LABEL[statusTarget]} ».`);
      await onChanged();
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Erreur de changement d’état.');
    } finally {
      setBusy(false);
    }
  };

  if (!roll || mode === null) return null;

  if (mode === 'history') {
    return (
      <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Mouvements — {roll.code}</DialogTitle>
        <DialogContent>
          {movements === null && <Box>Chargement…</Box>}
          {movements !== null && movements.length === 0 && (
            <Box>Aucun mouvement enregistré.</Box>
          )}
          {movements !== null && movements.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell><TableCell>Type</TableCell>
                  <TableCell>Quantité</TableCell><TableCell>Motif</TableCell>
                  <TableCell>Utilisateur</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>{movement.createdAt}</TableCell>
                    <TableCell>{TYPE_LABEL[movement.movementType] ?? movement.movementType}</TableCell>
                    <TableCell>
                      {movement.qty !== null
                        ? `${movement.qty} ${movement.unit ?? ''}` : '—'}
                    </TableCell>
                    <TableCell>{movement.reason ?? '—'}</TableCell>
                    <TableCell>{movement.username}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Fermer</Button>
        </DialogActions>
      </Dialog>
    );
  }

  const isStatus = mode === 'status';
  const title = isStatus
    ? `Changer l’état — ${roll.code} (${STATUS_LABEL[roll.status] ?? roll.status})`
    : `Corriger le stock — ${roll.code}`;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
        {isStatus ? (
          <Alert severity="warning" sx={{ py: 0.5 }}>
            État cible : « {STATUS_LABEL[statusTarget ?? 'disponible']} ». Un rouleau
            bloqué ou défectueux ne peut plus être affecté à une nouvelle coupe.
          </Alert>
        ) : (
          <>
            <Alert severity="info" sx={{ py: 0.5 }}>
              État actuel : {STATUS_LABEL[roll.status] ?? roll.status} ·
              {' '}poids restant : {roll.remainingWeightKg ?? 'inconnu'} kg ·
              {' '}longueur restante (fiche) : {roll.remainingM ?? 'inconnue'} m.
              Toute correction est historisée avec son motif.
            </Alert>
            <TextField label="Longueur restante (m)" value={remainingM}
              onChange={(event) => setRemainingM(event.target.value)} />
            <TextField label="Poids restant (kg)" value={remainingKg}
              onChange={(event) => setRemainingKg(event.target.value)} />
          </>
        )}
        <TextField label="Motif (obligatoire)" value={reason} multiline minRows={2}
          onChange={(event) => setReason(event.target.value)} />
        {roll.alerts.map((alert) => (
          <Chip key={alert.code} color="warning" size="small" label={alert.message} />
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" disabled={busy || reason.trim() === ''}
          onClick={() => { void (isStatus ? submitStatus() : submitAdjust()); }}>
          Confirmer
        </Button>
      </DialogActions>
    </Dialog>
  );
}
