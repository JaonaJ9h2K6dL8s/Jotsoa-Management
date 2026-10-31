import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { ruleMeasurementLabels } from './pattern-rules';
import { assertCoupeWrite, inTransaction, requireText } from './common';

/**
 * Étape 2 du parcours : configuration du produit.
 * Le catalogue existant (`coupe_catalogue`, migration 0015) pilote les
 * familles, les catégories adulte/enfant et les tailles. Les libellés
 * de mesures du catalogue sont complétés par les libellés exigés par
 * les règles de patronage R1 (ex. « Hauteur col » pour le T-shirt) :
 * une fiche technique ne peut être complète que si elle couvre les
 * deux ensembles.
 */

export interface CatalogueSize {
  id: number;
  nom: string;
}

export interface CatalogueProduct {
  productId: number;
  nom: string;
  family: string;
  category: 'adulte' | 'enfant';
  sizeNames: string[];
  sizes: CatalogueSize[];
  measurementLabels: string[];
  isActive: boolean;
}

interface CatalogueRow {
  product_id: number;
  nom: string;
  family: string;
  category: string;
  size_names_json: string;
  measurement_labels_json: string;
  is_active: number;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/**
 * Crée les fiches techniques brouillon (une par taille, mesures vides)
 * pour les tailles du produit qui n'en ont pas encore. Appelée à la
 * création du produit et quand des tailles sont ajoutées : la saisie
 * des mesures devient l'étape suivante évidente.
 */
function ensureFichesForSizes(
  db: Database.Database,
  actor: Actor,
  productId: number,
): number {
  const product = requireCatalogueProduct(db, productId);
  const existing = db
    .prepare(
      'SELECT DISTINCT size_id FROM fiches_techniques WHERE product_id = ?',
    )
    .all(productId)
    .map((row) => (row as { size_id: number | null }).size_id);
  let created = 0;
  for (const size of product.sizes) {
    if (existing.includes(size.id)) continue;
    db.prepare(
      `INSERT INTO fiches_techniques
         (product_id, size_id, mesures_json, statut, version, created_by)
       VALUES (?, ?, '{}', 'brouillon', 1, ?)`,
    ).run(productId, size.id, actor.id);
    created += 1;
  }
  return created;
}

export function listCatalogueProducts(
  db: Database.Database,
): CatalogueProduct[] {
  const rows = db
    .prepare(
      `SELECT cc.product_id, p.nom, cc.family, cc.category,
              cc.size_names_json, cc.measurement_labels_json, cc.is_active
         FROM coupe_catalogue cc
         JOIN products p ON p.id = cc.product_id
        ORDER BY p.nom, cc.category`,
    )
    .all() as CatalogueRow[];
  const sizeStmt = db.prepare(
    'SELECT id, nom FROM sizes WHERE nom = ? AND is_active = 1 LIMIT 1',
  );
  return rows.map((row) => {
    const sizeNames = parseStringArray(row.size_names_json);
    const sizes: CatalogueSize[] = [];
    for (const name of sizeNames) {
      const match = sizeStmt.get(name) as { id: number; nom: string } | undefined;
      if (match) sizes.push({ id: match.id, nom: match.nom });
    }
    const catalogueLabels = parseStringArray(row.measurement_labels_json);
    const ruleLabels = ruleMeasurementLabels(row.family);
    const labels = [...new Set([...catalogueLabels, ...ruleLabels])];
    return {
      productId: row.product_id,
      nom: row.nom,
      family: row.family,
      category: row.category === 'enfant' ? 'enfant' : 'adulte',
      sizeNames,
      sizes,
      measurementLabels: labels,
      isActive: row.is_active === 1,
    };
  });
}

/** Retourne un produit du catalogue par identifiant produit. */
export function requireCatalogueProduct(
  db: Database.Database,
  productId: number,
): CatalogueProduct {
  const products = listCatalogueProducts(db);
  const found = products.find((item) => item.productId === productId);
  if (!found || !found.isActive) {
    throw new ServiceError('Produit absent du catalogue de coupe.', 404);
  }
  return found;
}

/** Résolution d'une taille par nom (saisie utilisateur). */
export function requireSizeByName(
  db: Database.Database,
  productId: number,
  sizeNom: string,
): CatalogueSize {
  const product = requireCatalogueProduct(db, productId);
  const found = product.sizes.find((size) => size.nom === sizeNom);
  if (!found) {
    throw new ServiceError(
      `La taille « ${sizeNom} » n'est pas disponible pour ce produit.`,
      400,
    );
  }
  return found;
}

/** Garde-fou de consultation (étape 2). */
export function assertCanBrowseCatalogue(actor: Actor): void {
  assertCoupeWrite(actor);
}

/** Familles couvertes par des règles de patronage versionnées (R2). */
const RULE_FAMILIES = ['tshirt', 'polo', 'short', 'jogging', 'ensemble'] as const;

const PRODUCT_TYPE_BY_CATEGORY: Record<'adulte' | 'enfant', string> = {
  adulte: 'Vêtements pour adultes',
  enfant: 'Vêtements pour enfants',
};

/** Tailles actives disponibles pour les fiches et le catalogue. */
export function listCatalogueSizes(
  db: Database.Database,
): Array<{ id: number; nom: string }> {
  return db
    .prepare('SELECT id, nom FROM sizes WHERE is_active = 1 ORDER BY display_order, nom')
    .all() as Array<{ id: number; nom: string }>;
}

function parseSizeNames(
  db: Database.Database,
  raw: unknown,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ServiceError(
      'Au moins une taille est requise pour créer un produit.',
      400,
    );
  }
  const names = raw.map((item) => String(item).trim()).filter(Boolean);
  if (names.length === 0 || names.length > 30) {
    throw new ServiceError('Liste de tailles invalide (1 à 30).', 400);
  }
  const stmt = db.prepare('SELECT id FROM sizes WHERE nom = ? AND is_active = 1');
  const missing = names.filter((name) => !stmt.get(name));
  if (missing.length > 0) {
    throw new ServiceError(
      `Tailles inconnues ou inactives : ${missing.join(', ')}.`,
      400,
    );
  }
  return [...new Set(names)];
}

