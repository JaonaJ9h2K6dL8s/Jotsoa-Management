'use client';

import { useRef, useState } from 'react';
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
import type { MgDocumentDTO, MgExtractResultDTO } from '@/types/magasinier';
import { sendMagasinier, uploadPdf, useMagasinierData } from './use-magasinier';

/**
 * Import des commandes PDF : sélection de fichiers, extraction,
 * messages explicites (OCR indisponible, doublon, illisible) et
 * rejet contrôlé avec motif.
 */

const STATUS_LABELS: Record<string, string> = {
  importe: 'Importé',
  extraction_ok: 'Extraction réussie',
  extraction_partielle: 'Extraction partielle',
  ocr_indisponible: 'OCR indisponible',
  a_verifier: 'À vérifier',
  valide: 'Validé',
  rejete: 'Rejeté',
  erreur: 'Erreur',
};

function ManualOrderDialog({
  document: doc,
  onClose,
  onDone,
}: {
  document: MgDocumentDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [clientName, setClientName] = useState('');
  const [externalOrderNo, setExternalOrderNo] = useState('');
  const [lines, setLines] = useState('Produit / Couleur / Taille / 10');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = lines
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ rawText: line, qty: Number(line.split('/').pop()) }));
      await sendMagasinier('/api/magasinier/documents', {
        action: 'manualOrder',
        documentId: doc.id,
        clientName: clientName || null,
        externalOrderNo: externalOrderNo || null,
        lines: parsed,
      });
      onDone(`Commande saisie manuellement pour le document ${doc.code}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Saisie manuelle — {doc.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Alert severity="info">
            PDF scanné ou extraction incomplète : saisissez les lignes au format
            « Produit / Couleur / Taille / Quantité », une ligne par commande.
            Les produits devront ensuite être associés au catalogue.
          </Alert>
          <TextField
            label="Numéro de commande externe (facultatif)"
            size="small"
            value={externalOrderNo}
            onChange={(event) => setExternalOrderNo(event.target.value)}
          />
          <TextField
            label="Client (facultatif)"
            size="small"
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
          />
          <TextField
            label="Lignes de commande"
            size="small"
            multiline
            minRows={3}
            value={lines}
            onChange={(event) => setLines(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Créer la commande
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ImportManager() {
  const { data, loading, error, refresh } = useMagasinierData<MgDocumentDTO[]>(
    '/api/magasinier/documents',
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualDoc, setManualDoc] = useState<MgDocumentDTO | null>(null);
  const [rejectDoc, setRejectDoc] = useState<MgDocumentDTO | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const result = (await uploadPdf('/api/magasinier/documents', file)) as {
          item: MgExtractResultDTO;
        };
        setMessage((prev) => `${prev ? prev + ' | ' : ''}${file.name} : ${result.item.message}`);
      }
      void refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const documents = data ?? [];

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Stack spacing={2}>
          <Typography variant="subtitle1">Importer des commandes PDF</Typography>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => void importFiles(event.target.files)}
          />
          {busy ? <LinearProgress /> : null}
          <Typography variant="caption" color="text.secondary">
            Limites configurables par l’administrateur (taille, pages). Les PDF
            scannés exigent une saisie manuelle : le moteur OCR n’est pas disponible.
          </Typography>
        </Stack>
      </Paper>

      {documents.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun document importé.
        </Typography>
      ) : (
        documents.map((doc) => (
          <Paper key={doc.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {doc.code} — {doc.fileName}
                </Typography>
                <Chip
                  size="small"
                  color={
                    doc.status === 'valide'
                      ? 'success'
                      : doc.status === 'rejete' || doc.status === 'erreur'
                        ? 'error'
                        : 'warning'
                  }
                  label={STATUS_LABELS[doc.status] ?? doc.status}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Importé le {doc.importedAt} par {doc.importedByName ?? '—'} —{' '}
                {doc.pageCount ?? '?'} page(s) — commande{' '}
                {doc.orderCode ?? 'aucune'}
                {doc.externalOrderNo ? ` (réf. externe ${doc.externalOrderNo})` : ''}
              </Typography>
              {doc.status === 'ocr_indisponible' ? (
                <Alert severity="warning">
                  Aucun texte extractible (PDF scanné) : saisissez la commande
                  manuellement.
                </Alert>
              ) : null}
              <Stack direction="row" spacing={1} useFlexGap>
                {doc.status !== 'valide' && doc.status !== 'rejete' && !doc.orderId ? (
                  <Button size="small" onClick={() => setManualDoc(doc)}>
                    Saisie manuelle
                  </Button>
                ) : null}
                {doc.status !== 'valide' && doc.status !== 'rejete' ? (
                  <Button size="small" color="error" onClick={() => setRejectDoc(doc)}>
                    Rejeter
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      {manualDoc ? (
        <ManualOrderDialog
          document={manualDoc}
          onClose={() => setManualDoc(null)}
          onDone={(text) => {
            setManualDoc(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
      {rejectDoc ? (
        <Dialog open onClose={() => setRejectDoc(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Rejeter {rejectDoc.code}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} className="pt-2">
              <TextField
                label="Motif du rejet (obligatoire)"
                size="small"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectDoc(null)}>Annuler</Button>
            <Button
              variant="contained"
              color="error"
              onClick={async () => {
                try {
                  await sendMagasinier('/api/magasinier/documents', {
                    action: 'reject',
                    documentId: rejectDoc.id,
                    reason: rejectReason,
                  });
                  setRejectDoc(null);
                  setRejectReason('');
                  setMessage('Document rejeté.');
                  void refresh();
                } catch (cause) {
                  setActionError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
                }
              }}
              disabled={!rejectReason.trim()}
            >
              Confirmer le rejet
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
}
