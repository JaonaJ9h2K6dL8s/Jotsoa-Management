/**
 * Seed d'une base de test isolée pour la validation navigateur de
 * l'étape 17.1 (tickets de transfert). Crée : utilisateurs avec mots
 * de passe réels, catalogue/fiche/révision validée, rouleau, deux
 * plans placés et validés, prêts à être transférés depuis l'atelier.
 * Aucune donnée réelle n'est touchée : le fichier est créé de zéro.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/server/db/migrate';
import { hashPassword } from '../src/server/auth/passwords';
import type { Actor } from '../src/server/users/users-service';
import { createRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';

const OUT = path.resolve(process.cwd(), 'data/e17-browser.db');
if (fs.existsSync(OUT)) fs.rmSync(OUT);
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(OUT + suffix)) fs.rmSync(OUT + suffix);
}

const db = new Database(OUT);
db.pragma('foreign_keys = ON');
runMigrations(db);

const roleId = (code: string): number =>
  (db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number }).id;
const insertUser = db.prepare(
  `INSERT INTO users (nom, prenom, username, password_hash, role_id, must_change_password)
   VALUES (?, ?, ?, ?, ?, 0)`,
);
const make = (nom: string, prenom: string, username: string, role: string): Actor => ({
  id: Number(insertUser.run(
    nom, prenom, username, hashPassword('E17-Test-2026'), roleId(role),
  ).lastInsertRowid),
  roleCode: role as Actor['roleCode'],
});
const chef = make('Rakoto', 'Jean', 'chef.coupe', 'chef_coupe');
const couture = make('Ravao', 'Miora', 'chef.couture', 'chef_couture');
make('Rabe', 'Toto', 'chef.stock', 'chef_stock');
const admin = make('Admin', 'Système', 'admin', 'admin');

const tshirt = listCatalogueProducts(db).find(
  (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
);
if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
if (!sizeM) throw new Error('Taille M introuvable.');

const colorId = Number(db.prepare("INSERT INTO colors (nom) VALUES ('Bleu ciel')")
  .run().lastInsertRowid);
const roll = createRoll(db, chef, {
  code: 'R-E17-NAV', fabricRef: 'JERSEY-180', colorId,
  weightKg: 20, lengthM: 61.7, widthCm: 180, usableWidthCm: 170, grammageGm2: 180,
});
const fiche = validateFiche(db, admin, saveFiche(db, chef, {
  productId: tshirt.productId, sizeId: sizeM.id, mesures: {
    'Poitrine à plat': 52, 'Longueur totale': 70, Épaules: 46,
    'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
    Encolure: 18, 'Hauteur col': 3,
  },
}).id);
const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
  .get() as { id: number }).id;
const devant = revision.pieces.find((piece) => piece.code === 'devant') as {
  id: number; widthCm: number;
};
const dos = revision.pieces.find((piece) => piece.code === 'dos') as { id: number };
const col = revision.pieces.find((piece) => piece.code === 'col') as { id: number };
const mancheG = revision.pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
const mancheD = revision.pieces.find((piece) => piece.code === 'manche_droite') as { id: number };

for (const label of ['Plan A (réception partielle)', 'Plan B (réception complète)']) {
  const plan = createPlan(db, chef, {
    revisionId: revision.id, rollId: roll.id, tableId: table1,
    layers: 2, gapCm: 1, matelasLengthCm: 500, qty: 1,
  });
  savePlan(db, chef, plan.id, [
    { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
    { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
    { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
    { pieceId: col.id, x: 2, y: 160, rotation: 0 },
    { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
    { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
  ]);
  validatePlan(db, admin, plan.id);
  console.log(`${label} : plan #${plan.id} validé`);
}

console.log(`Base de test : ${OUT}`);
console.log('Comptes (mot de passe : E17-Test-2026) : chef.coupe / chef.couture / chef.stock');
db.close();
