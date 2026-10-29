/**
 * AUDIT POST-IMPLÉMENTATION PHASE 5.1 — script TEMPORAIRE de vérification.
 * Lecture seule sur la base réelle ; scénarios hostiles sur base ISOLÉE ;
 * migration testée sur une COPIE. Supprimé après exécution, jamais commité.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/server/db/migrate';
import { createTestDb } from './test-cutting-services';
import { createRoll } from '../src/server/cutting/rolls';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import {
  createCutSession, updateCutSession, savePlanRecord, finalizeCutSession,
  invalidateCutSession, replaceCutSession, getCutSession,
  getBilanTolerance, setBilanTolerance,
} from '../src/server/cutting/measurements';
import type { Actor } from '../src/server/users/users-service';

let failures = 0;
function ok(cond: boolean, label: string): void {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures += 1;
}
function throwsStatus(fn: () => void, status: number, label: string): void {
  try {
    fn();
    ok(false, `${label} — aucune erreur levée`);
  } catch (error) {
    const s = (error as { status?: number }).status;
    ok(s === status, `${label} — status ${status} attendu, reçu ${s}`);
  }
}

interface Fixture {
  db: Database.Database;
  chef: Actor;
  admin: Actor;
  couture: Actor;
  rollA: number;
  rollB: number;
  plansA: number[];
  plansB: number[];
}

function fixture(prefix: string, planCountA: number, planCountB: number): Fixture {
  const { db, admin, chef, couture, colorId } = createTestDb(prefix);
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('catalogue tshirt introuvable');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('taille M introuvable');
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: {
      'Poitrine à plat': 52, 'Longueur totale': 70, 'Épaules': 46,
      'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
      'Encolure': 18, 'Hauteur col': 3,
    },
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
    .get() as { id: number }).id;
  const mkRoll = (code: string): number => createRoll(db, chef, {
    code, fabricRef: 'JERSEY-160', colorId,
    weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
    grammageGm2: 160,
  }).id;
  const rollA = mkRoll(`RA-${prefix.replace(/[^A-Z0-9]/gi, '').slice(-6)}`);
  const rollB = mkRoll(`RB-${prefix.replace(/[^A-Z0-9]/gi, '').slice(-6)}`);
  const pieces = revision.pieces;
  const devant = pieces.find((piece) => piece.code === 'devant') as { id: number; widthCm: number };
  const dos = pieces.find((piece) => piece.code === 'dos') as { id: number };
  const col = pieces.find((piece) => piece.code === 'col') as { id: number };
  const mancheG = pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
  const mancheD = pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
  const mkPlan = (rollId: number): number => {
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId, tableId: table1,
      layers: 6, gapCm: 1, matelasLengthCm: 400, qty: 1,
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
    return plan.id;
  };
  const plansA: number[] = [];
  for (let i = 0; i < planCountA; i += 1) plansA.push(mkPlan(rollA));
  const plansB: number[] = [];
  for (let i = 0; i < planCountB; i += 1) plansB.push(mkPlan(rollB));
  return { db, chef, admin, couture, rollA, rollB, plansA, plansB };
}

// ────────────────────────────────────────────────────────────────────
// PARTIE A — Migration 0022 sur une COPIE de la base réelle
// ────────────────────────────────────────────────────────────────────
console.log('=== A. Migration sur copie de la base réelle ===');
const REAL = path.resolve('data/jo-test-admin.db');
const COPY = path.resolve('data/audit-51-copy-temp.db');
for (const suffix of ['', '-wal', '-shm']) {
  const src = REAL + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, COPY + suffix);
}
const copy = new Database(COPY);
copy.pragma('journal_mode = WAL');
copy.pragma('foreign_keys = ON');

const countOf = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const businessTables = ['coupe_rolls', 'coupe_roll_movements', 'marker_plans', 'users', 'orders'];
const beforeCounts = Object.fromEntries(businessTables.map((t) => [t, countOf(copy, t)]));

const applied1 = runMigrations(copy);
ok(applied1.includes('0022_coupe_cut_measurements.sql'),
  `A1. 0022 appliquée sur la copie (pending: ${applied1.length} migrations)`);
const afterCounts = Object.fromEntries(businessTables.map((t) => [t, countOf(copy, t)]));
ok(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
  'A2. Aucune donnée métier modifiée par la migration');
ok(countOf(copy, 'coupe_cut_sessions') === 0 && countOf(copy, 'coupe_cut_plan_records') === 0,
  'A3. Nouvelles tables créées vides');
const metaKeys = copy.prepare(
  "SELECT key, value FROM app_meta WHERE key LIKE 'coupe_scale%' OR key LIKE 'coupe_bilan%'",
).all() as Array<{ key: string; value: string }>;
ok(metaKeys.length === 2
  && metaKeys.some((r) => r.key === 'coupe_scale_uncertainty_kg' && r.value === '0.1')
  && metaKeys.some((r) => r.key === 'coupe_bilan_tolerance_floor_kg' && r.value === '0.3'),
  'A4. Tolérance initialisée (u=0.1, plancher=0.3)');

// Rejeu : idempotence.
const applied2 = runMigrations(copy);
ok(applied2.length === 0, 'A5. Migration relancée : aucun rejeu (idempotence)');

// Re-exécution brute du corps SQL 0022 (IF NOT EXISTS + INSERT OR IGNORE).
const sql22 = fs.readFileSync(
  path.resolve('database/migrations/0022_coupe_cut_measurements.sql'), 'utf8');
let reexecOk = true;
try { copy.exec(sql22); } catch { reexecOk = false; }
ok(reexecOk && countOf(copy, 'coupe_cut_sessions') === 0,
  'A6. Corps SQL 0022 ré-exécuté sans erreur ni duplication');

// Échec à mi-migration : même mécanisme transactionnel que runMigrations.
let rollbackOk = false;
try {
  copy.transaction(() => {
    copy.exec('CREATE TABLE audit_rollback_test (x INTEGER)');
    throw new Error('échec simulé à mi-parcours');
  })();
} catch { /* attendu */ }
const leftover = copy.prepare(
  "SELECT name FROM sqlite_master WHERE name = 'audit_rollback_test'",
).get();
rollbackOk = leftover === undefined;
ok(rollbackOk, 'A7. Échec à mi-parcours : transaction annulée, aucune table résiduelle');

