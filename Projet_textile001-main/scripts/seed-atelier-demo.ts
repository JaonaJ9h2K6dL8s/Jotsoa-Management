/**
 * Données de démonstration pour l'écran d'optimisation de placement :
 * http://localhost:3000/coupe/preparation
 *
 * À exécuter APRÈS scripts/seed-marker-demo.ts (lot + rouleau + patrons).
 * Aligne le tissu des fiches/patrons sur le rouleau démo et renseigne
 * les dimensions techniques du rouleau (largeur utile, grammage, reste),
 * requises par le calcul du matelas.
 *
 * Usage : npx tsx scripts/seed-atelier-demo.ts
 */
import { initDatabase, closeDb } from '../src/server/db';
import { getDatabasePath } from '../src/server/db/connection';

const db = initDatabase();
console.log('Base :', getDatabasePath());

const FABRIC_REF = 'JERSEY-ROUGE-160';
const ROLL_CODE = 'RO-DEMO-001';

// 1) Produit T-shirt adulte du catalogue Coupe.
const product = db
  .prepare(
    `SELECT p.id, p.nom FROM products p
     JOIN coupe_catalogue c ON c.product_id = p.id
     WHERE c.family = 'tshirt' AND c.category = 'adulte' LIMIT 1`,
  )
  .get() as { id: number; nom: string } | undefined;
if (!product) throw new Error('Produit T-shirt adulte introuvable (lancez seed-marker-demo.ts).');

// 2) Alignement fiches techniques : tissu = référence du rouleau.
const fiches = db
  .prepare('SELECT id FROM fiches_techniques WHERE product_id = ?')
  .all(product.id) as Array<{ id: number }>;
const updateFiche = db.prepare(`
  UPDATE fiches_techniques
  SET fabric_type = ?, grammage_g_m2 = 160, largeur_rouleau_cm = 160,
      largeur_utile_cm = 150, updated_at = datetime('now')
  WHERE id = ?
`);
for (const fiche of fiches) updateFiche.run(FABRIC_REF, fiche.id);
console.log(`Fiches alignées sur ${FABRIC_REF} : ${fiches.length}`);

// 3) Nouvelles révisions alignées sur le tissu du rouleau. Les révisions
// approuvées étant immuables (déclencheur métier), on crée une version
// via les services du projet plutôt que de modifier les anciennes.
const { importRevision, validateRevision } = require('../src/server/coupe/pattern-library') as typeof import('../src/server/coupe/pattern-library');
import type { Actor } from '../src/server/users/users-service';

const chefRow = db
  .prepare("SELECT id FROM users WHERE username = 'chef.coupe' LIMIT 1")
  .get() as { id: number } | undefined;
if (!chefRow) throw new Error('Utilisateur chef.coupe introuvable.');
const actor: Actor = { id: chefRow.id, roleCode: 'chef_coupe' };

function makeFront(w: number, h: number): number[][] {
  return [[0, 0], [w, 0], [w, h * 0.78], [w * 0.8, h], [w * 0.2, h], [0, h * 0.78]];
}
function makeBack(w: number, h: number): number[][] {
  return [[0, 0], [w, 0], [w * 0.96, h * 0.82], [w * 0.8, h], [w * 0.2, h], [w * 0.04, h * 0.82]];
}
function makeSleeve(w: number, h: number): number[][] {
  return [[0, 0], [w, 0], [w * 0.9, h * 0.82], [w * 0.75, h], [w * 0.25, h], [w * 0.1, h * 0.82]];
}
function makeNeckBand(w: number): number[][] {
  return [[0, 0], [w, 0], [w * 0.96, 6], [w * 0.04, 6]];
}

const sizeRows = db
  .prepare(
    `SELECT ls.size_id, s.nom FROM coupe_lot_sizes ls
     JOIN sizes s ON s.id = ls.size_id
     JOIN coupe_lots l ON l.id = ls.lot_id
     WHERE l.code = 'LOT-DEMO-MARKER' ORDER BY s.nom`,
  )
  .all() as Array<{ size_id: number; nom: string }>;
if (sizeRows.length === 0) {
  throw new Error('Lot LOT-DEMO-MARKER introuvable (lancez seed-marker-demo.ts).');
}