function requireFamily(raw: unknown): string {
  const family = requireText(raw, 'La famille de produit', 40).toLowerCase();
  if (!(RULE_FAMILIES as readonly string[]).includes(family)) {
    throw new ServiceError(
      `Famille « ${family} » sans règles de patronage (familles gérées : ${RULE_FAMILIES.join(', ')}).`,
      400,
    );
  }
  return family;
}

function requireCategory(raw: unknown): 'adulte' | 'enfant' {
  if (raw === 'adulte' || raw === 'enfant') return raw;
  throw new ServiceError('La catégorie doit être « adulte » ou « enfant ».', 400);
}

export interface CreateCatalogueProductInput {
  nom: unknown;
  family: unknown;
  category: unknown;
  sizeNames: unknown;
}

/**
 * Création d'un produit de catalogue (chef de coupe) : ligne `products`
 * (type déduit de la catégorie) + ligne `coupe_catalogue` pilotant les
 * tailles. La famille doit être couverte par les règles de patronage —
 * aucune dimension n'est inventée : les mesures viendront uniquement
 * des fiches techniques validées.
 */
export function createCatalogueProduct(
  db: Database.Database,
  actor: Actor,
  input: CreateCatalogueProductInput,
): CatalogueProduct {
  assertCoupeWrite(actor);
  const nom = requireText(input.nom, 'Le nom du produit', 80);
  const family = requireFamily(input.family);
  const category = requireCategory(input.category);
  const sizeNames = parseSizeNames(db, input.sizeNames);
  const duplicate = db
    .prepare(
      `SELECT cc.product_id FROM coupe_catalogue cc
         JOIN products p ON p.id = cc.product_id
        WHERE p.nom = ? AND cc.family = ? AND cc.category = ?`,
    )
    .get(nom, family, category);
  if (duplicate) {
    throw new ServiceError(
      `Un produit « ${nom} » (${family}/${category}) existe déjà.`,
      409,
    );
  }
  const type = db
    .prepare('SELECT id FROM product_types WHERE nom = ? AND is_active = 1')
    .get(PRODUCT_TYPE_BY_CATEGORY[category]) as { id: number } | undefined;
  if (!type) {
    throw new ServiceError(
      `Type de produit « ${PRODUCT_TYPE_BY_CATEGORY[category]} » introuvable.`,
      409,
    );
  }
  const productId = inTransaction(db, () => {
    const inserted = db
      .prepare('INSERT INTO products (nom, product_type_id) VALUES (?, ?)')
      .run(nom, type.id);
    db.prepare(
      `INSERT INTO coupe_catalogue
         (product_id, family, category, size_names_json, measurement_labels_json, is_active)
       VALUES (?, ?, ?, ?, '[]', 1)`,
    ).run(inserted.lastInsertRowid, family, category, JSON.stringify(sizeNames));
    // Fiches de mesures prêtes à remplir, une par taille sélectionnée.
    ensureFichesForSizes(db, actor, Number(inserted.lastInsertRowid));
    return Number(inserted.lastInsertRowid);
  });
  return requireCatalogueProduct(db, productId);
}