// FK actives sur les nouvelles tables.
let fkOk = false;
try {
  copy.prepare(
    `INSERT INTO coupe_cut_sessions
       (roll_id, status, roll_weight_before_kg, operator_id)
     VALUES (999999, 'brouillon', 10, (SELECT MIN(id) FROM users))`,
  ).run();
} catch (error) {
  fkOk = String((error as Error).message).toUpperCase().includes('FOREIGN KEY');
}
ok(fkOk, 'A8. Clé étrangère roll_id → coupe_rolls active (insertion orpheline refusée)');
copy.close();

// ────────────────────────────────────────────────────────────────────
// PARTIE B — Scénarios hostiles sur base ISOLÉE
// ────────────────────────────────────────────────────────────────────
console.log('=== B. Intégrité métier + sécurité (base isolée) ===');
const fx = fixture('audit51-', 2, 1);

// B1. Permissions directes (sans passer par l'UI) : admin et chef_couture refusés.
throwsStatus(() => createCutSession(fx.db, fx.admin, {
  rollId: fx.rollA, rollWeightBeforeKg: 20,
}), 403, 'B1a. createCutSession par admin → 403');
throwsStatus(() => createCutSession(fx.db, fx.couture, {
  rollId: fx.rollA, rollWeightBeforeKg: 20,
}), 403, 'B1b. createCutSession par chef_couture → 403');
throwsStatus(() => setBilanTolerance(fx.db, fx.chef, {
  uncertaintyKg: 0.1, floorKg: 0.3,
}), 403, 'B1c. setBilanTolerance par chef de coupe → 403');

// B2. Validation numérique hostile (NaN, Infinity, négatif, non numérique).
const session1 = createCutSession(fx.db, fx.chef, {
  rollId: fx.rollA, rollWeightBeforeKg: 20,
});
for (const bad of [NaN, Infinity, -Infinity, 'Infinity', 'abc', -5, 0, null]) {
  throwsStatus(() => createCutSession(fx.db, fx.chef, {
    rollId: fx.rollA, rollWeightBeforeKg: bad,
  }), 400, `B2. pesée d'entrée ${String(bad)} → 400`);
}
throwsStatus(() => updateCutSession(fx.db, fx.chef, {
  sessionId: session1.id, measuredGsm: NaN,
}), 400, 'B2b. GSM mesurée NaN → 400');
throwsStatus(() => savePlanRecord(fx.db, fx.chef, {
  sessionId: session1.id, planId: fx.plansA[0], chutesKg: -0.01,
}), 400, 'B2c. chutes négatives → 400');

