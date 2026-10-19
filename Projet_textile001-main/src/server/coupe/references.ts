import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { requireCoupe } from './common';

/**
 * Références de configuration en lecture seule pour le module Coupe :
 * produits, couleurs et tailles actifs. Utilisées par les formulaires
 * de création de lots — jamais codées en dur dans les composants.
 */

export interface ReferenceOption {
  id: number;
  nom: string;
  extra?: string | null;
}

export function listCoupeReferences(actor: Actor): {
  products: ReferenceOption[];
  colors: ReferenceOption[];
  sizes: ReferenceOption[];
} {
  requireCoupe(actor);
  const db = sessionsDb();
  const products = db
    .prepare('SELECT id, nom FROM products WHERE is_active = 1 ORDER BY nom')
    .all() as ReferenceOption[];
  const colors = db
    .prepare('SELECT id, nom FROM colors WHERE is_active = 1 ORDER BY nom')
    .all() as ReferenceOption[];
  const sizes = db
    .prepare(
      'SELECT id, nom, display_order AS extra FROM sizes WHERE is_active = 1 ORDER BY display_order, id',
    )
    .all() as ReferenceOption[];
  return { products, colors, sizes };
}