export interface UpdateCatalogueProductInput {
  productId: unknown;
  nom?: unknown;
  sizeNames?: unknown;
  isActive?: unknown;
}

/**
 * Modification d'un produit du catalogue (nom, tailles, actif). Les
 * révisions de patrons déjà validées ne sont PAS affectées : elles
 * conservent leurs propres pièces (isolation par snapshot).
 */
export function updateCatalogueProduct(
  db: Database.Database,
  actor: Actor,
  input: UpdateCatalogueProductInput,
): CatalogueProduct {
  assertCoupeWrite(actor);
  const productId = Number(input.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new ServiceError('Le produit est requis.', 400);
  }
  const row = db
    .prepare(
      `SELECT cc.family, cc.category, cc.size_names_json, cc.is_active, p.nom
         FROM coupe_catalogue cc JOIN products p ON p.id = cc.product_id
        WHERE cc.product_id = ?`,
    )
    .get(productId) as {
    family: string; category: string; size_names_json: string; is_active: number; nom: string;
  } | undefined;
  if (!row) {
    throw new ServiceError('Produit absent du catalogue de coupe.', 404);
  }
  const nom = input.nom === undefined ? row.nom : requireText(input.nom, 'Le nom du produit', 80);
  const sizeNames = input.sizeNames === undefined
    ? parseStringArray(row.size_names_json)
    : parseSizeNames(db, input.sizeNames);
  const isActive = input.isActive === undefined
    ? row.is_active === 1
    : input.isActive === true || input.isActive === 1 || input.isActive === '1';
  inTransaction(db, () => {
    db.prepare(
      'UPDATE products SET nom = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(nom, productId);
    db.prepare(
      `UPDATE coupe_catalogue
          SET size_names_json = ?, is_active = ? WHERE product_id = ?`,
    ).run(JSON.stringify(sizeNames), isActive ? 1 : 0, productId);
    // Tailles ajoutées : fiches de mesures créées automatiquement.
    if (isActive) ensureFichesForSizes(db, actor, productId);
  });
  if (!isActive) {
    return { ...requireCatalogueProductLoose(db, productId) };
  }
  return requireCatalogueProduct(db, productId);
}

/** Relecture tolérante (produit éventuellement désactivé). */
function requireCatalogueProductLoose(
  db: Database.Database,
  productId: number,
): CatalogueProduct {
  const all = listCatalogueProducts(db);
  const strict = all.find((item) => item.productId === productId);
  if (strict) return strict;
  const row = db
    .prepare(
      `SELECT cc.product_id, p.nom, cc.family, cc.category,
              cc.size_names_json, cc.measurement_labels_json, cc.is_active
         FROM coupe_catalogue cc JOIN products p ON p.id = cc.product_id
        WHERE cc.product_id = ?`,
    )
    .get(productId) as CatalogueRow | undefined;
  if (!row) throw new ServiceError('Produit absent du catalogue.', 404);
  const sizeNames = parseStringArray(row.size_names_json);
  const sizeStmt = db.prepare('SELECT id, nom FROM sizes WHERE nom = ? AND is_active = 1');
  const sizes = sizeNames
    .map((name) => sizeStmt.get(name) as { id: number; nom: string } | undefined)
    .filter((item): item is { id: number; nom: string } => item !== undefined);
  const labels = [...new Set([...parseStringArray(row.measurement_labels_json),
    ...ruleMeasurementLabels(row.family)])];
  return {
    productId: row.product_id, nom: row.nom, family: row.family,
    category: row.category === 'enfant' ? 'enfant' : 'adulte',
    sizeNames, sizes, measurementLabels: labels, isActive: row.is_active === 1,
  };
}
