/**
 * Tests du générateur automatique de patrons vectoriels (étape 3).
 * Exécution : npm run test:coupe-patterns
 * Base temporaire dédiée : data/test-coupe-patterns-temp.db.
 * Couvre : génération par famille (tshirt, short, jogging, ensemble),
 * dimensions dérivées des mesures, mesure manquante, incohérences,
 * fiche non validée, polo non disponible, absence d'auto-validation,
 * régénération versionnée, marge de couture explicite et compatibilité
 * avec le moteur de placement (getValidatedPatterns + packContours).
 * Fonctionne hors ligne (SQLite locale, aucun appel réseau).
 */

import fs from 'node:fs';
import { check, expect, testPassed } from './workflow-test-tools';

const DB_PATH = './data/test-coupe-patterns-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = DB_PATH + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

type Mesures = Array<[string, number]>;

const TSHIRT_MESURES: Mesures = [
  ['Poitrine à plat', 52], ['Longueur totale', 70], ['Épaules', 44],
  ['Longueur manche', 20], ['Ouverture manche', 18], ['Largeur bas', 50],
  ['Encolure', 18],
];
const POLO_MESURES: Mesures = [
  ...TSHIRT_MESURES, ['Col', 44], ['Longueur patte', 8], ['Largeur patte', 2],
];
const LOWER_MESURES: Mesures = [
  ['Taille détendue', 56], ['Taille étirée', 62], ['Hanches', 58],
  ['Longueur extérieure', 40], ['Entrejambe', 15], ['Ouverture bas', 56],
  ['Hauteur ceinture', 3],
];
const JOGGING_MESURES: Mesures = [
  ['Taille détendue', 48], ['Taille étirée', 54], ['Hanches', 52],
  ['Longueur extérieure', 55], ['Entrejambe', 25], ['Ouverture bas', 30],
  ['Hauteur ceinture', 3],
];
const ENSEMBLE_MESURES: Mesures = [
  ['Haut : poitrine', 48], ['Haut : longueur', 55], ['Haut : épaules', 40],
  ['Haut : manche', 15], ['Haut : ouverture manche', 14], ['Haut : encolure', 16],
  ['Short : taille', 48], ['Short : hanches', 52], ['Short : longueur', 30],
  ['Short : entrejambe', 10], ['Short : ouverture jambe', 48], ['Short : ceinture', 3],
];

