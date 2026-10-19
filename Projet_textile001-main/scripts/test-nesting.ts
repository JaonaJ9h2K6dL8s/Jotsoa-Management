/**
 * Test du moteur de marker : charge les patrons d'un produit de la base
 * scratch, calcule un placement et vérifie les indicateurs (cahier §9).
 * Base isolée — aucune donnée réelle touchée.
 * Les patrons et fiches de test sont créés par le script (données synthétiques
 * explicitement marquées comme de test, non des patrons industriels réels).
 */
import Database from 'better-sqlite3';
import { runMigrations } from '../src/server/db/migrate';
import { hashPassword } from '../src/server/auth/passwords';
import type { Actor } from '../src/server/users/users-service';

const DB_PATH = './data/scratch-nesting.db';
for (const suffix of ['', '-wal', '-shm']) {
  const p = DB_PATH + suffix;
  if (fsExists(p)) fsUnlink(p);
}
function fsExists(p: string): boolean {
  return require('node:fs').existsSync(p);
}
function fsUnlink(p: string): void {
  require('node:fs').unlinkSync(p);
}

process.env.DATABASE_PATH = DB_PATH;

const db = new Database(DB_PATH);
runMigrations(db);

// Compte chef de coupe pour l'acteur.
const role = db.prepare('SELECT id FROM roles WHERE code=?').get('chef_coupe') as { id: number };
const chefId = Number(
  db
    .prepare(
      `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
       VALUES ('Test','Nesting','probe-nesting',?,?,1,0)`,
    )
    .run(hashPassword('Probe-2026!'), role.id).lastInsertRowid,
);
const actor: Actor = { id: chefId, roleCode: 'chef_coupe' };

const QTY_PER_SIZE = 8;

// Données de test : contours polygonaux synthétiques (non industriels).
function makeFront(width: number, height: number): number[][] {
  return [
    [0, 0],
    [width, 0],
    [width, height * 0.78],
    [width * 0.8, height],
    [width * 0.2, height],
    [0, height * 0.78],
  ];
}
function makeBack(width: number, height: number): number[][] {
  return [
    [0, 0],
    [width, 0],
    [width * 0.96, height * 0.82],
    [width * 0.8, height],
    [width * 0.2, height],
    [width * 0.04, height * 0.82],
  ];
}
function makeSleeve(width: number, height: number): number[][] {
  return [
    [0, 0],
    [width, 0],
    [width * 0.9, height * 0.82],
    [width * 0.75, height],
    [width * 0.25, height],
    [width * 0.1, height * 0.82],
  ];
}
function makeNeckBand(width: number, height: number): number[][] {
  return [
    [0, 0],
    [width, 0],
    [width * 0.96, height],
    [width * 0.04, height],
  ];
}

