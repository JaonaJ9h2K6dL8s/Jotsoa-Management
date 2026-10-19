import {
  validateDescription,
  validateDisplayOrder,
  validateHexColor,
} from '@/lib/config-validation';
import type { ReferenceDefinition } from './reference';

/**
 * Définitions des entités de référence simples.
 * Les colonnes acceptées sont strictement limitées à cette liste.
 */

const COMMON_SELECT =
  'id, nom, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt';

export const PRODUCT_TYPES: ReferenceDefinition = {
  table: 'product_types',
  label: 'type de produit',
  nameColumn: 'nom',
  auditKey: 'product_type',
  select: `SELECT ${COMMON_SELECT}, description FROM product_types`,
  fields: [
    { column: 'nom', required: true, min: 2, max: 80, label: 'Le nom' },
    {
      column: 'description',
      required: false,
      max: 500,
      label: 'La description',
      validate: validateDescription,
    },
  ],
};

export const COLORS: ReferenceDefinition = {
  table: 'colors',
  label: 'couleur',
  nameColumn: 'nom',
  auditKey: 'color',
  select: `SELECT ${COMMON_SELECT}, hex_code AS hexCode FROM colors`,
  fields: [
    { column: 'nom', required: true, min: 2, max: 80, label: 'Le libellé' },
    {
      column: 'hex_code',
      required: false,
      max: 7,
      label: 'Le code couleur',
      validate: validateHexColor,
    },
  ],
};

export const SIZES: ReferenceDefinition = {
  table: 'sizes',
  label: 'taille',
  nameColumn: 'nom',
  auditKey: 'size',
  select: `SELECT ${COMMON_SELECT}, display_order AS displayOrder FROM sizes`,
  fields: [
    { column: 'nom', required: true, min: 1, max: 20, label: 'Le libellé' },
    {
      column: 'display_order',
      required: false,
      max: 4,
      label: "L'ordre d'affichage",
      validate: validateDisplayOrder,
    },
  ],
};

export const SIMPLE_ENTITIES: Record<
  string,
  ReferenceDefinition
> = {
  'product-types': PRODUCT_TYPES,
  colors: COLORS,
  sizes: SIZES,
};