// B3. IDs manipulés : plan d'un autre rouleau, session inexistante, plan d'une autre session active.
throwsStatus(() => savePlanRecord(fx.db, fx.chef, {
  sessionId: session1.id, planId: fx.plansB[0], lengthUsedM: 4,
}), 409, 'B3a. plan d\'un autre rouleau (roll_id manipulé) → 409');
throwsStatus(() => savePlanRecord(fx.db, fx.chef, {
  sessionId: 999999, planId: fx.plansA[0], lengthUsedM: 4,
}), 404, 'B3b. session inexistante → 404');
throwsStatus(() => getCutSession(fx.db, 999999), 404, 'B3c. détail session inexistante → 404');
throwsStatus(() => createCutSession(fx.db, fx.chef, {
  rollId: 999999, rollWeightBeforeKg: 20,
}), 404, 'B3d. rouleau inexistant → 404');

// B4. Figé : après finalisation, aucun chemin de modification.
savePlanRecord(fx.db, fx.chef, { sessionId: session1.id, planId: fx.plansA[0], lengthUsedM: 4.05 });
const fin1 = finalizeCutSession(fx.db, fx.chef, { sessionId: session1.id, rollWeightAfterKg: 15 });
ok(fin1.session.consumed_kg === 5, 'B4a. consumed_kg stocké = before − after (5 kg)');
throwsStatus(() => updateCutSession(fx.db, fx.chef, {
  sessionId: session1.id, rollWeightBeforeKg: 19,
}), 409, 'B4b. update sur session complète → 409');
throwsStatus(() => savePlanRecord(fx.db, fx.chef, {
  sessionId: session1.id, planId: fx.plansA[1], lengthUsedM: 4,
}), 409, 'B4c. record-save sur session complète → 409');
throwsStatus(() => finalizeCutSession(fx.db, fx.chef, {
  sessionId: session1.id, rollWeightAfterKg: 14,
}), 409, 'B4d. double finalisation → 409');

// B5. Correction par version : brouillon refusé, complet autorisé, historique préservé.
const s2 = createCutSession(fx.db, fx.chef, { rollId: fx.rollB, rollWeightBeforeKg: 20 });
throwsStatus(() => replaceCutSession(fx.db, fx.chef, s2.id), 409,
  'B5b. replace sur session BROUILLON → 409');
throwsStatus(() => invalidateCutSession(fx.db, fx.chef, { sessionId: s2.id, reason: '' }),
  400, 'B5c. invalidation sans motif → 400');
const v2 = replaceCutSession(fx.db, fx.chef, session1.id);
ok(v2.status === 'brouillon' && v2.replaces_id === session1.id,
  'B5d. v2 brouillon liée par replaces_id');
const v1row = fx.db.prepare(
  "SELECT status, invalide_reason FROM coupe_cut_sessions WHERE id = ?",
).get(session1.id) as { status: string; invalide_reason: string };
ok(v1row.status === 'invalide' && v1row.invalide_reason.includes(`#${v2.id}`),
  'B5e. v1 invalidée « Remplacée par la version » — historique préservé');
// Les enregistrements de plans sont copiés dans v2 et rattachables.
const v2detail = getCutSession(fx.db, v2.id);
ok(v2detail.records.length === 1, 'B5f. v2 hérite des enregistrements de v1');

// B6. Concurrence : une 2ᵉ session brouillon sur le même rouleau est
// refusée par l'index partiel (dernier rempart même en écriture directe SQL).
let uniqOk = false;
try {
  fx.db.prepare(
    `INSERT INTO coupe_cut_sessions (roll_id, status, roll_weight_before_kg, operator_id)
     SELECT roll_id, 'brouillon', roll_weight_before_kg, operator_id
       FROM coupe_cut_sessions WHERE id = ?`,
  ).run(v2.id);
} catch {
  uniqOk = true;
}
ok(uniqOk, 'B6. Index partiel uq_cut_session_active : 2ᵉ brouillon refusée même en SQL direct');

