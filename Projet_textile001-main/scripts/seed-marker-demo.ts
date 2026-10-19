/**
 * Données de démonstration pour tester l'écran Marker à
 * http://localhost:3000/coupe/marker
 *
 * Crée dans la base de développement :
 * - fiches techniques validées (T-shirt adulte M/L)
 * - révisions de patrons validées avec contours polygonaux de test
 * - un rouleau de tissu disponible
 * - un lot de coupe en brouillon lié au produit
 *
 * Usage :
 *   npx tsx scripts/seed-marker-demo.ts
 *
 * Les contours sont synthétiques et explicitement marqués comme de test
 * (pas des patrons industriels réels).
 */
import { initDatabase, closeDb } from '../src/server/db';
import { getDatabasePath } from '../src/server/db/connection';
import { hashPassword } from '../src/server/auth/passwords';
import type { Actor } from '../src/server/users/users-service';

const db = initDatabase();
console.log('Base :', getDatabasePath());

// Récupère ou crée un utilisateur chef de coupe.
function getOrCreateChef(): Actor {
  let row = db
    .prepare("SELECT id, role_id FROM users WHERE username = 'chef.coupe'")
    .get() as { id: number; role_id: number } | undefined;
  if (!row) {
    const role = db
      .prepare("SELECT id FROM roles WHERE code = 'chef_coupe'")
      .get() as { id: number };
    const id = Number(
      db
        .prepare(
          `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
           VALUES ('Coupe', 'Chef', 'chef.coupe', ?, ?, 1, 0)`,
        )
        .run(hashPassword('Chef-2026!'), role.id).lastInsertRowid,
    );
    row = { id, role_id: role.id };
  }
  return { id: row.id, roleCode: 'chef_coupe' };
}

const actor = getOrCreateChef();

// Contours polygonaux synthétiques (non industriels) pour un T-shirt adulte.
function makeFront(w: number, h: number): number[][] {
  return [
    [0, 0],
    [w, 0],
    [w, h * 0.78],
    [w * 0.8, h],
    [w * 0.2, h],
    [0, h * 0.78],
  ];
}
function makeBack(w: number, h: number): number[][] {
  return [
    [0, 0],
    [w, 0],
    [w * 0.96, h * 0.82],
    [w * 0.8, h],
    [w * 0.2, h],
    [w * 0.04, h * 0.82],
  ];
}
function makeSleeve(w: number, h: number): number[][] {
  return [
    [0, 0],
    [w, 0],
    [w * 0.9, h * 0.82],
    [w * 0.75, h],
    [w * 0.25, h],
    [w * 0.1, h * 0.82],
  ];
}
function makeNeckBand(w: number, _h: number): number[][] {
  return [
    [0, 0],
    [w, 0],
    [w * 0.96, 6],
    [w * 0.04, 6],
  ];
}

