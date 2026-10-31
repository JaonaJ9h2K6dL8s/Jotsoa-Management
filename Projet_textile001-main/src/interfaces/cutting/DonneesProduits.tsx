'use client';

import { useMemo, useState } from 'react';
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
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  atelierAction,
  type CatalogueDTO,
  type FamilyRuleDTO,
  type FicheDTO,
  type RevisionDTO,
} from './api';

/**
 * Gestion des produits du catalogue Coupe (chef de coupe) : création
 * (nom, famille couverte par les règles de patronage R2, catégorie,
 * tailles actives) et modification. Les fiches de mesures sont créées
 * automatiquement par taille à la création du produit ; la validation
 * (admin) d'une fiche génère le patron. Rien n'est inventé ici.
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

/** État de la chaîne fiche → patron pour une taille d'un produit. */
type FicheState =
  | { kind: 'aucune' }
  | { kind: 'a_completer'; fiche: FicheDTO; manquantes: string[] }
  | { kind: 'a_valider'; fiche: FicheDTO }
  | { kind: 'patron'; fiche: FicheDTO; revision: RevisionDTO | null };

interface DonneesProduitsProps {
  products: CatalogueDTO[];
  sizes: Array<{ id: number; nom: string }>;
  /** Règles R2 par famille : pièces obligatoires, optionnelles, mesures. */
  familyRules: FamilyRuleDTO[];
  /** Fiches techniques existantes (une par produit × taille). */
  fiches: FicheDTO[];
  /** Révisions de patrons générées (rattachées à une fiche). */
  revisions: RevisionDTO[];
  /** Seul un administrateur peut valider une fiche. */
  canValidateFiche: boolean;
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
  onError: (message: string) => void;
}

