import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { requireCoupe, requireId } from './common';

export interface TechnicalProduct {
  id: number;
  nom: string;
  family: 'tshirt' | 'polo' | 'short' | 'jogging' | 'ensemble';
  category: 'adulte' | 'enfant';
  sizes: Array<{ id: number; nom: string }>;
  measurements: string[];
}

export function technicalCatalogue(actor: Actor): TechnicalProduct[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const rows = db.prepare(`SELECT p.id, p.nom, c.family, c.category, c.size_names_json, c.measurement_labels_json
    FROM coupe_catalogue c JOIN products p ON p.id = c.product_id WHERE c.is_active = 1 AND p.is_active = 1 ORDER BY c.category,p.nom`).all() as Array<{
      id: number; nom: string; family: TechnicalProduct['family']; category: TechnicalProduct['category']; size_names_json: string; measurement_labels_json: string;
    }>;
  return rows.map((row) => ({ id: row.id, nom: row.nom, family: row.family, category: row.category,
    sizes: db.prepare(`SELECT s.id,s.nom FROM sizes s JOIN json_each(?) allowed ON s.nom = allowed.value WHERE s.is_active = 1 ORDER BY allowed.key`).all(row.size_names_json) as TechnicalProduct['sizes'],
    measurements: JSON.parse(row.measurement_labels_json) as string[],
  }));
}

export function requireTechnicalProduct(actor: Actor, productId: number, sizeIds: number[] = []): TechnicalProduct {
  const product = technicalCatalogue(actor).find((item) => item.id === requireId(productId, 'Produit'));
  if (!product) throw new ServiceError('Produit absent du catalogue Coupe configuré.', 400);
  if (sizeIds.some((id) => !product.sizes.some((size) => size.id === id))) throw new ServiceError('Taille non configurée pour ce produit et cette catégorie.', 400);
  return product;
}
