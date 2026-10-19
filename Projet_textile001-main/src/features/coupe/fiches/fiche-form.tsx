'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import type { FicheDetail, FicheMesure } from '@/server/coupe/fiches';

/**
 * Formulaire de saisie d'une fiche technique (cahier §3) : champs
 * matière, tableau de mesures du vêtement fini et confection. Toutes
 * les valeurs partent en base via POST /api/coupe/fiches.
 */

interface ProductOption {
  id: number;
  nom: string;
  category: string;
}

const emptyMesure: FicheMesure = { label: '', valeurCm: 0 };

export default function FicheFormDialog({
  open,
  editing,
  products,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: FicheDetail | null;
  products: ProductOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    productId: '',
    sizeId: '',
    colorNom: '',
    modele: '',
    coupe: '',
    fabricType: '',
    composition: '',
    grammageGm2: '',
    largeurRouleauCm: '',
    largeurUtileCm: '',
    elasticite: '',
    droitFil: '',
    consommationTheoriqueM: '',
    notes: '',
  });
  const [sizes, setSizes] = useState<Array<{ id: number; nom: string }>>([]);
  const [mesures, setMesures] = useState<FicheMesure[]>([{ ...emptyMesure }]);
  const [confection, setConfection] = useState({ valeursCoutureCm: '', consignes: '' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        productId: String(editing.productId),
        sizeId: editing.sizeId == null ? '' : String(editing.sizeId),
        colorNom: editing.colorNom ?? '',
        modele: editing.modele ?? '',
        coupe: editing.coupe ?? '',
        fabricType: editing.fabricType ?? '',
        composition: editing.composition ?? '',
        grammageGm2: editing.grammageGm2 == null ? '' : String(editing.grammageGm2),
        largeurRouleauCm:
          editing.largeurRouleauCm == null ? '' : String(editing.largeurRouleauCm),
        largeurUtileCm: editing.largeurUtileCm == null ? '' : String(editing.largeurUtileCm),
        elasticite: editing.elasticite ?? '',
        droitFil: editing.droitFil ?? '',
        consommationTheoriqueM:
          editing.consommationTheoriqueM == null
            ? ''
            : String(editing.consommationTheoriqueM),
        notes: editing.notes ?? '',
      });
      setMesures(editing.mesures.length > 0 ? [...editing.mesures] : [{ ...emptyMesure }]);
      setConfection({
        valeursCoutureCm:
          editing.confection.valeursCoutureCm == null
            ? ''
            : String(editing.confection.valeursCoutureCm),
        consignes: editing.confection.consignes ?? '',
      });
    } else {
      setForm({
        productId: '', sizeId: '', colorNom: '', modele: '', coupe: '',
        fabricType: '', composition: '', grammageGm2: '', largeurRouleauCm: '',
        largeurUtileCm: '', elasticite: '', droitFil: '', consommationTheoriqueM: '',
        notes: '',
      });
      setMesures([{ ...emptyMesure }]);
      setConfection({ valeursCoutureCm: '', consignes: '' });
    }
  }, [open, editing]);

  // Tailles disponibles du produit (via ses patrons enregistrés).
  useEffect(() => {
    if (!form.productId) {
      setSizes([]);
      return;
    }
    const product = products.find((p) => p.id === Number(form.productId));
    (async () => {
      try {
        const response = await fetch(
          `/api/coupe/patterns?productId=${form.productId}&category=${product?.category ?? 'adulte'}`,
          { cache: 'no-store' },
        );
        const body = (await response.json()) as {
          status: string;
          items?: Array<{ sizeId: number; sizeNom: string }>;
        };
        if (response.ok) {
          const seen = new Map<number, string>();
          for (const item of body.items ?? []) seen.set(item.sizeId, item.sizeNom);
          setSizes(Array.from(seen, ([id, nom]) => ({ id, nom })));
        }
      } catch {
        setSizes([]);
      }
    })();
  }, [form.productId, products]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/coupe/fiches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing?.id ?? null,
        productId: form.productId,
        sizeId: form.sizeId || null,
        colorNom: form.colorNom || null,
        modele: form.modele || null,
        coupe: form.coupe || null,
        fabricType: form.fabricType || null,
        composition: form.composition || null,
        grammageGm2: form.grammageGm2 || null,
        largeurRouleauCm: form.largeurRouleauCm || null,
        largeurUtileCm: form.largeurUtileCm || null,
        elasticite: form.elasticite || null,
        droitFil: form.droitFil || null,
        consommationTheoriqueM: form.consommationTheoriqueM || null,
        notes: form.notes || null,
        mesures,
        confection: {
          valeursCoutureCm: confection.valeursCoutureCm || null,
          consignes: confection.consignes || null,
        },
      }),
    });
    const body = (await response.json()) as { status: string; message?: string };
    if (!response.ok) {
      throw new Error(body.message ?? 'Erreur.');
    }
    onSaved(
      editing && editing.statut === 'valide'
        ? 'Fiche modifiée : ancienne version archivée, nouvelle version à revalider.'
        : 'Fiche enregistrée.',
    );
  } catch (cause) {
    setSaveError(cause instanceof Error ? cause.message : 'Erreur.');
  } finally {
    setSaving(false);
  }
};

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {editing ? 'Modifier la fiche technique' : 'Nouvelle fiche technique'}
      </DialogTitle>
      <DialogContent>
        {saveError ? <Alert severity="error" sx={{ mb: 1 }}>{saveError}</Alert> : null}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, pt: 1 }}>
          <TextField
            select
            label="Produit"
            value={form.productId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, productId: e.target.value }))}
            disabled={!!editing}
          >
            {products.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.nom}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Taille"
            value={form.sizeId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, sizeId: e.target.value }))}
            disabled={!!editing}
          >
            <MenuItem value="">Toutes tailles</MenuItem>
            {sizes.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.nom}
              </MenuItem>
            ))}
          </TextField>
          {(
            [
              ['colorNom', 'Couleur'],
              ['modele', 'Modèle'],
              ['coupe', 'Coupe'],
              ['fabricType', 'Type de tissu'],
              ['composition', 'Composition'],
              ['grammageGm2', 'Grammage (g/m²)'],
              ['largeurRouleauCm', 'Largeur rouleau (cm)'],
              ['largeurUtileCm', 'Largeur utile (cm)'],
              ['elasticite', 'Élasticité'],
              ['droitFil', 'Sens du droit-fil'],
              ['consommationTheoriqueM', 'Consommation théorique (m/vêtement)'],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              value={form[key]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              size="small"
            />
          ))}
        </Box>
        <Box sx={{ mt: 2 }}>
          <TextField
            size="small"
            label="Tableau de mesures — ajouter une mesure (libellé)"
            sx={{ width: '60%' }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                const value = (e.target as HTMLInputElement).value.trim();
                if (value) {
                  setMesures((prev) => [...prev, { label: value, valeurCm: 0 }]);
                  (e.target as HTMLInputElement).value = '';
                }
              }
            }}
            helperText="Entrée pour ajouter : libellé + valeur + tolérance (cm)."
          />
        </Box>
        {mesures.map((m, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <TextField
              size="small"
              label="Mesure"
              value={m.label}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMesures((prev) =>
                  prev.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)),
                )
              }
              sx={{ flex: 2 }}
            />
            <TextField
              size="small"
              type="number"
              label="Valeur (cm)"
              value={m.valeurCm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMesures((prev) =>
                  prev.map((x, j) =>
                    i === j ? { ...x, valeurCm: Number(e.target.value) } : x,
                  ),
                )
              }
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label="Tolérance"
              value={m.toleranceCm ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMesures((prev) =>
                  prev.map((x, j) =>
                    i === j
                      ? {
                          ...x,
                          toleranceCm:
                            e.target.value === '' ? undefined : Number(e.target.value),
                        }
                      : x,
                  ),
                )
              }
              sx={{ flex: 1 }}
            />
            <Button
              onClick={() => setMesures((prev) => prev.filter((_, j) => j !== i))}
              disabled={mesures.length <= 1}
            >
              −
            </Button>
          </Box>
        ))}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
          <TextField
            size="small"
            label="Valeur de couture (cm)"
            value={confection.valeursCoutureCm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfection((c) => ({ ...c, valeursCoutureCm: e.target.value }))}
          />
          <TextField
            size="small"
            label="Consignes d'assemblage"
            value={confection.consignes}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfection((c) => ({ ...c, consignes: e.target.value }))}
          />
        </Box>
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          label="Observations / pertes"
          value={form.notes}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, notes: e.target.value }))}
          sx={{ mt: 1.5 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" disabled={!form.productId || saving} onClick={save}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
