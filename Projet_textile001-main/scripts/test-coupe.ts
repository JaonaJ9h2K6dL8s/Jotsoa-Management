/**
 * Tests du module Coupe (étape 4).
 * Exécution : npm run test:coupe
 * Base temporaire dédiée : data/test-coupe-temp.db.
 * Les cas sont répartis dans test-coupe-cases1.ts et test-coupe-cases2.ts.
 */

import fs from 'node:fs';
import type { CoupeTestContext } from './coupe-test-context';

process.env.DATABASE_PATH = './data/test-coupe-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = './data/test-coupe-temp.db' + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const db = sessionsDb();
  const { runCases1 } = await import('./test-coupe-cases1');
  const { runCases2 } = await import('./test-coupe-cases2');
  type Actor = import('../src/server/users/users-service').Actor;

  function userIdFor(roleCode: string): number {
    const row = db
      .prepare(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = ?`,
      )
      .get(roleCode) as { id: number } | undefined;
    if (row) return row.id;
    const result = db
      .prepare(
        `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
         SELECT 'Test', 'Coupe', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(`test-${roleCode}`, roleCode);
    return Number(result.lastInsertRowid);
  }

  const CHEF = { id: userIdFor('chef_coupe'), roleCode: 'chef_coupe' } as Actor;
  const STOCK = { id: userIdFor('chef_stock'), roleCode: 'chef_stock' } as Actor;
  const ADMIN = { id: userIdFor('admin'), roleCode: 'admin' } as Actor;

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare(
        'INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)',
      )
      .run('T-shirt Col V', 'Produit de test coupe', typeId).lastInsertRowid,
  );
  const colorId = (
    db
      .prepare('SELECT id FROM colors WHERE is_active = 1 LIMIT 1')
      .get() as { id: number }
  ).id;
  const sizeIds = (
    db
      .prepare(
        'SELECT id FROM sizes WHERE is_active = 1 ORDER BY display_order LIMIT 2',
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id);

  const ctx: CoupeTestContext = {
    db,
    CHEF,
    STOCK,
    ADMIN,
    productId,
    colorId,
    sizeIds,
  };

  const setup1 = await runCases1(ctx);
  await runCases2(ctx, setup1.tools, {
    lotId: setup1.lotId,
    rollAId: setup1.rollAId,
    task1Id: setup1.task1Id,
  });

  console.log(`\n${setup1.tools.passed.count} test(s) réussi(s).`);
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
        fs.unlinkSync('./data/test-coupe-temp.db' + suffix);
      } catch {
        // ignoré
      }
    }
  });
