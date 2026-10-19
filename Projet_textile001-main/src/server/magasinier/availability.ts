import type Database from 'better-sqlite3';
import type { MgReservableCartonDTO } from '@/types/magasinier';

/**
 * Calcul du stock réservable pour la préparation : disponible (mouvements
 * réels du module Stock) moins les réservations actives du module
 * Magasinier. Jamais deux fois la même quantité : chaque appel exclut
 * les réservations de la commande en cours.
 */

export function availableQty(
  db: Database.Database,
  lotId: number,
  sizeId: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN -qty ELSE qty END), 0) AS total
       FROM st_movements
       WHERE lot_id = ? AND size_id = ?
         AND movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')`,
    )
    .get(lotId, sizeId) as { total: number };
  return row.total;
}

export function activeReserved(
  db: Database.Database,
  lotId: number,
  sizeId: number,
  excludeOrderId?: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(qty), 0) AS total FROM mg_reservations
       WHERE lot_id = ? AND size_id = ? AND status = 'active' AND order_id != COALESCE(?, -1)`,
    )
    .get(lotId, sizeId, excludeOrderId ?? null) as { total: number };
  return row.total;
}

/** Cartons clôturés contenant le produit/taille, avec leur reste réservable. */
export function reservableCartons(
  db: Database.Database,
  orderId: number | null,
  productId: number,
  colorId: number | null,
  sizeId: number,
): MgReservableCartonDTO[] {
  const rows = db
    .prepare(
      `SELECT c.id AS carton_id, c.code AS carton_code, cl.lot_id, l.code AS lot_code,
              cl.size_id, s.nom AS size_label, cl.qty
       FROM st_cartons c
       JOIN st_carton_lines cl ON cl.carton_id = c.id
       JOIN coupe_lots l ON l.id = cl.lot_id
       JOIN sizes s ON s.id = cl.size_id
       WHERE c.status IN ('cloture','partiellement_sorti')
         AND l.product_id = ? AND (? IS NULL OR l.color_id = ?) AND cl.size_id = ?`,
    )
    .all(productId, colorId, colorId, sizeId) as Array<{
    carton_id: number;
    carton_code: string;
    lot_id: number;
    lot_code: string;
    size_id: number;
    size_label: string;
    qty: number;
  }>;
  const result: MgReservableCartonDTO[] = [];
  for (const row of rows) {
    const reservedInCarton = db
      .prepare(
        `SELECT COALESCE(SUM(r.qty), 0) AS total FROM mg_reservations r
         WHERE r.carton_id = ? AND r.lot_id = ? AND r.size_id = ?
           AND r.status = 'active' AND r.order_id != COALESCE(?, -1)`,
      )
      .get(row.carton_id, row.lot_id, row.size_id, orderId ?? null) as { total: number };
    const reservable = row.qty - reservedInCarton.total;
    if (reservable > 0) {
      result.push({
        cartonId: row.carton_id,
        cartonCode: row.carton_code,
        lotId: row.lot_id,
        lotCode: row.lot_code,
        sizeId: row.size_id,
        sizeLabel: row.size_label,
        reservableQty: reservable,
      });
    }
  }
  return result;
}

/** Statut de commande dérivé des quantités préparées. */
export function orderStatusFromTotals(
  ordered: number,
  prepared: number,
): 'en_preparation' | 'partielle' | 'complete' {
  if (prepared >= ordered && ordered > 0) return 'complete';
  if (prepared > 0) return 'partielle';
  return 'en_preparation';
}