export default function DonneesProduits(props: DonneesProduitsProps) {
  const {
    products, sizes, familyRules, fiches, revisions, canValidateFiche,
    onChanged, onToast, onError,
  } = props;
  const [form, setForm] = useState<ProductForm | null>(null);
  const [busy, setBusy] = useState(false);
  // Dialogue de saisie des mesures : fiche en cours d'édition.
  const [mesuresFiche, setMesuresFiche] = useState<FicheDTO | null>(null);
  const [mesuresValues, setMesuresValues] = useState<Record<string, string>>({});

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

  /** État fiche/patron pour un produit donné (toutes ses tailles). */
  const ficheStateOf = useMemo(() => {
    return (product: CatalogueDTO): FicheState[] => {
      const rules = familyRules.find((rule) => rule.family === product.family);
      const labels = rules?.measurementLabels ?? [];
      return product.sizeNames.map((sizeNom) => {
        const size = sizes.find((item) => item.nom === sizeNom);
        const fiche = fiches.find(
          (item) => item.productId === product.productId
            && (size ? item.sizeId === size.id : item.sizeNom === sizeNom),
        );
        if (!fiche) return { kind: 'aucune' } as FicheState;
        const revision = revisions.find(
          (item) => item.ficheId === fiche.id,
        ) ?? null;
        if (fiche.statut === 'valide' && revision) {
          return { kind: 'patron', fiche, revision } as FicheState;
        }
        const manquantes = labels.filter(
          (label) => fiche.mesures[label] === undefined
            || fiche.mesures[label] === null,
        );
        if (manquantes.length > 0) {
          return { kind: 'a_completer', fiche, manquantes } as FicheState;
        }
        return { kind: 'a_valider', fiche } as FicheState;
      });
    };
  }, [familyRules, fiches, revisions, sizes]);

  const openMesures = (fiche: FicheDTO) => {
    const rules = familyRules.find(
      (rule) => rule.family
        === products.find((product) => product.productId === fiche.productId)?.family,
    );
    const labels = rules?.measurementLabels ?? [];
    setMesuresFiche(fiche);
    setMesuresValues(Object.fromEntries(
      labels.map((label) => [label, fiche.mesures[label] !== undefined
        ? String(fiche.mesures[label]) : '']),
    ));
  };

  const saveMesures = async (validate: boolean) => {
    if (!mesuresFiche) return;
    setBusy(true);
    try {
      const mesures: Record<string, number> = {};
      for (const [label, raw] of Object.entries(mesuresValues)) {
        const trimmed = raw.trim();
        if (trimmed === '') continue;
        const value = Number(trimmed);
        if (!Number.isFinite(value) || value <= 0) {
          onError(`Mesure « ${label} » invalide : nombre positif attendu.`);
          return;
        }
        mesures[label] = value;
      }
      await atelierAction<FicheDTO>('fiche.save', {
        ficheId: mesuresFiche.id,
        productId: mesuresFiche.productId,
        mesures,
      });
      if (validate) {
        await atelierAction<{ item: FicheDTO; revision: RevisionDTO | null }>(
          'fiche.validate',
          { ficheId: mesuresFiche.id },
        );
        onToast('Fiche validée — patron généré : le plan est disponible dans l’atelier.');
      } else {
        onToast('Mesures enregistrées.');
      }
      setMesuresFiche(null);
      await onChanged();
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : 'Erreur d’enregistrement.');
    } finally {
      setBusy(false);
    }
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
        onToast(`Produit ${form.nom} créé — fiches de mesures prêtes à remplir.`);
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

  const ficheChipOf = (state: FicheState, sizeNom: string) => {
    switch (state.kind) {
      case 'patron':
        return (
          <Chip size="small" color="success" clickable
            label={`Patron #${state.revision?.id ?? '—'} · ${sizeNom}`}
            onClick={() => openMesures(state.fiche)} />
        );
      case 'a_valider':
        return (
          <Chip size="small" color="warning" clickable
            label={`À valider · ${sizeNom}`}
            onClick={() => openMesures(state.fiche)} />
        );
      case 'a_completer':
        return (
          <Chip size="small" color="primary" variant="outlined" clickable
            label={`Fiche à compléter · ${sizeNom}`}
            title={`Mesures manquantes : ${state.manquantes.join(', ')}`}
            onClick={() => openMesures(state.fiche)} />
        );
      default:
        return <Chip size="small" variant="outlined" disabled label={`— · ${sizeNom}`} />;
    }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Produits ({products.length})</Typography>
        <Button variant="contained" onClick={() => openProduct(null)}>Nouveau produit</Button>
      </Box>
      <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
        Les fiches de mesures sont créées automatiquement par taille
        (cliquez sur une puce pour compléter les mesures). La validation
        (admin) d’une fiche complète génère le patron immédiatement —
        il apparaît alors dans l’atelier comme plan. Rien n’est inventé :
        les mesures viennent uniquement de la fiche.
      </Alert>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nom</TableCell><TableCell>Famille</TableCell><TableCell>Catégorie</TableCell>
              <TableCell>Pièces (R2)</TableCell>
              <TableCell>Tailles</TableCell>
              <TableCell>Patron / Fiche</TableCell>
              <TableCell>État</TableCell><TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map((product) => {
              const rules = familyRules.find((rule) => rule.family === product.family);
              const states = ficheStateOf(product);
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
                    <Stack direction="row" spacing={0.5} useFlexGap className="flex-wrap">
                      {states.length > 0
                        ? states.map((state, index) => ficheChipOf(
                          state, product.sizeNames[index] ?? '',
                        ))
                        : <Typography variant="caption" color="text.secondary">—</Typography>}
                    </Stack>
                  </TableCell>
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

      <Dialog
        open={mesuresFiche !== null}
        onClose={() => setMesuresFiche(null)}
        maxWidth="sm" fullWidth
      >
        <DialogTitle>
          Mesures — {products.find((product) => product.productId === mesuresFiche?.productId)?.nom ?? ''}
          {mesuresFiche?.sizeNom ? ` · taille ${mesuresFiche.sizeNom}` : ''}
        </DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <Alert severity="info" sx={{ py: 0.5 }}>
            Toutes les mesures sont en centimètres (marges de couture
            incluses à la génération). Complétez chaque mesure requise
            puis enregistrez ; la validation (admin) génère le patron.
          </Alert>
          {(mesuresValues ? Object.entries(mesuresValues) : []).map(([label, value]) => (
            <TextField
              key={label}
              label={`${label} (cm)`}
              value={value}
              onChange={(event) => setMesuresValues((current) => ({
                ...current, [label]: event.target.value,
              }))}
              size="small"
              inputProps={{ inputMode: 'decimal' }}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMesuresFiche(null)}>Fermer</Button>
          {mesuresFiche?.statut !== 'valide' && (
            <>
              <Button disabled={busy} onClick={() => { void saveMesures(false); }}>
                Enregistrer
              </Button>
              {canValidateFiche && (
                <Button variant="contained" color="success" disabled={busy}
                  onClick={() => { void saveMesures(true); }}>
                  Enregistrer et valider (génère le patron)
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

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