async function seedTestPatterns() {
  const { saveFiche, validateFiche } = await import('../src/server/coupe/fiches');
  const { importRevision, validateRevision } = await import('../src/server/coupe/pattern-library');

  const product = db
    .prepare(
      `SELECT p.id, p.nom FROM products p
       JOIN coupe_catalogue c ON c.product_id = p.id
       WHERE p.nom='T-shirt' AND c.family='tshirt' AND c.category='adulte' AND p.is_active=1
       LIMIT 1`,
    )
    .get() as { id: number; nom: string } | undefined;
  if (!product) throw new Error('Produit T-shirt absent de la base scratch');

  const sizeRows = db
    .prepare("SELECT id, nom FROM sizes WHERE nom IN ('M','L') ORDER BY display_order")
    .all() as Array<{ id: number; nom: string }>;

  for (const size of sizeRows) {
    const fiche = saveFiche(actor, {
      productId: product.id,
      sizeId: size.id,
      colorNom: 'Rouge',
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
        { label: 'Poitrine à plat', valeurCm: 52 },
        { label: 'Longueur totale', valeurCm: 70 },
        { label: 'Épaules', valeurCm: 44 },
        { label: 'Longueur manche', valeurCm: 24 },
      ],
      confection: { valeursCoutureCm: 1, consignes: 'Test' },
    });
    validateFiche(actor, fiche.id);

    const w = size.nom === 'M' ? 50 : 54;
    const h = size.nom === 'M' ? 70 : 74;
    const sleeveW = size.nom === 'M' ? 22 : 24;
    const sleeveH = size.nom === 'M' ? 55 : 58;
    const neckW = size.nom === 'M' ? 50 : 54;

    const revision = importRevision(actor, {
      ficheId: fiche.id,
      sourceName: 'test-dummy.svg',
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
          points: makeNeckBand(neckW, 6),
          width: neckW,
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
  }

  return { product, sizeRows };
}

async function main() {
  const { getValidatedPatterns } = await import('../src/server/coupe/patterns');
  const { computeMarker } = await import('../src/server/coupe/nesting');

  const { product, sizeRows } = await seedTestPatterns();

  const { items, warnings } = getValidatedPatterns(actor, {
    productId: product.id,
    category: 'adulte',
    sizeIds: sizeRows.map((s) => s.id),
  });
  console.log(`PATRONS: ${items.length} (attendu >= 12 : 4 pièces × 2 tailles)`);
  console.log(`AVERTISSEMENTS: ${warnings.length}`);
  if (warnings.length) warnings.forEach((w) => console.log('  -', w));

  const result = computeMarker(actor, {
    productId: product.id,
    category: 'adulte',
    sizes: sizeRows.map((s) => ({ sizeId: s.id, qty: QTY_PER_SIZE })),
    usableWidthCm: 150,
    matelasLengthCm: 450,
    layers: 8,
    gapCm: 1,
    grammageGm2: 160,
  });

  // Vérifications métier (§9).
  const expectedPiecesPerLayer = sizeRows.reduce(
    (acc, s) =>
      acc +
      (QTY_PER_SIZE / 8) *
        items
          .filter((p) => p.sizeId === s.id)
          .reduce((m, p) => m + p.qtyMultiplier, 0),
    0,
  );

  const checks: Array<[string, boolean]> = [
    ['Placements non vides', result.placements.length > 0],
    [
      'Pièces/couche = somme (qté × multiplicateur)',
      result.totalPiecesPerLayer === expectedPiecesPerLayer,
    ],
    ['Total toutes couches = × couches', result.totalPiecesAllLayers === result.totalPiecesPerLayer * 8],
    ['Efficacité entre 0 et 100', result.efficiency > 0 && result.efficiency <= 100],
    ['Longueur marker <= matelas', result.markerLengthCm <= 450],
    ['Surface disponible cohérente', Math.abs(result.availableAreaM2 - (150 * result.matelasLengthCm) / 10000) < 0.01],
    ['Pertes kg = surface × couches × grammage / 1000', Math.abs((result.wasteKgEst ?? 0) - (result.wasteAreaM2 * 8 * 160) / 1000) < 0.01],
    ['Toutes les pièces dans le tissu (x >= 0)', result.placements.every((p) => p.x >= 0)],
    ['Toutes les pièces dans le tissu (x+w <= largeur)', result.placements.every((p) => p.x + p.widthCm <= 150.01)],
    ['Toutes les pièces dans le tissu (y+h <= longueur)', result.placements.every((p) => p.y + p.heightCm <= result.markerLengthCm + 0.01)],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'OK ' : 'KO '} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(
    `\nINDICATEURS: pieces/couche=${result.totalPiecesPerLayer} total=${result.totalPiecesAllLayers} longueur=${result.markerLengthCm}cm efficacite=${result.efficiency}% pertes=${result.wasteAreaM2}m2 (${result.wasteKgEst}kg)`,
  );

  // Contraintes de capacité des tables de coupe (cahier §7, tests §18.10-11).
  let failedTables = 0;
  const table3 = db
    .prepare("SELECT id, nom, longueur_max_cm, couches_max FROM coupe_tables WHERE nom='Table 3'")
    .get() as { id: number; nom: string; longueur_max_cm: number; couches_max: number } | undefined;
  if (!table3) {
    console.log('KO  Tables de coupe absentes (migration 0013 non appliquée)');
    failedTables += 1;
  } else {
    const baseInput = {
      productId: product.id,
      category: 'adulte' as const,
      sizes: sizeRows.map((s) => ({ sizeId: s.id, qty: 16 })),
      usableWidthCm: 150,
      matelasLengthCm: 450,
      layers: 8,
      gapCm: 1,
    };
    const expectError = (label: string, input: Parameters<typeof computeMarker>[1]) => {
      try {
        computeMarker(actor, input);
        console.log(`KO  ${label} (aucune erreur levée)`);
        failedTables += 1;
      } catch (cause) {
        console.log(`OK  ${label} — ${(cause as Error).message.slice(0, 100)}`);
      }
    };
    expectError('Matelas > capacité Table 3', {
      ...baseInput,
      matelasLengthCm: table3.longueur_max_cm + 100,
      coupeTableId: table3.id,
    });
    expectError('Couches > limite Table 3', {
      ...baseInput,
      sizes: sizeRows.map((s) => ({ sizeId: s.id, qty: table3.couches_max + 1 })),
      layers: table3.couches_max + 1,
      coupeTableId: table3.id,
    });
    try {
      const inCapacity = computeMarker(actor, { ...baseInput, sizes: sizeRows.map((s) => ({ sizeId: s.id, qty: QTY_PER_SIZE })), coupeTableId: table3.id });
      console.log(
        `OK  Placement accepté dans les capacités de la Table 3 (longueur ${inCapacity.markerLengthCm} cm <= ${table3.longueur_max_cm})`,
      );
    } catch (cause) {
      console.log(`KO  Placement refusé à tort dans les capacités : ${(cause as Error).message}`);
      failedTables += 1;
    }
  }

  if (failed > 0) {
    console.log(`\nECHEC: ${failed} vérification(s)`);
    process.exit(1);
  }
  if (failedTables > 0) {
    console.log(`\nECHEC: ${failedTables} test(s) de capacité de table`);
    process.exit(1);
  }
  console.log('\nNESTING_OK');
}

main().catch((e) => {
  console.error('ERREUR_TEST', e);
  process.exit(1);
});
