import { sessionsDb } from '@/server/auth/sessions';
import type { PeriodRange } from './periods';
import { dimWhere, type ReportFilters } from './filters';
import { buildPeriodKpi } from './overview';
import { FLOW_SOURCES } from './overview-sources';
import { table, type SectionReport } from './report-types';

/**
 * Rapports Stock, Commandes/Sorties et alertes. Stock disponible =
 * convention du module Stock (Σ mouvements hors transferts, sorties
 * négatives) ; jamais un cumul de productions. Déchets distincts.
 */

export function stockReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  const db = sessionsDb();
  const dim = dimWhere(filters);
  const balances = (
    db
      .prepare(
        `SELECT l.code AS lot, p.nom AS product, col.nom AS color, s.nom AS size,
                COALESCE(SUM(CASE WHEN m.movement_type = 'sortie' THEN -m.qty ELSE m.qty END), 0) AS in_stock
         FROM st_movements m
         JOIN coupe_lots l ON l.id = m.lot_id
         JOIN products p ON p.id = l.product_id
         JOIN colors col ON col.id = l.color_id
         JOIN sizes s ON s.id = m.size_id
         WHERE m.movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')${dim.where}
         GROUP BY m.lot_id, m.size_id HAVING in_stock != 0
         ORDER BY l.code, s.nom LIMIT 400`,
      )
      .all(...dim.args) as Array<{
      lot: string;
      product: string;
      color: string;
      size: string;
      in_stock: number;
    }>
  ).map((row) => ({
    lot: row.lot,
    produit: row.product,
    couleur: row.color,
    taille: row.size,
    'en stock': row.in_stock,
  }));
  const negative = balances.filter((row) => (row['en stock'] as number) < 0);
  const byStatus = (
    db.prepare(
      `SELECT status, COUNT(*) AS n FROM st_cartons GROUP BY status ORDER BY n DESC`,
    ).all() as Array<{ status: string; n: number }>
  ).map((row) => ({ statut: row.status, cartons: row.n }));
  const movements = (
    db
      .prepare(
        `SELECT m.movement_type, COUNT(*) AS n, SUM(m.qty) AS qty
         FROM st_movements m
         JOIN coupe_lots l ON l.id = m.lot_id
         WHERE m.created_at >= ? AND m.created_at < ?${dim.where}
         GROUP BY m.movement_type`,
      )
      .all(current.from, current.to, ...dim.args) as Array<{
      movement_type: string;
      n: number;
      qty: number;
    }>
  ).map((row) => ({
    type: row.movement_type,
    mouvements: row.n,
    quantite: row.qty,
  }));
  const waste = (
    db
      .prepare(
        `SELECT sw.movement_type, sw.unit, COUNT(*) AS n, SUM(sw.qty) AS qty
         FROM st_waste_movements sw
         WHERE sw.created_at >= ? AND sw.created_at < ?
         GROUP BY sw.movement_type, sw.unit`,
      )
      .all(current.from, current.to) as Array<{
      movement_type: string;
      unit: string;
      n: number;
      qty: number;
    }>
  ).map((row) => ({
    type: row.movement_type,
    unite: row.unit,
    mouvements: row.n,
    quantite: row.qty,
  }));
  const inventories = (
    db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM st_inventories GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number }>
  ).map((row) => ({ statut: row.status, 'inventaires': row.n }));
  const tables: SectionReport['tables'] = [
    table(
      'stock_balances',
      'Soldes par lot/taille (stock physique)',
      [
        ['lot', 'Lot'],
        ['produit', 'Produit'],
        ['couleur', 'Couleur'],
        ['taille', 'Taille'],
        ['en stock', 'En stock', true],
      ],
      balances,
      'Convention du module Stock : Σ mouvements (entrées, retours, ajustements) − sorties ; transferts internes exclus.',
    ),
    table(
      'stock_cartons',
      'Cartons par statut',
      [['statut', 'Statut'], ['cartons', 'Cartons', true]],
      byStatus,
      'Nombre de cartons ≠ nombre de pièces.',
    ),
    table(
      'stock_movements',
      'Mouvements de la période',
      [
        ['type', 'Type'],
        ['mouvements', 'Mouvements', true],
        ['quantite', 'Quantité', true],
      ],
      movements,
    ),
    table(
      'stock_inventories',
      'Inventaires',
      [['statut', 'Statut'], ['inventaires', 'Inventaires', true]],
      inventories,
    ),
  ];
  if (waste.length > 0) {
    tables.push(
      table(
        'stock_waste',
        'Déchets textiles (stock distinct)',
        [
          ['type', 'Type'],
          ['unite', 'Unité'],
          ['mouvements', 'Mouvements', true],
          ['quantite', 'Quantité', true],
        ],
        waste,
        'Stock séparé du stock produits finis ; unités réelles, sans conversion.',
      ),
    );
  }
  if (negative.length > 0) {
    tables.unshift(
      table(
        'stock_negative',
        'Incohérences : soldes négatifs',
        [
          ['lot', 'Lot'],
          ['produit', 'Produit'],
          ['taille', 'Taille'],
          ['en stock', 'En stock', true],
        ],
        negative,
        'Solde négatif détecté : incohérence à investiguer, pas un stock disponible.',
      ),
    );
  }
  return tables;
}