async function main(): Promise<void> {
  process.env.DATABASE_PATH = DB_PATH;
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const db = sessionsDb();
  type Actor = import('../src/server/users/users-service').Actor;
  const generator = await import('../src/server/coupe/pattern-generator');
  const library = await import('../src/server/coupe/pattern-library');
  const fiches = await import('../src/server/coupe/fiches');
  const patterns = await import('../src/server/coupe/patterns');
  const packing = await import('../src/server/coupe/polygon-packing');

  function userIdFor(roleCode: string): number {
    const row = db.prepare(
      'SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = ?',
    ).get(roleCode) as { id: number } | undefined;
    if (row) return row.id;
    const result = db.prepare(
      `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
       SELECT 'Test', 'Generator', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
    ).run(`test-gen-${roleCode}`, roleCode);
    return Number(result.lastInsertRowid);
  }
  const CHEF = { id: userIdFor('chef_coupe'), roleCode: 'chef_coupe' } as Actor;

  function ensureSize(nom: string, order: number): number {
    db.prepare('INSERT OR IGNORE INTO sizes (nom, display_order) VALUES (?, ?)').run(nom, order);
    return (db.prepare('SELECT id FROM sizes WHERE LOWER(TRIM(nom)) = LOWER(TRIM(?))').get(nom) as { id: number }).id;
  }
  const adulte = ['S', 'M', 'L', 'XL'].map((nom, index) => ensureSize(nom, index + 1));
  const enfant = [2, 4, 6, 8, 10, 12].map((age, index) => ensureSize(String(age), index + 10));

  const typeId = (db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }).id;
  function addProduct(nom: string, family: string, category: string, sizeIds: number[], labels: string[]): { productId: number; sizeId: number } {
    const productId = Number(db.prepare(
      'INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)',
    ).run(nom, 'Produit test générateur', typeId).lastInsertRowid);
    const sizeNames = sizeIds.map((id) => (db.prepare('SELECT nom FROM sizes WHERE id = ?').get(id) as { nom: string }).nom);
    db.prepare(
      `INSERT INTO coupe_catalogue (product_id, family, category, size_names_json, measurement_labels_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(productId, family, category, JSON.stringify(sizeNames), JSON.stringify(labels));
    return { productId, sizeId: sizeIds[0] };
  }
  const tshirt = addProduct('T-shirt Gen', 'tshirt', 'adulte', adulte, TSHIRT_MESURES.map(([label]) => label));
  const polo = addProduct('Polo Gen', 'polo', 'adulte', adulte, POLO_MESURES.map(([label]) => label));
  const short = addProduct('Short Gen', 'short', 'adulte', adulte, LOWER_MESURES.map(([label]) => label));
  const jogging = addProduct('Jogging Gen', 'jogging', 'enfant', enfant, LOWER_MESURES.map(([label]) => label));
  const ensemble = addProduct('Ensemble Gen', 'ensemble', 'enfant', enfant, ENSEMBLE_MESURES.map(([label]) => label));

  function makeFiche(productId: number, sizeId: number, mesures: Mesures, opts?: { confection?: Record<string, unknown>; skipValidate?: boolean }): number {
    const fiche = fiches.saveFiche(CHEF, {
      productId,
      sizeId,
      modele: 'MOD-GEN',
      fabricType: 'COTON-GEN',
      confection: opts?.confection ?? { valeursCoutureCm: 1 },
      mesures: mesures.map(([label, valeurCm]) => ({ label, valeurCm })),
    });
    if (!opts?.skipValidate) fiches.validateFiche(CHEF, fiche.id);
    return fiche.id;
  }

  function capture(fn: () => unknown): { status: number; message: string } {
    try {
      fn();
    } catch (error) {
      const err = error as { status?: number; message?: string };
      return { status: err.status ?? 0, message: err.message ?? '' };
    }
    return { status: 0, message: 'aucune erreur levée' };
  }

  // 1. Génération T-shirt adulte.
  const ficheTshirt = makeFiche(tshirt.productId, tshirt.sizeId, TSHIRT_MESURES);
  const result = generator.generatePatterns(CHEF, { ficheId: ficheTshirt });
  check('T-shirt : 3 pièces générées avec traçabilité GEN-TSHIRT-adulte-R1', () => {
    expect(result.pieces.length === 3, `3 pièces attendues, reçu ${result.pieces.length}`);
    expect(result.pieces.some((p) => p.code === 'DEVANT'), 'devant');
    expect(result.pieces.some((p) => p.code === 'DOS'), 'dos');
    expect(result.pieces.some((p) => p.code === 'MANCHE'), 'manche');
    expect(result.sourceName === 'GEN-TSHIRT-adulte-R1', `sourceName reçu : ${result.sourceName}`);
    expect(result.rulesVersion === 'R1', 'version des règles');
  });
  check('T-shirt : dimensions dérivées des mesures, coutures incluses (54×71, manche 20×21)', () => {
    const devant = result.pieces.find((p) => p.code === 'DEVANT')!;
    expect(Math.abs(devant.widthCm - 54) < 0.02 && Math.abs(devant.heightCm - 71) < 0.02,
      `torse 54×71 attendu, reçu ${devant.widthCm}×${devant.heightCm}`);
    const manche = result.pieces.find((p) => p.code === 'MANCHE')!;
    expect(Math.abs(manche.widthCm - 20) < 0.02 && Math.abs(manche.heightCm - 21) < 0.02,
      `manche 20×21 attendue, reçu ${manche.widthCm}×${manche.heightCm}`);
  });
  check('Pas d auto-validation : révision en brouillon, aucune pièce validée', () => {
    expect(result.status === 'brouillon', `statut reçu : ${result.status}`);
    const count = (db.prepare(
      'SELECT COUNT(*) c FROM pattern_pieces WHERE revision_id = ? AND is_validated = 1',
    ).get(result.revisionId) as { c: number }).c;
    expect(count === 0, `${count} pièce(s) déjà validée(s)`);
  });
  check('Patron indisponible au placement tant que la révision n est pas validée', () => {
    const selection = patterns.getValidatedPatterns(CHEF, { productId: tshirt.productId, sizeIds: [tshirt.sizeId] });
    expect(selection.items.length === 0, `${selection.items.length} patron(s) déjà disponible(s)`);
  });
  check('Validation humaine puis compatibilité placement (matelas 160×700)', () => {
    const validated = library.validateRevision(CHEF, result.revisionId);
    expect(validated.status === 'valide', 'révision non validée');
    const selection = patterns.getValidatedPatterns(CHEF, { productId: tshirt.productId, sizeIds: [tshirt.sizeId] });
    expect(selection.items.length === 3, `3 pièces attendues, reçu ${selection.items.length}`);
    const placements = packing.packContours(selection.items, 160, 700, 1, 2, [], false, 1, 1, false);
    expect(placements.length === selection.items.length, `${selection.items.length - placements.length} pièce(s) non placée(s)`);
  });

  // 2. Régénération versionnée.
  check('Régénération : nouvelle révision v2 en brouillon, v1 validée intacte', () => {
    const again = generator.generatePatterns(CHEF, { ficheId: ficheTshirt });
    expect(again.version === 2 && again.revisionId !== result.revisionId, `version reçue : ${again.version}`);
    expect(again.status === 'brouillon', 'v2 devrait être en brouillon');
    const first = library.listRevisions(CHEF, tshirt.productId).find((r) => r.id === result.revisionId)!;
    expect(first.status === 'valide' && first.version === 1, 'v1 modifiée');
  });

  // 3. Mesures et fiches invalides.
  check('Mesure officielle manquante : refus 400 citant « Encolure »', () => {
    const ficheId = makeFiche(tshirt.productId, tshirt.sizeId, TSHIRT_MESURES.filter(([label]) => label !== 'Encolure'));
    const { status, message } = capture(() => generator.generatePatterns(CHEF, { ficheId }));
    expect(status === 400, `statut reçu : ${status}`);
    expect(message.includes('Encolure'), `message reçu : ${message}`);
  });
  check('Fiche non validée : génération refusée (409)', () => {
    const ficheId = makeFiche(tshirt.productId, tshirt.sizeId, TSHIRT_MESURES, { skipValidate: true });
    expect(capture(() => generator.generatePatterns(CHEF, { ficheId })).status === 409, 'statut 409 attendu');
  });
  check('Incohérence épaules > poitrine : refus 400 explicite', () => {
    const mesures: Mesures = TSHIRT_MESURES.map(([label, value]) => [label, label === 'Épaules' ? 60 : value]);
    const ficheId = makeFiche(tshirt.productId, tshirt.sizeId, mesures);
    const { status, message } = capture(() => generator.generatePatterns(CHEF, { ficheId }));
    expect(status === 400, `statut reçu : ${status}`);
    expect(message.includes('épaules'), `message reçu : ${message}`);
  });
  check('Polo : règle de patronage non définie, modèle indisponible (409)', () => {
    const ficheId = makeFiche(polo.productId, polo.sizeId, POLO_MESURES);
    const { status, message } = capture(() => generator.generatePatterns(CHEF, { ficheId }));
    expect(status === 409, `statut reçu : ${status}`);
    expect(message.includes('non disponible'), `message reçu : ${message}`);
  });

  // 4. Short, jogging, ensemble.
  check('Short : devant, dos, ceinture — dimensions conformes (jambe 30×38, ceinture 58×5)', () => {
    const ficheId = makeFiche(short.productId, short.sizeId, LOWER_MESURES);
    const generated = generator.generatePatterns(CHEF, { ficheId });
    expect(generated.pieces.length === 3, `3 pièces attendues, reçu ${generated.pieces.length}`);
    const jambe = generated.pieces.find((p) => p.code === 'DEVANT')!;
    expect(Math.abs(jambe.widthCm - 30) < 0.02 && Math.abs(jambe.heightCm - 38) < 0.02,
      `jambe 30×38 attendue, reçu ${jambe.widthCm}×${jambe.heightCm}`);
    const ceinture = generated.pieces.find((p) => p.code === 'CEINTURE')!;
    expect(Math.abs(ceinture.widthCm - 58) < 0.02 && Math.abs(ceinture.heightCm - 5) < 0.02,
      `ceinture 58×5 attendue, reçu ${ceinture.widthCm}×${ceinture.heightCm}`);
  });
  check('Short : entrejambe ≥ longueur extérieure — refus 400', () => {
    const mesures: Mesures = LOWER_MESURES.map(([label, value]) => [label, label === 'Entrejambe' ? 45 : value]);
    const ficheId = makeFiche(short.productId, short.sizeId, mesures);
    expect(capture(() => generator.generatePatterns(CHEF, { ficheId })).status === 400, 'statut 400 attendu');
  });
  check('Jogging enfant : génération OK (règle indépendante du short)', () => {
    const ficheId = makeFiche(jogging.productId, jogging.sizeId, JOGGING_MESURES);
    const generated = generator.generatePatterns(CHEF, { ficheId });
    expect(generated.pieces.length === 3, `3 pièces attendues, reçu ${generated.pieces.length}`);
    expect(generated.sourceName === 'GEN-JOGGING-enfant-R1', `sourceName reçu : ${generated.sourceName}`);
  });
  check('Ensemble enfant : 6 pièces haut + short, validation humaine OK', () => {
    const ficheId = makeFiche(ensemble.productId, ensemble.sizeId, ENSEMBLE_MESURES);
    const generated = generator.generatePatterns(CHEF, { ficheId });
    expect(generated.pieces.length === 6, `6 pièces attendues, reçu ${generated.pieces.length}`);
    expect(generated.pieces.filter((p) => p.component === 'haut').length === 3, '3 pièces haut');
    expect(generated.pieces.filter((p) => p.component === 'short').length === 3, '3 pièces short');
    const validated = library.validateRevision(CHEF, generated.revisionId);
    expect(validated.status === 'valide', 'révision ensemble non validée');
  });

  // 5. Marge de couture.
  check('Marge de couture absente : refus 400 explicite', () => {
    const ficheId = makeFiche(tshirt.productId, tshirt.sizeId, TSHIRT_MESURES, { confection: {} });
    const { status, message } = capture(() => generator.generatePatterns(CHEF, { ficheId }));
    expect(status === 400, `statut reçu : ${status}`);
    expect(message.includes('Marge de couture'), `message reçu : ${message}`);
  });
  check('Marge de couture explicite en paramètre : génération acceptée', () => {
    const ficheId = makeFiche(tshirt.productId, tshirt.sizeId, TSHIRT_MESURES, { confection: {} });
    const generated = generator.generatePatterns(CHEF, { ficheId, seamAllowanceCm: 1.2 });
    expect(generated.seamAllowanceCm === 1.2, `marge reçue : ${generated.seamAllowanceCm}`);
    expect(generated.status === 'brouillon', 'révision en brouillon attendue');
  });

  console.log(`\n${testPassed()} test(s) du générateur de patrons réussi(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('\nÉCHEC DES TESTS :', error);
    process.exit(1);
  })
  .finally(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suffix);
      } catch {
        // ignoré
      }
    }
  });
