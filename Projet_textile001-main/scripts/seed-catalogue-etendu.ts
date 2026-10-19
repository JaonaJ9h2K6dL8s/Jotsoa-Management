/**
 * Seed du catalogue étendu (cahier §2) — tailles enfant 2 à 12 ans,
 * produits T-shirt enfant, Short enfant, Jogging (adulte/enfant) et
 * Ensemble enfant (haut + short sous une même référence), avec leurs
 * patrons indicatifs paramétriques (§4 : valeurs indicatives à faire
 * valider par l'entreprise — jamais des dimensions officielles).
 *
 * Idempotent : chaque insertion est protégée par une vérification
 * d'existence. Schéma réel lu via PRAGMA (colonnes optionnelles).
 *
 * Lancer : npm run seed:catalogue
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), 'data', 'jo-management.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

interface SizeRow {
  id: number;
  nom: string;
}
interface ProductRow {
  id: number;
  nom: string;
}

const ENFANT_SIZES: Array<[string, number]> = [
  ['2 ans', 20],
  ['4 ans', 21],
  ['6 ans', 22],
  ['8 ans', 23],
  ['10 ans', 24],
  ['12 ans', 25],
];

/** Dimensions indicatives (cm) : [largeur poitrine à plat, longueur]. */
const ENFANT_DIMS: Record<string, [number, number]> = {
  '2 ans': [30, 38],
  '4 ans': [33, 43],
  '6 ans': [36, 48],
  '8 ans': [39, 53],
  '10 ans': [42, 58],
  '12 ans': [45, 63],
};

const ADULTE_DIMS: Record<string, [number, number]> = {
  S: [48, 68],
  M: [51, 71],
  L: [54, 74],
  XL: [57, 77],
};

interface PieceDef {
  code: string;
  label: string;
  w: number;
  h: number;
  multiplier: number;
  points: Array<[number, number]>;
}

/** Contours paramétriques (cm, repère haut-gauche) — indicative §4. */
function tshirtBody(w: number, l: number, front: boolean): PieceDef['points'] {
  const neck = front ? 2.5 : 1.5;
  return [
    [0, 0],
    [w * 0.32, 0],
    [w * 0.42, neck],
    [w * 0.58, neck],
    [w * 0.68, 0],
    [w, 0],
    [w, l * 0.92],
    [w * 0.88, l],
    [w * 0.12, l],
    [0, l * 0.92],
  ];
}
function sleeve(w: number, l: number): PieceDef['points'] {
  return [
    [0, 0],
    [w * 0.8, 0],
    [w, l * 0.35],
    [w * 0.85, l],
    [w * 0.1, l],
    [0, l * 0.4],
  ];
}
function shortBody(w: number, l: number): PieceDef['points'] {
  return [
    [0, 0],
    [w, 0],
    [w, l * 0.75],
    [w * 0.6, l],
    [w * 0.4, l],
    [0, l * 0.75],
  ];
}
function jogBody(w: number, l: number): PieceDef['points'] {
  return [
    [0, 0],
    [w, 0],
    [w * 0.82, l * 0.85],
    [w * 0.74, l],
    [w * 0.26, l],
    [w * 0.18, l * 0.85],
  ];
}
function rect(w: number, h: number): PieceDef['points'] {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}
function piece(
  code: string,
  label: string,
  w: number,
  h: number,
  multiplier: number,
  points: PieceDef['points'],
): PieceDef {
  return { code, label, w, h, multiplier, points };
}

/** Patrons d'un produit pour une taille [largeur, longueur] (cm). */
function piecesFor(productNom: string, [w, l]: [number, number]): PieceDef[] {
  const sw = w * 0.45;
  const sh = l * 0.32;
  const sl = l * 0.62;
  switch (productNom) {
    case 'T-shirt enfant':
      return [
        piece('D', 'Devant', w, l, 1, tshirtBody(w, l, true)),
        piece('B', 'Dos', w, l, 1, tshirtBody(w, l, false)),
        piece('M', 'Manche', sw, sh, 2, sleeve(sw, sh)),
        piece('C', 'Bande encolure', w * 0.9, 4, 1, rect(w * 0.9, 4)),
      ];
    case 'Short enfant':
      return [
        piece('D', 'Devant', w, sl, 1, shortBody(w, sl)),
        piece('B', 'Dos', w, sl, 1, shortBody(w, sl)),
        piece('CE', 'Ceinture', w * 0.92, 4, 1, rect(w * 0.92, 4)),
      ];
    case 'Jogging':
    case 'Jogging enfant':
      return [
        piece('D', 'Devant', w, l, 1, jogBody(w, l)),
        piece('B', 'Dos', w, l, 1, jogBody(w, l)),
        piece('CE', 'Ceinture', w * 0.92, 5, 1, rect(w * 0.92, 5)),
        piece('PO', 'Poignet', w * 0.34, 6, 2, rect(w * 0.34, 6)),
      ];
    case 'Ensemble enfant':
      return [
        piece('H-D', 'Haut — Devant', w, l, 1, tshirtBody(w, l, true)),
        piece('H-B', 'Haut — Dos', w, l, 1, tshirtBody(w, l, false)),
        piece('H-M', 'Haut — Manche', sw, sh, 2, sleeve(sw, sh)),
        piece('B-D', 'Bas — Devant', w * 0.9, sl, 1, shortBody(w * 0.9, sl)),
        piece('B-B', 'Bas — Dos', w * 0.9, sl, 1, shortBody(w * 0.9, sl)),
        piece('B-CE', 'Bas — Ceinture', w * 0.85, 4, 1, rect(w * 0.85, 4)),
      ];
    default:
      return [];
  }
}