export function sortiesReport(
  current: PeriodRange,
  filters: ReportFilters,
): SectionReport['tables'] {
  void filters;
  const db = sessionsDb();
  const orders = (
    db
      .prepare(
        `SELECT o.code, o.status, o.external_order_no,
                (SELECT COUNT(*) FROM mg_order_lines ol WHERE ol.order_id = o.id) AS lines,
                (SELECT COALESCE(SUM(ol.qty_ordered), 0) FROM mg_order_lines ol WHERE ol.order_id = o.id) AS ordered,
                (SELECT COALESCE(SUM(ol.qty_prepared), 0) FROM mg_order_lines ol WHERE ol.order_id = o.id) AS prepared
         FROM mg_orders o
         WHERE o.created_at >= ? AND o.created_at < ?
         ORDER BY o.id DESC LIMIT 300`,
      )
      .all(current.from, current.to) as Array<{
      code: string;
      status: string;
      external_order_no: string | null;
      lines: number;
      ordered: number;
      prepared: number;
    }>
  ).map((row) => ({
    commande: row.code,
    'reference externe': row.external_order_no,
    statut: row.status,
    lignes: row.lines,
    'commandee (pieces)': row.ordered,
    'preparee (pieces)': row.prepared,
  }));
  const sorties = (
    db
      .prepare(
        `SELECT s.code, d.code AS dossier, o.code AS commande, s.status, s.movement_logged,
                s.authorized_at, s.confirmed_at
         FROM sec_sorties s
         JOIN mg_dossiers d ON d.id = s.dossier_id
         JOIN mg_orders o ON o.id = d.order_id
         ORDER BY s.id DESC LIMIT 200`,
      )
      .all() as Array<{
      code: string;
      dossier: string;
      commande: string;
      status: string;
      movement_logged: number;
      authorized_at: string;
      confirmed_at: string | null;
    }>
  ).map((row) => ({
    sortie: row.code,
    dossier: row.dossier,
    commande: row.commande,
    statut: row.status,
    'mouvement stock': row.movement_logged === 1 ? 'oui' : 'non',
    'autorisee le': row.authorized_at?.slice(0, 16) ?? '',
    'confirmee le': row.confirmed_at?.slice(0, 16) ?? '',
  }));
  return [
    table(
      'mg_orders',
      'Commandes importées (période)',
      [
        ['commande', 'Commande'],
        ['reference externe', 'Référence externe'],
        ['statut', 'Statut'],
        ['lignes', 'Lignes', true],
        ['commandee (pieces)', 'Commandée (pièces)', true],
        ['preparee (pieces)', 'Préparée (pièces)', true],
      ],
      orders,
      'Statuts distincts : importée → validée → préparation → soumise → autorisée → confirmée.',
    ),
    table(
      'sec_sorties',
      'Sorties d’usine',
      [
        ['sortie', 'Sortie'],
        ['dossier', 'Dossier'],
        ['commande', 'Commande'],
        ['statut', 'Statut'],
        ['mouvement stock', 'Mouvement stock'],
        ['autorisee le', 'Autorisée le'],
        ['confirmee le', 'Confirmée le'],
      ],
      sorties,
      'Autorisée ≠ confirmée : le mouvement définitif de stock n’existe qu’à la confirmation.',
    ),
  ];
}

export function stockKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['stock_entrees', 'stock_sorties'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}

export function sortiesKpis(current: PeriodRange, previous: PeriodRange, filters: ReportFilters) {
  const keys = ['sorties_confirmees'];
  return FLOW_SOURCES.filter((source) => keys.includes(source.key)).map((source) =>
    buildPeriodKpi(source, current, previous, filters),
  );
}