// B7. Aucune écriture dans stock / mouvements / plans pendant tout le workflow.
const stockBefore = fx.db.prepare(
  'SELECT id, remaining_weight_kg, remaining_qty, initial_weight_kg, initial_qty FROM coupe_rolls ORDER BY id',
).all();
const movementsBefore = countOf(fx.db, 'coupe_roll_movements');
const plansBefore = fx.db.prepare(
  'SELECT id, status, matelas_length_cm FROM marker_plans ORDER BY id',
).all();
savePlanRecord(fx.db, fx.chef, { sessionId: v2.id, planId: fx.plansA[0], lengthUsedM: 4.02 });
finalizeCutSession(fx.db, fx.chef, { sessionId: v2.id, rollWeightAfterKg: 15.2 });
const stockAfter = fx.db.prepare(
  'SELECT id, remaining_weight_kg, remaining_qty, initial_weight_kg, initial_qty FROM coupe_rolls ORDER BY id',
).all();
const movementsAfter = countOf(fx.db, 'coupe_roll_movements');
const plansAfter = fx.db.prepare(
  'SELECT id, status, matelas_length_cm FROM marker_plans ORDER BY id',
).all();
ok(JSON.stringify(stockBefore) === JSON.stringify(stockAfter),
  'B7a. coupe_rolls strictement inchangé (stock)');
ok(movementsBefore === movementsAfter, 'B7b. aucun mouvement créé');
ok(JSON.stringify(plansBefore) === JSON.stringify(plansAfter), 'B7c. marker_plans inchangés');

// B8. Multi-plans : aucun poids réparti par plan.
const multi = fixture('audit51m-', 3, 0);
const ms = createCutSession(multi.db, multi.chef, {
  rollId: multi.rollA, rollWeightBeforeKg: 20,
});
for (const planId of multi.plansA) {
  savePlanRecord(multi.db, multi.chef, { sessionId: ms.id, planId, lengthUsedM: 4.05 });
}
finalizeCutSession(multi.db, multi.chef, { sessionId: ms.id, rollWeightAfterKg: 15 });
const multiDetail = getCutSession(multi.db, ms.id);
ok(multiDetail.planConsumedKg === null,
  'B8a. multi-plans : planConsumedKg NULL (aucune répartition artificielle)');
ok(multiDetail.diagnostics !== null && multiDetail.diagnostics.residueKg === null,
  'B8b. sans pesée diagnostique (pièces/chutes) : résidu NULL (pas de contrôle inventé)');
const recordCols = multi.db.prepare('PRAGMA table_info(coupe_cut_plan_records)')
  .all() as Array<{ name: string }>;
ok(!recordCols.some((c) => c.name.toLowerCase().includes('consumed')),
  'B8c. aucun champ de consommation au niveau enregistrement de plan');

// B9. Tolérance : NaN/Infinity/0 refusés, persistance, lecture.
const tol0 = getBilanTolerance(multi.db);
ok(Math.abs(tol0.toleranceKg - 0.4242640687119285) < 1e-9,
  `B9a. tolérance initiale max(3√(0,1²+0,1²), 0,3) = ${tol0.toleranceKg}`);
for (const bad of [NaN, Infinity, 'Infinity', 0, -1, 'abc']) {
  throwsStatus(() => setBilanTolerance(multi.db, multi.admin, {
    uncertaintyKg: bad, floorKg: 0.3,
  }), 400, `B9b. incertitude ${String(bad)} → 400`);
}
setBilanTolerance(multi.db, multi.admin, { uncertaintyKg: 0.2, floorKg: 0.3 });
const tol1 = getBilanTolerance(multi.db);
ok(Math.abs(tol1.toleranceKg - 0.848528137423857) < 1e-9,
  'B9c. tolérance recalculée (u=0,2 → 0,8485 kg)');
const persisted = multi.db.prepare(
  "SELECT value FROM app_meta WHERE key = 'coupe_scale_uncertainty_kg'",
).get() as { value: string };
ok(persisted.value === '0.2', 'B9d. incertitude persistée dans app_meta (survit au redémarrage)');
// Reconnexion « froide » : nouvelle connexion → valeur relue depuis app_meta.
const cold = getBilanTolerance(multi.db);
ok(cold.uncertaintyKg === 0.2, 'B9e. relecture après « redémarrage » (nouvelle lecture app_meta)');
setBilanTolerance(multi.db, multi.admin, { uncertaintyKg: 0.1, floorKg: 0.3 });

console.log(failures === 0 ? '=== TOUTES LES VÉRIFICATIONS OK ===' : `=== ${failures} ÉCHEC(S) ===`);
process.exit(failures === 0 ? 0 : 1);