const NEW_PRODUCTS: Array<{ nom: string; enfant: boolean; dims: Record<string, [number, number]> }> = [
  { nom: 'T-shirt enfant', enfant: true, dims: ENFANT_DIMS },
  { nom: 'Short enfant', enfant: true, dims: ENFANT_DIMS },
  { nom: 'Jogging', enfant: false, dims: ADULTE_DIMS },
  { nom: 'Jogging enfant', enfant: true, dims: ENFANT_DIMS },
  { nom: 'Ensemble enfant', enfant: true, dims: ENFANT_DIMS },
];

function columnsOf(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function insertFlexible(
  table: string,
  values: Record<string, string | number | null>,
): number {
  const cols = columnsOf(table);
  const names = Object.keys(values).filter((c) => cols.has(c));
  const placeholders = names.map(() => '?').join(', ');
  const info = db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`,
    )
    .run(...names.map((n) => values[n]));
  return Number(info.lastInsertRowid);
}

function main(): void {
  const seedAll = db.transaction(() => {
    // 1) Tailles enfant paires 2 → 12 ans (§2.B).
    for (const [nom, order] of ENFANT_SIZES) {
      const exists = db.prepare('SELECT id FROM sizes WHERE nom = ?').get(nom);
      if (!exists) {
        const cols = columnsOf('sizes');
        const values: Record<string, string | number> = { nom, is_active: 1 };
        if (cols.has('display_order')) values.display_order = order;
        insertFlexible('sizes', values);
        console.log(`Taille ajoutée : ${nom}`);
      }
    }

    // 2) Types de produits : enfant (référencé par le marker) + adulte.
    let childType = db
      .prepare("SELECT id FROM product_types WHERE nom = 'Vêtements pour enfants'")
      .get() as { id: number } | undefined;
    if (!childType) {
      childType = {
        id: insertFlexible('product_types', {
          nom: 'Vêtements pour enfants',
          description: 'T-shirts, shorts, joggings et ensembles enfant.',
          is_active: 1,
          display_order: 2,
        }),
      };
      console.log('Type « Vêtements pour enfants » ajouté.');
    }
    const tshirtAdulte = db
      .prepare("SELECT product_type_id AS tid FROM products WHERE nom = 'T-shirt' LIMIT 1")
      .get() as { tid: number } | undefined;
    const adultTypeId =
      tshirtAdulte?.tid ??
      insertFlexible('product_types', {
        nom: 'Vêtements adulte',
        description: 'T-shirts, polos, shorts et joggings adulte.',
        is_active: 1,
        display_order: 1,
      });

    // 3) Produits du catalogue étendu (§2).
    const products: ProductRow[] = [];
    for (const def of NEW_PRODUCTS) {
      const exists = db.prepare('SELECT id, nom FROM products WHERE nom = ?').get(def.nom) as
        | ProductRow
        | undefined;
      if (exists) {
        products.push(exists);
        continue;
      }
      const id = insertFlexible('products', {
        nom: def.nom,
        product_type_id: def.enfant ? childType.id : adultTypeId,
        is_active: 1,
      });
      products.push({ id, nom: def.nom });
      console.log(`Produit ajouté : ${def.nom}`);
    }

    // 4) Patrons indicatifs par produit × taille (§4-§5).
    let inserted = 0;
    for (const product of products) {
      const def = NEW_PRODUCTS.find((p) => p.nom === product.nom);
      if (!def) continue;
      const category = def.enfant ? 'enfant' : 'adulte';
      for (const [sizeNom, dims] of Object.entries(def.dims)) {
        const size = db.prepare('SELECT id FROM sizes WHERE nom = ?').get(sizeNom) as
          | SizeRow
          | undefined;
        if (!size) continue;
        for (const p of piecesFor(product.nom, dims)) {
          const dup = db
            .prepare(
              `SELECT id FROM pattern_pieces
               WHERE product_id = ? AND size_id = ? AND piece_code = ? AND version = 'v1'`,
            )
            .get(product.id, size.id, p.code);
          if (dup) continue;
          insertFlexible('pattern_pieces', {
            product_id: product.id,
            category,
            piece_code: p.code,
            piece_label: p.label,
            size_id: size.id,
            version: 'v1',
            geometry_json: JSON.stringify({ points: p.points, unit: 'cm' }),
            width_cm: Number(p.w.toFixed(1)),
            height_cm: Number(p.h.toFixed(1)),
            qty_multiplier: p.multiplier,
            grain_direction: 'along',
            allowed_rotations: JSON.stringify([0, 180]),
            seam_allowance_cm: 1,
            is_validated: 1,
            notes:
              'Valeurs indicatives (§4) — dimensions officielles à saisir et faire valider par l’entreprise.',
          });
          inserted += 1;
        }
      }
    }
    console.log(`Patrons indicatifs insérés : ${inserted}`);
  });

  seedAll();
  console.log('CATALOGUE_ETENDU_OK');
  db.close();
}

main();
