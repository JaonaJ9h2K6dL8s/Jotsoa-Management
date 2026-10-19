'use client';

import Add from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useCallback, useEffect, useState } from 'react';

/**
 * Liste déroulante de produits groupés par catégorie, avec option
 * « Nouveau produit / matière première » ouvrant un dialogue de
 * création rapide. Réutilisée partout où un produit est choisi
 * (lots et rouleaux de coupe, correspondance magasinier, …).
 * La création est autorisée côté serveur uniquement pour les rôles
 * concernés ; l'option n'apparaît que si `canCreate` est actif.
 */

interface CatalogueProduct {
  id: number;
  nom: string;
}

interface CatalogueCategory {
  typeId: number;
  typeName: string;
  displayOrder: number;
  products: CatalogueProduct[];
}

const NEW_OPTION = '__nouveau_produit__';

/** Rôles autorisés côté serveur à créer un produit (miroir du service). */
const CREATE_ROLES = new Set(['admin', 'chef_coupe', 'chef_stock', 'chef_magasinier']);

interface ProductSelectProps {
  label?: string;
  value: string;
  onChange: (productId: string, productNom: string) => void;
  /** Restreint la liste à une catégorie (ex. « Matières premières »). */
  restrictToTypeName?: string;
  required?: boolean;
  disabled?: boolean;
}

export default function ProductSelect({
  label = 'Produit',
  value,
  onChange,
  restrictToTypeName,
  required,
  disabled,
}: ProductSelectProps) {
  const [categories, setCategories] = useState<CatalogueCategory[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [createTypeId, setCreateTypeId] = useState('');
  const [createNom, setCreateNom] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch('/api/catalogue/produits', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        item?: CatalogueCategory[];
        message?: string;
      };
      if (!response.ok || body.status !== 'ok' || !body.item) {
        throw new Error(body.message ?? 'Erreur de chargement du catalogue.');
      }
      setCategories(body.item);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const body = (await response.json().catch(() => ({}))) as {
          status?: string;
          user?: { roleCode?: string };
        };
        setCanCreate(CREATE_ROLES.has(body.user?.roleCode ?? ''));
      } catch {
        setCanCreate(false);
      }
    })();
  }, [load]);

  const shown = (categories ?? []).filter(
    (category) => !restrictToTypeName || category.typeName === restrictToTypeName,
  );

  function handleSelectChange(event: { target: { value: string } }) {
    const next = event.target.value;
    if (next === NEW_OPTION) {
      setCreateError(null);
      setCreateNom('');
      setCreateDescription('');
      setCreateTypeId(
        restrictToTypeName ? String(shown[0]?.typeId ?? '') : '',
      );
      setOpenCreate(true);
      return;
    }
    const product = shown
      .flatMap((category) => category.products)
      .find((item) => String(item.id) === next);
    onChange(next, product?.nom ?? '');
  }

  async function handleCreate() {
    setSaving(true);
    setCreateError(null);
    try {
      const response = await fetch('/api/catalogue/produits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: createNom,
          typeId: Number(createTypeId),
          description: createDescription || null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        item?: CatalogueProduct;
        message?: string;
      };
      if (!response.ok || body.status !== 'ok' || !body.item) {
        throw new Error(body.message ?? 'Échec de la création du produit.');
      }
      await load();
      setOpenCreate(false);
      onChange(String(body.item.id), body.item.nom);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormControl size="small" required={required} fullWidth disabled={disabled}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={value}
          label={label}
          onChange={handleSelectChange}
        >
          {loadError ? (
            <MenuItem value="" disabled>
              Erreur de chargement — réessayez
            </MenuItem>
          ) : null}
          {shown.map((category) => [
            <ListSubheader key={`type-${category.typeId}`} disableSticky>
              {category.typeName}
            </ListSubheader>,
            ...category.products.map((product) => (
              <MenuItem key={product.id} value={String(product.id)}>
                {product.nom}
              </MenuItem>
            )),
          ])}
          {canCreate ? (
            <MenuItem value={NEW_OPTION} sx={{ fontWeight: 600 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Add fontSize="small" />
                Nouveau produit ou matière première…
              </Stack>
            </MenuItem>
          ) : null}
        </Select>
      </FormControl>

      <Dialog
        open={openCreate}
        onClose={() => !saving && setOpenCreate(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Nouveau produit ou matière première</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            {createError ? <Alert severity="error">{createError}</Alert> : null}
            <FormControl size="small" required>
              <InputLabel>Catégorie</InputLabel>
              <Select
                value={createTypeId}
                label="Catégorie"
                onChange={(event) => setCreateTypeId(event.target.value)}
                disabled={Boolean(restrictToTypeName)}
              >
                {(categories ?? []).map((category) => (
                  <MenuItem key={category.typeId} value={String(category.typeId)}>
                    {category.typeName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Nom du produit"
              required
              value={createNom}
              onChange={(event) => setCreateNom(event.target.value)}
              helperText="2 à 80 caractères. Unique au sein de sa catégorie."
            />
            <TextField
              label="Description (facultatif)"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)} disabled={saving}>
            Annuler
          </Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={saving || !createNom.trim() || !createTypeId}
          >
            {saving ? 'Création…' : 'Créer et sélectionner'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
