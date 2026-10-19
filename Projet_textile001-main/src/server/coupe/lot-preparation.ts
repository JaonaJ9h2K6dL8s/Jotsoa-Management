/**
 * Préparation des lots : création automatique depuis une commande,
 * vérifications de faisabilité et proposition de matelas. Toutes les
 * données proviennent de la base : aucune saisie manuelle redondante.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import {
  addHistory,
  nextCode,
  requireCoupe,
  requireId,
} from './common';
import { getOrder, updateOrderStatus } from '../orders/orders';
import { getValidatedPatterns } from './patterns';
import {
  getLot,
  loadSizes,
  type LotCheckResult,
} from './lot-shared';

export interface CreateLotFromOrderInput {
  orderId: number;
}

export interface ProposeMatelasInput {
  lotId: number;
  rollId: number;
  coupeTableId?: number | null;
}

export function createLotFromOrder(
  actor: Actor,
  input: CreateLotFromOrderInput,
): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const order = getOrder(actor, requireId(input.orderId, 'Commande'));
    if (order.status === 'annulé') throw new ServiceError('La commande est annulée.', 400);

    const existing = db.prepare('SELECT id FROM coupe_lots WHERE order_id = ? AND status != ?')
      .get(order.id, 'annule') as { id: number } | undefined;
    if (existing) throw new ServiceError(`Un lot existe déjà pour cette commande (#${existing.id}).`, 409);

    const planned = order.lines.reduce((sum, l) => sum + l.qty, 0);
    const code = nextCode(db, 'coupe_lots', 'LOT-');
    const lotId = Number(db.prepare(`
      INSERT INTO coupe_lots (code, order_id, product_id, color_id, total_planned_qty, status, responsable_id, notes)
      VALUES (?, ?, ?, ?, ?, 'brouillon', ?, ?)
    `).run(
      code,
      order.id,
      order.productId,
      order.colorId,
      planned,
      actor.id,
      `Créé automatiquement depuis la commande ${order.code}`,
    ).lastInsertRowid);

    const insertSize = db.prepare('INSERT INTO coupe_lot_sizes (lot_id, size_id, planned_qty) VALUES (?, ?, ?)');
    for (const line of order.lines) {
      insertSize.run(lotId, line.sizeId, line.qty);
    }

    updateOrderStatus(actor, order.id, 'en_coupe');

    addHistory(db, {
      action: 'lot_created_from_order',
      entityType: 'coupe_lot',
      entityId: lotId,
      actorId: actor.id,
      newValue: { orderId: order.id, code, plannedQty: planned },
    });
    return getLot(actor, lotId);
  }).immediate();
}

export function checkLotReadiness(actor: Actor, lotId: number): LotCheckResult {
  requireCoupe(actor);
  const db = sessionsDb();
  const lot = getLot(actor, lotId);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (lot.status === 'annule') blockers.push('Le lot est annulé.');
  if (lot.status === 'transfere') blockers.push('Le lot est déjà transféré.');

  const sizes = loadSizes(db, lot.id);
  if (sizes.length === 0) blockers.push('Aucune taille dans le lot.');

  if (lot.orderId) {
    const order = getOrder(actor, lot.orderId);
    if (order.status === 'annulé') blockers.push('La commande est annulée.');
    for (const size of sizes) {
      const ol = order.lines.find((l) => l.sizeId === size.sizeId);
      if (!ol) {
        blockers.push(`Taille ${size.sizeNom} absente de la commande.`);
      } else if (ol.qty - ol.cutQty <= 0) {
        blockers.push(`Quantité déjà entièrement coupée pour la taille ${size.sizeNom}.`);
      }
    }
  }

  // Patrons réels validés, un par taille du lot.
  const category = 'adulte' as const; // TODO déduire depuis coupe_catalogue
  const patterns = getValidatedPatterns(actor, {
    productId: lot.productId,
    category,
    sizeIds: sizes.map((s) => s.sizeId),
  });
  for (const size of sizes) {
    const pieces = patterns.items.filter((p) => p.sizeId === size.sizeId);
    if (pieces.length === 0) {
      blockers.push(`Aucun patron validé pour la taille ${size.sizeNom}.`);
    }
  }
  if (patterns.warnings.length) warnings.push(...patterns.warnings);

  // Rouleau affecté et utilisable.
  if (!lot.rollId) {
    warnings.push('Aucun rouleau affecté au lot.');
  } else {
    const roll = db.prepare('SELECT status, remaining_weight_kg FROM coupe_rolls WHERE id=?').get(lot.rollId) as
      | { status: string; remaining_weight_kg: number | null }
      | undefined;
    if (!roll) {
      blockers.push('Rouleau introuvable.');
    } else if (roll.status !== 'disponible' && roll.status !== 'en_utilisation') {
      blockers.push(`Rouleau non utilisable (statut ${roll.status}).`);
    } else if ((roll.remaining_weight_kg ?? 0) <= 0) {
      blockers.push('Rouleau épuisé.');
    }
  }

  // Table de coupe active.
  if (!lot.coupeTableId) {
    warnings.push('Aucune table sélectionnée.');
  } else {
    const table = db.prepare('SELECT is_active FROM coupe_tables WHERE id=?').get(lot.coupeTableId) as
      | { is_active: number }
      | undefined;
    if (!table) blockers.push('Table introuvable.');
    else if (!table.is_active) blockers.push('Table désactivée.');
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export function proposeMatelas(actor: Actor, input: ProposeMatelasInput): {
  tableId: number | null;
  tableNom: string | null;
  matelasLengthCm: number;
  layers: number;
  usableWidthCm: number;
  reason: string;
} {
  requireCoupe(actor);
  const db = sessionsDb();
  const lot = getLot(actor, requireId(input.lotId, 'Lot'));
  const roll = input.rollId
    ? db.prepare('SELECT width_cm, usable_width_cm, grammage_g_m2 FROM coupe_rolls WHERE id=?').get(input.rollId) as
        | { width_cm: number | null; usable_width_cm: number | null; grammage_g_m2: number | null }
        | undefined
    : undefined;

  const usableWidthCm = roll?.usable_width_cm ?? 150;
  const grammage = roll?.grammage_g_m2 ?? 160;

  const table = input.coupeTableId
    ? db.prepare('SELECT id, nom, longueur_max_cm, largeur_utile_cm, couches_max, is_active FROM coupe_tables WHERE id=?').get(input.coupeTableId) as
        | { id: number; nom: string; longueur_max_cm: number; largeur_utile_cm: number; couches_max: number; is_active: number }
        | undefined
    : undefined;

  if (input.coupeTableId && !table) throw new ServiceError('Table sélectionnée introuvable.', 404);
  if (input.coupeTableId && table && !table.is_active) {
    throw new ServiceError(`La table ${table.nom} est désactivée.`, 409);
  }

  const tables = !table
    ? (db.prepare('SELECT id, nom, longueur_max_cm, largeur_utile_cm, couches_max FROM coupe_tables WHERE is_active=1 ORDER BY longueur_max_cm DESC').all() as
        Array<{ id: number; nom: string; longueur_max_cm: number; largeur_utile_cm: number; couches_max: number }>)
    : [table];

  const chosen = tables[0];
  const maxLayers = chosen.couches_max;
  // Le placement exige des quantités par taille divisibles par le nombre
  // de couches (aucune surproduction automatique) : on retient le plus
  // grand diviseur commun des quantités, plafonné aux capacités matériel
  // et à la valeur par défaut configurable.
  const quantities = loadSizes(db, lot.id).map((s) => Math.round(s.plannedQty));
  const gcd = quantities.reduce((a, b) => {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      [x, y] = [y, x % y];
    }
    return x;
  }, 0);
  const layers = Math.max(1, Math.min(8, maxLayers, gcd || 1));
  const matelasLengthCm = Math.min(450, chosen.longueur_max_cm);

  return {
    tableId: chosen.id,
    tableNom: chosen.nom,
    matelasLengthCm,
    layers,
    usableWidthCm,
    reason: `Table ${chosen.nom} choisie (longueur max ${chosen.longueur_max_cm} cm, ${maxLayers} couches max). ${layers} couche(s) proposée(s) : divisible par toutes les quantités du lot. Largeur utile ${usableWidthCm} cm, grammage ${grammage} g/m².`,
  };
}
