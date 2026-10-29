/**
 * Tests des services du module Coupe (étape 2) sur base SQLite temporaire.
 * Importé et exécuté par scripts/test-cutting.ts (npm run test:cutting).
 * Les tests des plans sont dans scripts/test-cutting-plan.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/server/db/migrate';
import { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';
import { createRoll, listRolls } from '../src/server/cutting/rolls';
import { listTables } from '../src/server/cutting/tables';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';

interface TestContext {
  db: Database.Database;
  admin: Actor;
  chef: Actor;
  couture: Actor;
  colorId: number;
}

/** Base SQLite temporaire avec migrations complètes et comptes de test. */
export function createTestDb(prefix: string): TestContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const roleId = (code: string): number =>
    (db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number }).id;
  const insertUser = db.prepare(
    `INSERT INTO users (nom, username, password_hash, role_id) VALUES (?, ?, 'x', ?)`,
  );
  const make = (nom: string, username: string, role: string): Actor => ({
    id: Number(insertUser.run(nom, username, roleId(role)).lastInsertRowid),
    roleCode: role as Actor['roleCode'],
  });
  const context: TestContext = {
    db,
    admin: make('Admin', `${prefix}admin`, 'admin'),
    chef: make('Chef', `${prefix}chef`, 'chef_coupe'),
    couture: make('Couture', `${prefix}couture`, 'chef_couture'),
    colorId: 0,
  };
  db.prepare('INSERT INTO colors (nom) VALUES (?)').run(`Bleu ${prefix}`);
  context.colorId = (db.prepare('SELECT id FROM colors LIMIT 1').get() as { id: number }).id;
  return context;
}

declare global {
  // eslint-disable-next-line no-var
  var __testFicheId: number | undefined;
  // eslint-disable-next-line no-var
  var __testRevisionId: number | undefined;
}

export function runCuttingServiceTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-services-');
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : produit T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M introuvable pour le T-shirt.');

  const TSHIRT_MESURES = {
    'Poitrine à plat': 52,
    'Longueur totale': 70,
    Épaules: 46,
    'Longueur manche': 22,
    'Ouverture manche': 18,
    'Largeur bas': 50,
    Encolure: 18,
    'Hauteur col': 3,
  };

  check('Rouleau : poids hors bornes refusé (8,99 kg et 30,01 kg)', () => {
    try {
      createRoll(db, chef, { code: 'R-BAD-1', fabricRef: 'JERSEY', colorId, weightKg: 8.99, lengthM: 50 });
      throw new Error('8,99 kg accepté à tort.');
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
    }
    try {
      createRoll(db, chef, { code: 'R-BAD-2', fabricRef: 'JERSEY', colorId, weightKg: 30.01, lengthM: 50 });
      throw new Error('30,01 kg accepté à tort.');
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
    }
  });

  check('Rouleau : création valide (12 kg, 50 m, 180/170 cm) puis liste', () => {
    const roll = createRoll(db, chef, {
      code: 'R-TEST-1',
      fabricRef: 'JERSEY-180',
      colorId,
      weightKg: 12,
      lengthM: 50,
      widthCm: 180,
      usableWidthCm: 170,
    });
    if (roll.status !== 'disponible') throw new Error('Statut attendu disponible.');
    if (!listRolls(db).some((item) => item.id === roll.id)) {
      throw new Error('Rouleau absent de la liste.');
    }
  });

  check('Tables : longueurs 1000 / 900 / 800 après migration 0019', () => {
    const tables = listTables(db);
    const byName = new Map(tables.map((table) => [table.nom, table]));
    if (byName.get('Table 1')?.longueurMaxCm !== 1000) throw new Error('Table 1 attendue à 1000 cm.');
    if (byName.get('Table 2')?.longueurMaxCm !== 900) throw new Error('Table 2 attendue à 900 cm.');
    if (byName.get('Table 3')?.longueurMaxCm !== 800) throw new Error('Table 3 attendue à 800 cm.');
  });

  check('Permissions : consultation ≠ écriture (couture 403 sur fiche/rouleau)', () => {
    try {
      saveFiche(db, couture, { productId: tshirt.productId, sizeId: sizeM.id, mesures: { A: 1 } });
      throw new Error('Chef couture a pu créer une fiche.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 403) throw error;
    }
  });

  check('Fiche : création brouillon par le chef, validation refusée au chef', () => {
    const fiche = saveFiche(db, chef, {
      productId: tshirt.productId,
      sizeId: sizeM.id,
      fabricType: 'Jersey',
      mesures: TSHIRT_MESURES,
    });
    if (fiche.statut !== 'brouillon') throw new Error('Statut attendu brouillon.');
    try {
      validateFiche(db, chef, fiche.id);
      throw new Error('Chef a pu valider la fiche.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 403) throw error;
    }
    const validated = validateFiche(db, admin, fiche.id);
    if (validated.statut !== 'valide') throw new Error('Validation admin attendue.');
    globalThis.__testFicheId = fiche.id;
  });

  check('Fiche validée immuable : modification refusée', () => {
    try {
      saveFiche(db, chef, {
        ficheId: globalThis.__testFicheId as number,
        productId: tshirt.productId,
        sizeId: sizeM.id,
        mesures: TSHIRT_MESURES,
      });
      throw new Error('Fiche validée modifiée.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 409) throw error;
    }
  });

  check('Génération : fiche non validée refusée ; fiche validée → brouillon 5 pièces', () => {
    const draftFiche = saveFiche(db, chef, {
      productId: tshirt.productId,
      sizeId: sizeM.id,
      mesures: { ...TSHIRT_MESURES, 'Hauteur col': 3 },
    });
    try {
      generateRevision(db, chef, draftFiche.id);
      throw new Error('Génération depuis fiche brouillon acceptée.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 409) throw error;
    }
    const revision = generateRevision(db, chef, globalThis.__testFicheId as number);
    if (revision.status !== 'brouillon') throw new Error('Révision attendue en brouillon.');
    if (revision.pieces.length !== 5) throw new Error(`5 pièces attendues, reçu ${revision.pieces.length}.`);
    if ((revision.unconfigured?.length ?? 0) !== 0) throw new Error('Aucune pièce à configurer attendue.');
    globalThis.__testRevisionId = revision.id;
  });

  check('Catalogue : libellés R1 fusionnés (Hauteur col présent)', () => {
    const product = listCatalogueProducts(db).find(
      (item) => item.productId === tshirt.productId,
    );
    if (!product?.measurementLabels.includes('Hauteur col')) {
      throw new Error('Libellé « Hauteur col » attendu dans le catalogue fusionné.');
    }
  });

  check('Révision incomplète : col sans « Hauteur col » → validation refusée (409)', () => {
    const { 'Hauteur col': _sansCol, ...mesuresSansCol } = TSHIRT_MESURES;
    const incomplete = validateFiche(db, admin, saveFiche(db, chef, {
      productId: tshirt.productId,
      sizeId: sizeM.id,
      mesures: mesuresSansCol,
    }).id);
    const revision = generateRevision(db, chef, incomplete.id);
    if (revision.pieces.length !== 4) throw new Error('4 pièces configurées attendues.');
    const col = revision.unconfigured?.find((piece) => piece.code === 'col');
    if (!col || !col.missingLabels.includes('Hauteur col')) {
      throw new Error('Col attendu « à configurer » (Hauteur col manquante).');
    }
    try {
      validateRevision(db, admin, revision.id);
      throw new Error('Révision incomplète validée à tort.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 409) throw error;
      if (!error.message.includes('Hauteur col')) throw new Error('Mesure manquante non citée.');
    }
  });
}