function seed() {
  const chefId = actor.id;

  // Produit : T-shirt adulte.
  const product = db
    .prepare(
      `SELECT p.id, p.nom FROM products p
       JOIN coupe_catalogue c ON c.product_id = p.id
       WHERE c.family = 'tshirt' AND c.category = 'adulte'
       LIMIT 1`,
    )
    .get() as { id: number; nom: string } | undefined;
  if (!product) {
    throw new Error('Produit T-shirt adulte introuvable dans le catalogue.');
  }

  // Tailles M et L.
  const sizeRows = db
    .prepare(
      `SELECT id, nom FROM sizes
       WHERE nom IN ('M','L') AND is_active = 1
       ORDER BY display_order`,
    )
    .all() as Array<{ id: number; nom: string }>;
  if (sizeRows.length < 2) {
    throw new Error('Tailles M et L requises pour la démo.');
  }

  const color = db
    .prepare("SELECT id, nom FROM colors WHERE is_active = 1 LIMIT 1")
    .get() as { id: number; nom: string } | undefined;
  if (!color) throw new Error('Aucune couleur active.');

  // Import dynamique des services métier.
  const { saveFiche, validateFiche } = require('../src/server/coupe/fiches') as typeof import('../src/server/coupe/fiches');
  const { importRevision, validateRevision } = require('../src/server/coupe/pattern-library') as typeof import('../src/server/coupe/pattern-library');
  const { createRoll } = require('../src/server/coupe/rolls') as typeof import('../src/server/coupe/rolls');
  const { createLot } = require('../src/server/coupe/lots') as typeof import('../src/server/coupe/lots');

  // Fiches + révisions par taille.
  const revisionIds: number[] = [];
  for (const size of sizeRows) {
    const existingFiche = db
      .prepare(
        `SELECT id FROM fiches_techniques
         WHERE product_id = ? AND size_id = ? AND color_nom = ? AND statut = 'valide'
         LIMIT 1`,
      )
      .get(product.id, size.id, color.nom) as { id: number } | undefined;

    let ficheId: number;
    if (existingFiche) {
      ficheId = existingFiche.id;
      console.log(`Fiche existante réutilisée : ${size.nom} (#${ficheId})`);
    } else {
      const fiche = saveFiche(actor, {
        productId: product.id,
        sizeId: size.id,
        colorNom: color.nom,
        modele: 'Regular',
        coupe: 'Regular',
        fabricType: 'Jersey',
        composition: 'Coton',
        grammageGm2: 160,
        largeurRouleauCm: 160,
        largeurUtileCm: 150,
        elasticite: 'Trame',
        droitFil: 'Longueur',
        mesures: [
          { label: 'Poitrine à plat', valeurCm: size.nom === 'M' ? 52 : 56 },
          { label: 'Longueur totale', valeurCm: size.nom === 'M' ? 70 : 74 },
          { label: 'Épaules', valeurCm: size.nom === 'M' ? 44 : 46 },
          { label: 'Longueur manche', valeurCm: size.nom === 'M' ? 24 : 25 },
        ],
        confection: { valeursCoutureCm: 1, consignes: 'Demo seed' },
      });
      validateFiche(actor, fiche.id);
      ficheId = fiche.id;
      console.log(`Fiche créée et validée : ${size.nom} (#${ficheId})`);
    }

    const existingRevision = db
      .prepare(
        `SELECT id FROM pattern_revisions
         WHERE fiche_id = ? AND status = 'valide' LIMIT 1`,
      )
      .get(ficheId) as { id: number } | undefined;

    if (existingRevision) {
      revisionIds.push(existingRevision.id);
      console.log(`Révision existante réutilisée : ${size.nom} (#${existingRevision.id})`);
      continue;
    }

    const w = size.nom === 'M' ? 50 : 54;
    const h = size.nom === 'M' ? 70 : 74;
    const sleeveW = size.nom === 'M' ? 22 : 24;
    const sleeveH = size.nom === 'M' ? 55 : 58;

    const revision = importRevision(actor, {
      ficheId,
      sourceName: 'demo-test.svg',
      unit: 'cm',
      scaleVerified: true,
      pieces: [
        {
          code: `DEV_${size.nom}`,
          label: 'Devant',
          role: 'devant',
          component: 'principal',
          points: makeFront(w, h),
          width: w,
          height: h,
          qty: 1,
          seamAllowanceCm: 1,
          grain: 'along',
          rotations: [0, 180],
          seamIncluded: true,
          marks: [],
        },
        {
          code: `DOS_${size.nom}`,
          label: 'Dos',
          role: 'dos',
          component: 'principal',
          points: makeBack(w, h),
          width: w,
          height: h,
          qty: 1,
          seamAllowanceCm: 1,
          grain: 'along',
          rotations: [0, 180],
          seamIncluded: true,
          marks: [],
        },
        {
          code: `MAN_${size.nom}`,
          label: 'Manche',
          role: 'manche',
          component: 'principal',
          points: makeSleeve(sleeveW, sleeveH),
          width: sleeveW,
          height: sleeveH,
          qty: 2,
          seamAllowanceCm: 1,
          grain: 'along',
          rotations: [0, 180],
          seamIncluded: true,
          marks: [],
        },
        {
          code: `ENC_${size.nom}`,
          label: 'Bande encolure',
          role: 'autre',
          component: 'principal',
          points: makeNeckBand(w, 6),
          width: w,
          height: 6,
          qty: 1,
          seamAllowanceCm: 1,
          grain: 'along',
          rotations: [0, 180],
          seamIncluded: true,
          marks: [],
        },
      ],
    });
    validateRevision(actor, revision.id);
    revisionIds.push(revision.id);
    console.log(`Révision créée et validée : ${size.nom} (#${revision.id})`);
  }

  // Rouleau de tissu.
  let rollId: number;
  const existingRoll = db
    .prepare("SELECT id FROM coupe_rolls WHERE code = 'RO-DEMO-001'")
    .get() as { id: number } | undefined;
  if (existingRoll) {
    rollId = existingRoll.id;
    console.log(`Rouleau existant réutilisé (#${rollId})`);
  } else {
    const roll = createRoll(actor, {
      code: 'RO-DEMO-001',
      fabricRef: 'JERSEY-ROUGE-160',
      colorId: color.id,
      initialWeightKg: 25,
      observations: 'Rouleau démo pour Marker',
    });
    rollId = roll.id;
    console.log(`Rouleau créé (#${rollId})`);
  }

  // Lot de coupe.
  let lotId: number;
  const existingLot = db
    .prepare("SELECT id FROM coupe_lots WHERE code = 'LOT-DEMO-MARKER'")
    .get() as { id: number } | undefined;
  if (existingLot) {
    lotId = existingLot.id;
    console.log(`Lot existant réutilisé (#${lotId})`);
  } else {
    const lot = createLot(actor, {
      code: 'LOT-DEMO-MARKER',
      productId: product.id,
      colorId: color.id,
      sizes: sizeRows.map((s) => ({ sizeId: s.id, plannedQty: 16 })),
      notes: 'Lot démo pour tester le Marker',
    });
    lotId = lot.id;
    console.log(`Lot créé (#${lotId})`);
  }

  console.log('\nDEMO_READY');
  console.log(`Ouvrez http://localhost:3000/coupe/marker`);
  console.log(`Lot : LOT-DEMO-MARKER | Rouleau : RO-DEMO-001`);
  console.log(`Tailles : ${sizeRows.map((s) => s.nom).join(', ')}`);
  console.log(`Révisions validées : ${revisionIds.join(', ')}`);
}

seed();
closeDb();