let created = 0;
for (const size of sizeRows) {
  const existing = db
    .prepare(
      `SELECT id FROM pattern_revisions
       WHERE product_id = ? AND size_id = ? AND fabric_ref = ? AND status = 'valide' LIMIT 1`,
    )
    .get(product.id, size.size_id, FABRIC_REF) as { id: number } | undefined;
  if (existing) {
    console.log(`Révision ${size.nom} déjà alignée (#${existing.id}).`);
    continue;
  }
  const fiche = db
    .prepare(
      `SELECT id FROM fiches_techniques
       WHERE product_id = ? AND size_id = ? AND statut = 'valide'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(product.id, size.size_id) as { id: number } | undefined;
  if (!fiche) throw new Error(`Fiche validée introuvable pour la taille ${size.nom}.`);

  const w = size.nom === 'M' ? 50 : 54;
  const h = size.nom === 'M' ? 70 : 74;
  const sleeveW = size.nom === 'M' ? 22 : 24;
  const sleeveH = size.nom === 'M' ? 55 : 58;

  const revision = importRevision(actor, {
    ficheId: fiche.id,
    sourceName: 'demo-test-atelier.svg',
    unit: 'cm',
    scaleVerified: true,
    pieces: [
      { code: `DEV_${size.nom}`, label: 'Devant', role: 'devant', component: 'principal', points: makeFront(w, h), width: w, height: h, qty: 1, seamAllowanceCm: 1, grain: 'along', rotations: [0, 180], seamIncluded: true, marks: [] },
      { code: `DOS_${size.nom}`, label: 'Dos', role: 'dos', component: 'principal', points: makeBack(w, h), width: w, height: h, qty: 1, seamAllowanceCm: 1, grain: 'along', rotations: [0, 180], seamIncluded: true, marks: [] },
      { code: `MAN_${size.nom}`, label: 'Manche', role: 'manche', component: 'principal', points: makeSleeve(sleeveW, sleeveH), width: sleeveW, height: sleeveH, qty: 2, seamAllowanceCm: 1, grain: 'along', rotations: [0, 180], seamIncluded: true, marks: [] },
      { code: `ENC_${size.nom}`, label: 'Bande encolure', role: 'autre', component: 'principal', points: makeNeckBand(w), width: w, height: 6, qty: 1, seamAllowanceCm: 1, grain: 'along', rotations: [0, 180], seamIncluded: true, marks: [] },
    ],
  });
  validateRevision(actor, revision.id);
  created += 1;
  console.log(`Nouvelle révision validée ${size.nom} (#${revision.id}) sur ${FABRIC_REF}.`);
}
console.log(`Révisions créées : ${created}`);

// 4) Rouleau démo : contrôle officiel des contraintes (comme via
// l'onglet « Tissu et rouleaux ») puis dimensions techniques.
const { configureRoll } = require('../src/server/coupe/plan-resources') as typeof import('../src/server/coupe/plan-resources');
const roll = db
  .prepare('SELECT id FROM coupe_rolls WHERE code = ?')
  .get(ROLL_CODE) as { id: number } | undefined;
if (!roll) throw new Error(`Rouleau ${ROLL_CODE} introuvable (lancez seed-marker-demo.ts).`);
configureRoll(actor, {
  id: roll.id,
  widthCm: 180,
  usableWidthCm: 160,
  grammageGm2: 160,
  remainingM: 150,
  maxLayers: 12,
  fabricLot: 'LOT-DEMO-TISSU',
  motif: 'uni',
  thicknessMm: '',
  maxMatelasMm: '',
  reviewed: true,
});
db.prepare(`
  UPDATE coupe_rolls SET remaining_weight_kg = 22, status = 'disponible' WHERE id = ?
`).run(roll.id);
console.log(`Rouleau ${ROLL_CODE} contrôlé : utile 160 cm, 160 g/m², reste 150 m, motif uni.`);

// 5) Lot démo : s'assurer que les tailles M/L sont prévues à 16.
const lot = db
  .prepare("SELECT id, color_id FROM coupe_lots WHERE code = 'LOT-DEMO-MARKER'")
  .get() as { id: number; color_id: number } | undefined;
if (lot) {
  const sizes = db
    .prepare(
      `SELECT ls.id, ls.planned_qty FROM coupe_lot_sizes ls
       JOIN sizes s ON s.id = ls.size_id
       WHERE ls.lot_id = ? AND s.nom IN ('M','L')`,
    )
    .all(lot.id) as Array<{ id: number; planned_qty: number }>;
  const updateSize = db.prepare(
    'UPDATE coupe_lot_sizes SET planned_qty = 16 WHERE id = ?',
  );
  for (const size of sizes) {
    if (size.planned_qty !== 16) updateSize.run(size.id);
  }
  console.log(`Lot LOT-DEMO-MARKER (#${lot.id}) : 16 pièces par taille (M, L).`);
} else {
  console.log('Lot LOT-DEMO-MARKER absent — lancez seed-marker-demo.ts.');
}

// 6) Récapitulatif de contrôle.
const check = db
  .prepare(
    `SELECT r.code, r.usable_width_cm, r.grammage_g_m2, r.remaining_qty,
            (SELECT COUNT(*) FROM pattern_revisions pr
              WHERE pr.fabric_ref = r.fabric_ref AND pr.status = 'valide') revisions_ok
     FROM coupe_rolls r WHERE r.code = ?`,
  )
  .get(ROLL_CODE) as {
  code: string;
  usable_width_cm: number;
  grammage_g_m2: number;
  remaining_qty: number;
  revisions_ok: number;
};
console.log('\nDEMO_ATELIER_READY');
console.log(
  `${check.code} · utile ${check.usable_width_cm} cm · ${check.grammage_g_m2} g/m² · reste ${check.remaining_qty} m · ${check.revisions_ok} révision(s) validée(s) compatibles`,
);
console.log('Ouvrez http://localhost:3000/coupe/preparation');
console.log('1. Choisissez LOT-DEMO-MARKER + RO-DEMO-001 → le modèle approuvé apparaît.');
console.log('2. Table + longueur matelas (ex. 450) + couches (ex. 4) → « Générer / optimiser le placement ».');

closeDb();
