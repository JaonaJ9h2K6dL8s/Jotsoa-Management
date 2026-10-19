'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  downloadFichePdf,
  ficheFileName,
  printFichePdf,
} from './fiche-pdf';
import {
  downloadPlacementPdf,
  downloadPlacementPng,
} from './plan-placement';
import FicheFormDialog from './fiche-form';
import type { FicheDetail } from '@/server/coupe/fiches';

/**
 * Écran des fiches techniques (cahier §3/§21) : liste, validation,
 * aperçu, impression, téléchargement PDF et historique des versions —
 * toutes les valeurs viennent de la base via l'API locale.
 */

interface ProductOption {
  id: number;
  nom: string;
  category: string;
}

const STATUT_CHIP: Record<string, { label: string; color: 'default' | 'warning' | 'success' }> = {
  brouillon: { label: 'Brouillon', color: 'default' },
  a_verifier: { label: 'À vérifier', color: 'warning' },
  valide: { label: 'Validé', color: 'success' },
  archive: { label: 'Archivé', color: 'default' },
};

export default function FichesManager() {
  const [fiches, setFiches] = useState<FicheDetail[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<FicheDetail | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [openVersions, setOpenVersions] = useState<FicheDetail | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/coupe/fiches', { cache: 'no-store' });
      const body = (await response.json()) as { status: string; items?: FicheDetail[] };
      if (response.ok) setFiches(body.items ?? []);
    } catch {
      setError('Erreur réseau.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/coupe/patterns', { cache: 'no-store' });
        const body = (await response.json()) as {
          status: string;
          products?: Array<ProductOption & { patternCount: number }>;
        };
        if (response.ok && body.products) {
          setProducts(
            body.products.map((p) => ({ id: p.id, nom: p.nom, category: p.category })),
          );
        }
      } catch {
        setError('Impossible de charger les produits.');
      }
    })();
    void reload();
  }, [reload]);

  const validate = async (fiche: FicheDetail) => {
    setError(null);
    try {
      const response = await fetch(`/api/coupe/fiches/${fiche.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { status: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Erreur.');
      setSuccess('Fiche validée.');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  };

  const versions = useMemo(() => openVersions?.versions ?? [], [openVersions]);

  const downloadPlacement = async (fiche: FicheDetail, mode: 'pdf' | 'png') => {
    setError(null);
    setSuccess(null);
    try {
      const { fetchPlacementPlan } = await import('./fiche-pdf');
      const plan = await fetchPlacementPlan(fiche);
      if (!plan || !plan.result || plan.result.placements.length === 0) {
        setError(
          'Plan de placement non disponible — générez puis validez un plan de coupe dans le module Marker avant de télécharger.',
        );
        return;
      }
      if (mode === 'pdf') downloadPlacementPdf(plan);
      else downloadPlacementPng(plan);
      setSuccess('Plan de placement téléchargé.');
    } catch {
      setError('Erreur lors du téléchargement du plan de placement.');
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Fiches techniques des produits</Typography>
        <Button
          variant="contained"
          onClick={() => {
            setEditing(null);
            setOpenForm(true);
          }}
        >
          Nouvelle fiche
        </Button>
      </Box>

      {fiches.map((fiche) => {
        const chip = STATUT_CHIP[fiche.statut] ?? STATUT_CHIP.brouillon;
        return (
          <Paper key={fiche.id} variant="outlined" sx={{ p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700 }}>
                {fiche.productNom} — {fiche.sizeNom ?? 'toutes tailles'}
              </Typography>
              <Chip size="small" label={chip.label} color={chip.color} />
              <Chip
                size="small"
                label={`V${String(fiche.version).padStart(2, '0')}`}
                variant="outlined"
              />
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                startIcon={<VisibilityIcon />}
                onClick={() => setOpenVersions(fiche)}
              >
                Versions ({fiche.versions.length})
              </Button>
              <Button
                size="small"
                startIcon={<PrintIcon />}
                onClick={() => printFichePdf(fiche)}
              >
                Imprimer
              </Button>
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => downloadFichePdf(fiche)}
                title={ficheFileName(fiche)}
              >
                PDF
              </Button>
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => void downloadPlacement(fiche, 'pdf')}
                title="Télécharger le plan de placement PDF (§22.E)"
              >
                Plan PDF
              </Button>
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => void downloadPlacement(fiche, 'png')}
                title="Télécharger l'image du placement (§22.E)"
              >
                Image
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setEditing(fiche);
                  setOpenForm(true);
                }}
              >
                Modifier
              </Button>
              {fiche.statut !== 'valide' ? (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => validate(fiche)}
                >
                  Valider
                </Button>
              ) : null}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Tissu : {fiche.fabricType ?? 'Non renseigné'} · Grammage :{' '}
              {fiche.grammageGm2 == null ? 'Non renseigné' : `${fiche.grammageGm2} g/m²`} ·{' '}
              {fiche.mesures.length} mesure(s) · {fiche.patrons.length} pièce(s) de patron ·
              Auteur : {fiche.createdByName ?? '—'}
            </Typography>
          </Paper>
        );
      })}
      {fiches.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Aucune fiche technique : créez la fiche d&apos;un produit puis saisissez ses
            dimensions officielles avant validation (§4 — les valeurs indicatives des
            patrons doivent être confirmées par l&apos;entreprise).
          </Typography>
        </Paper>
      ) : null}

      <FicheFormDialog
        open={openForm}
        editing={editing}
        products={products}
        onClose={() => setOpenForm(false)}
        onSaved={(message) => {
          setOpenForm(false);
          setSuccess(message);
          void reload();
        }}
      />

      <Dialog
        open={!!openVersions}
        onClose={() => setOpenVersions(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Historique des versions — {openVersions?.productNom}</DialogTitle>
        <DialogContent>
          {versions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune version archivée : la version actuelle V
              {String(openVersions?.version ?? 1).padStart(2, '0')} est la première.
            </Typography>
          ) : (
            versions.map((v) => (
              <Box
                key={v.version}
                sx={{ display: 'flex', gap: 2, py: 0.75, borderBottom: '1px solid #eee' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, width: 55 }}>
                  V{String(v.version).padStart(2, '0')}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {v.statut} — {v.createdByName ?? ''} — {v.createdAt}
                </Typography>
              </Box>
            ))
          )}
          {openVersions ? (
            <Button
              sx={{ mt: 2 }}
              startIcon={<PrintIcon />}
              onClick={() => printFichePdf(openVersions, true)}
            >
              Réimprimer (DUPLICATA)
            </Button>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenVersions(null)}>Fermer</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
