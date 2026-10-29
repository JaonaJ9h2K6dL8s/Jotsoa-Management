'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { atelierAction, type CatalogueDTO, type FamilyRuleDTO } from './api';

/**
 * Gestion des produits du catalogue Coupe (chef de coupe) : création
 * (nom, famille couverte par les règles de patronage R2, catégorie,
 * tailles actives) et modification. La famille détermine les pièces
 * obligatoires ; les mesures viendront uniquement des fiches techniques
 * validées — rien n'est inventé ici.
 */

const FAMILIES = [
  { value: 'tshirt', label: 'T-shirt' },
  { value: 'polo', label: 'Polo' },
  { value: 'short', label: 'Short' },
  { value: 'jogging', label: 'Jogging' },
  { value: 'ensemble', label: 'Ensemble' },
];

interface ProductForm {
  productId: number | null;
  nom: string;
  family: string;
  category: string;
  sizeNames: string[];
  isActive: boolean;
}

const EMPTY: ProductForm = {
  productId: null, nom: '', family: 'tshirt', category: 'adulte',
  sizeNames: [], isActive: true,
};

interface DonneesProduitsProps {
  products: CatalogueDTO[];
  sizes: Array<{ id: number; nom: string }>;
  /** Règles R2 par famille : pièces obligatoires et optionnelles. */
  familyRules: FamilyRuleDTO[];
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
  onError: (message: string) => void;
}

export default function DonneesProduits(props: DonneesProduitsProps) {
  const { products, sizes, familyRules, onChanged, onToast, onError } = props;
  const [form, setForm] = useState<ProductForm | null>(null);
  const [busy, setBusy] = useState(false);

  const patchForm = (patch: Partial<ProductForm>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
  };

  const openProduct = (product: CatalogueDTO | null) => {
    setForm(product ? {
      productId: product.productId, nom: product.nom, family: product.family,
      category: product.category, sizeNames: [...product.sizeNames],
      isActive: product.isActive,
    } : { ...EMPTY });
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      if (form.productId === null) {
        await atelierAction<CatalogueDTO>('catalogue.create', {
          nom: form.nom, family: form.family, category: form.category,
          sizeNames: form.sizeNames,
        });
        onToast(`Produit ${form.nom} créé.`);
      } else {
        await atelierAction<CatalogueDTO>('catalogue.update', {
          productId: form.productId, nom: form.nom,
          sizeNames: form.sizeNames, isActive: form.isActive,
        });
        onToast(`Produit ${form.nom} mis à jour.`);
      }
      setForm(null);
      await onChanged();
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : 'Erreur d’enregistrement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Produits ({products.length})</Typography>
        <Button variant="contained" onClick={() => openProduct(null)}>Nouveau produit</Button>
      </Box>
      <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
        Pièces obligatoires imposées par les règles de patronage R2 de la
        famille (marges de couture incluses à la génération). Un produit du
        catalogue n’est pas un patron validé : les mesures viennent
        uniquement d’une fiche technique validée — les produits de
        démonstration ne constituent pas des patrons industriels.
      </Alert>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nom</TableCell><TableCell>Famille</TableCell><TableCell>Catégorie</TableCell>
              <TableCell>Pièces (R2)</TableCell>
              <TableCell>Tailles</TableCell><TableCell>État</TableCell><TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map((product) => {
              const rules = familyRules.find((rule) => rule.family === product.family);
              return (
                <TableRow key={product.productId}>
                  <TableCell>{product.nom}</TableCell>
                  <TableCell>{product.family}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>
                    {rules ? (
                      <span title={
                        `Obligatoires : ${rules.requiredPieces.join(', ')}`
                        + (rules.optionalPieces.length > 0
                          ? `\nOptionnelles : ${rules.optionalPieces.join(', ')}` : '')
                      }>
                        {rules.requiredPieces.length} obligatoire(s)
                        {rules.optionalPieces.length > 0
                          ? ` + ${rules.optionalPieces.length} optionnelle(s)` : ''}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell>{product.sizeNames.join(', ')}</TableCell>
                  <TableCell>
                    <Chip size="small" color={product.isActive ? 'success' : 'default'}
                      label={product.isActive ? 'actif' : 'inactif'} />
                  </TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => openProduct(product)}>Modifier</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {form?.productId === null ? 'Nouveau produit' : 'Modifier le produit'}
        </DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField label="Nom du produit" value={form?.nom ?? ''}
            onChange={(event) => patchForm({ nom: event.target.value })} />
          <FormControl size="small" disabled={form?.productId !== null}>
            <InputLabel>Famille</InputLabel>
            <Select label="Famille" value={form?.family ?? 'tshirt'}
              onChange={(event) => patchForm({ family: event.target.value })}>
              {FAMILIES.map((family) => (
                <MenuItem key={family.value} value={family.value}>{family.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" disabled={form?.productId !== null}>
            <InputLabel>Catégorie</InputLabel>
            <Select label="Catégorie" value={form?.category ?? 'adulte'}
              onChange={(event) => patchForm({ category: event.target.value })}>
              <MenuItem value="adulte">Adulte</MenuItem>
              <MenuItem value="enfant">Enfant</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Tailles</InputLabel>
            <Select label="Tailles" multiple value={form?.sizeNames ?? []}
              renderValue={(selected) => (selected as string[]).join(', ')}
              onChange={(event) => patchForm({
                sizeNames: event.target.value as string[],
              })}>
              {sizes.map((size) => (
                <MenuItem key={size.id} value={size.nom}>
                  <Checkbox checked={(form?.sizeNames ?? []).includes(size.nom)} />
                  <ListItemText primary={size.nom} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {form?.productId !== null && (
            <FormControlLabel control={(
              <Checkbox checked={form?.isActive ?? true}
                onChange={(event) => patchForm({ isActive: event.target.checked })} />
            )}
              label="Produit actif" />
          )}
          <Alert severity="info" sx={{ py: 0.5 }}>
            La famille définit les pièces obligatoires (règles R2). Les patrons
            ne seront générés qu’à partir d’une fiche technique validée.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>Annuler</Button>
          <Button variant="contained" disabled={busy} onClick={() => { void save(); }}>
            Enregistrer
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
