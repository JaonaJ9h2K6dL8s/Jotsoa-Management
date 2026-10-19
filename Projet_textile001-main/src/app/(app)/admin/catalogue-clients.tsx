'use client';

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import EntityManager from '@/features/admin/config/entity-manager';

/**
 * Wrappers client pour les pages de configuration du catalogue. Les
 * colonnes avec fonctions `render` doivent être définies côté client :
 * une fonction ne peut pas traverser la frontière serveur → client.
 */

export function SizesManager() {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Tailles
      </Typography>
      <Typography variant="body2" color="text.secondary">
        L&apos;ordre d&apos;affichage détermine le classement des tailles dans
        les futurs écrans. L&apos;association des tailles à des types de
        produits sera gérée dans le module Produits.
      </Typography>
      <EntityManager
        title="Tailles"
        singular="taille"
        endpoint="/api/config/simple/sizes"
        searchPlaceholder="Rechercher une taille…"
        fields={[
          { name: 'nom', label: 'Libellé de la taille', required: true },
          {
            name: 'displayOrder',
            label: "Ordre d'affichage",
            type: 'number',
            helper: 'Entier entre 1 et 999',
          },
        ]}
        columns={[
          { key: 'nom', label: 'Libellé', sortValue: (row) => String(row.nom) },
          {
            key: 'displayOrder',
            label: 'Ordre',
            sortValue: (row) => Number(row.displayOrder ?? 0),
          },
          {
            key: 'isActive',
            label: 'Statut',
            render: (row) => (
              <Chip
                label={row.isActive ? 'Actif' : 'Désactivé'}
                size="small"
                color={row.isActive ? 'success' : 'default'}
                variant="outlined"
              />
            ),
          },
          {
            key: 'updatedAt',
            label: 'Modifié le',
            render: (row) => String(row.updatedAt || '—'),
          },
        ]}
      />
    </Stack>
  );
}

export function ColorsManager() {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Couleurs
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Libellés de couleurs disponibles pour les variantes de produits. Le
        code hexadécimal est facultatif et sert uniquement à l&apos;affichage.
      </Typography>
      <EntityManager
        title="Couleurs"
        singular="couleur"
        endpoint="/api/config/simple/colors"
        searchPlaceholder="Rechercher une couleur…"
        fields={[
          { name: 'nom', label: 'Libellé de la couleur', required: true },
          {
            name: 'hexCode',
            label: 'Code couleur (facultatif)',
            type: 'color',
            helper: 'Format #RRGGBB, ex. #1D4ED8',
          },
        ]}
        columns={[
          { key: 'nom', label: 'Libellé', sortValue: (row) => String(row.nom) },
          {
            key: 'hexCode',
            label: 'Aperçu',
            render: (row) =>
              row.hexCode ? (
                <Box className="flex items-center gap-2">
                  <Box
                    sx={{
                      width: 18,
                      height: 18,
                      borderRadius: '4px',
                      border: '1px solid #d1d5db',
                      backgroundColor: String(row.hexCode),
                    }}
                  />
                  {String(row.hexCode)}
                </Box>
              ) : (
                '—'
              ),
          },
          {
            key: 'isActive',
            label: 'Statut',
            render: (row) => (row.isActive ? 'Actif' : 'Désactivé'),
          },
          {
            key: 'updatedAt',
            label: 'Modifié le',
            render: (row) => String(row.updatedAt || '—'),
          },
        ]}
      />
    </Stack>
  );
}

export function ProductTypesManager() {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Types de produits
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Les types servent de base aux produits concrets et à leurs variantes
        (couleurs, tailles). Aucun type utilisé n&apos;est supprimé : il est
        désactivé.
      </Typography>
      <EntityManager
        title="Types de produits"
        singular="type de produit"
        endpoint="/api/config/simple/product-types"
        searchPlaceholder="Rechercher un type de produit…"
        fields={[
          { name: 'nom', label: 'Nom du type', required: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ]}
        columns={[
          { key: 'nom', label: 'Nom', sortValue: (row) => String(row.nom) },
          {
            key: 'description',
            label: 'Description',
            render: (row) => String(row.description || '—'),
          },
          {
            key: 'isActive',
            label: 'Statut',
            render: (row) => (row.isActive ? 'Actif' : 'Désactivé'),
          },
          {
            key: 'updatedAt',
            label: 'Modifié le',
            render: (row) => String(row.updatedAt || '—'),
          },
        ]}
      />
    </Stack>
  );
}
