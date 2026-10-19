import { ServiceError } from '@/server/api/service-error';
import { writeAudit } from '@/server/auth/audit';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';

/**
 * Catalogue produits partagé : catégories (types de produits) groupées
 * et produits associés. Consultable par tout utilisateur actif ; la
 * création rapide depuis les listes déroulantes est réservée aux
 * rôles opérationnels concernés (admin, coupe, stock, magasinier).
 * La gestion complète du référentiel reste dans l'espace admin.
 */

export const CATALOGUE_CREATE_ROLES = [
  'admin',
  'chef_coupe',
  'chef_stock',
  'chef_magasinier',
] as const;

export interface CatalogueProduct {
  id: number;
  nom: string;
}

export interface CatalogueCategory {
  typeId: number;
  typeName: string;
  displayOrder: number;
  products: CatalogueProduct[];
}

export interface CreateProductInput {
  nom: string;
  typeId: number;
  description?: string | null;
}

export function requireCatalogueCreate(actor: Actor): void {
  if (!CATALOGUE_CREATE_ROLES.includes(actor.roleCode as never)) {
    throw new ServiceError(
      'Votre rôle ne permet pas de créer un produit dans le catalogue.',
      403,
    );
  }
}

/** Catalogue complet, groupé par catégorie active, produits actifs. */
export function listCatalogue(actor: Actor): CatalogueCategory[] {
  if (!actor.id) {
    throw new ServiceError('Utilisateur requis.', 401);
  }
  const db = sessionsDb();
  const types = db
    .prepare(
      `SELECT id, nom, display_order FROM product_types
       WHERE is_active = 1 ORDER BY display_order, nom`,
    )
    .all() as Array<{ id: number; nom: string; display_order: number }>;
  const products = db
    .prepare(
      `SELECT id, nom, product_type_id FROM products
       WHERE is_active = 1 ORDER BY LOWER(TRIM(nom))`,
    )
    .all() as Array<{ id: number; nom: string; product_type_id: number }>;
  return types.map((type) => ({
    typeId: type.id,
    typeName: type.nom,
    displayOrder: type.display_order,
    products: products
      .filter((product) => product.product_type_id === type.id)
      .map((product) => ({ id: product.id, nom: product.nom })),
  }));
}

function validateProductName(nom: string): string {
  const name = nom.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw new ServiceError(
      'Le nom du produit doit contenir entre 2 et 80 caractères.',
      400,
    );
  }
  return name;
}

/**
 * Création rapide d'un produit (option « nouveau produit / matière
 * première » des listes déroulantes). Contrôles serveur : rôle,
 * catégorie active, nom valide, unicité au sein de la catégorie.
 */
export function createProduct(actor: Actor, input: CreateProductInput): CatalogueProduct {
  requireCatalogueCreate(actor);
  const name = validateProductName(input.nom);
  const db = sessionsDb();
  const type = db
    .prepare('SELECT id, nom FROM product_types WHERE id = ? AND is_active = 1')
    .get(input.typeId) as { id: number; nom: string } | undefined;
  if (!type) {
    throw new ServiceError('Catégorie de produit inconnue ou désactivée.', 400);
  }
  const duplicate = db
    .prepare(
      `SELECT id FROM products
       WHERE product_type_id = ? AND LOWER(TRIM(nom)) = LOWER(?)`,
    )
    .get(type.id, name) as { id: number } | undefined;
  if (duplicate) {
    throw new ServiceError(
      `Ce produit existe déjà dans la catégorie « ${type.nom} ».`,
      409,
    );
  }
  const description = input.description?.trim().slice(0, 255) || '';
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)`,
      )
      .run(name, description, type.id);
    writeAudit(db, {
      action: 'CONFIG_CREATED',
      actorUserId: actor.id,
      details: {
        entity: 'product',
        productId: Number(result.lastInsertRowid),
        nom: name,
        typeId: type.id,
        typeName: type.nom,
      },
    });
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  return { id, nom: name };
}
