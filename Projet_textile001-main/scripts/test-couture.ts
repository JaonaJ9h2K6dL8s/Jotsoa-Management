/**
 * Tests du module Couture (étape 5).
 * Exécution : npm run test:couture
 * Base temporaire dédiée : data/test-couture-temp.db.
 * Les cas sont répartis dans test-couture-cases1.ts (réceptions,
 * affectations) et test-couture-cases2.ts (production, transferts,
 * sécurité, validations).
 */

import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-couture-temp.db';

const DB_PATH = './data/test-couture-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = DB_PATH + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const db = sessionsDb();
  const { ServiceError } = await import('../src/server/api/service-error');
  const { createCoutureTools } = await import('./couture-test-utils');
  const tools = createCoutureTools(ServiceError);
  const { runCoutureCases1 } = await import('./test-couture-cases1');
  const { runCoutureCases2 } = await import('./test-couture-cases2');
  type Actor = import('../src/server/users/users-service').Actor;

  function userIdFor(roleCode: string, username: string): number {
    const row = db
      .prepare(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = ? AND u.username = ?`,
      )
      .get(roleCode, username) as { id: number } | undefined;
    if (row) return row.id;
    const result = db
      .prepare(
        `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
         SELECT 'Test', 'Couture', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const CHEF = {
    id: userIdFor('chef_couture', 'test-couture-1'),
    roleCode: 'chef_couture',
  } as Actor;
  const CHEF2 = {
    id: userIdFor('chef_couture', 'test-couture-2'),
    roleCode: 'chef_couture',
  } as Actor;
  const STOCK = {
    id: userIdFor('chef_stock', 'test-couture-stock'),
    roleCode: 'chef_stock',
  } as Actor;
  const COUPE = {
    id: userIdFor('chef_coupe', 'test-couture-coupe'),
    roleCode: 'chef_coupe',
  } as Actor;

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare(
        'INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)',
      )
      .run('Pantalon Chino', 'Produit de test couture', typeId).lastInsertRowid,
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

  // Deux lots Coupe transférés et confirmés, prêts à être réceptionnés.
  function createConfirmedTransfer(
    lotCode: string,
    qtyPerSize: number,
  ): { lotId: number; transferId: number } {
    const lotId = Number(
      db
        .prepare(
          `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status, responsable_id)
           VALUES (?, ?, ?, ?, 'transfere', ?)`,
        )
        .run(lotCode, productId, colorId, qtyPerSize * sizeIds.length, COUPE.id)
        .lastInsertRowid,
    );
    const transferId = Number(
      db
        .prepare(
          `INSERT INTO coupe_transfers (lot_id, code, status, performed_by)
           VALUES (?, ?, 'confirme', ?)`,
        )
        .run(lotId, `TR-${lotCode}`, COUPE.id).lastInsertRowid,
    );
    for (const sizeId of sizeIds) {
      db.prepare(
        `INSERT INTO coupe_transfer_lines (transfer_id, product_id, color_id, size_id, qty)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(transferId, productId, colorId, sizeId, qtyPerSize);
    }
    return { lotId, transferId };
  }

  const lotA = createConfirmedTransfer('LC-COUTURE-A', 10);
  const lotB = createConfirmedTransfer('LC-COUTURE-B', 8);
  const lotC = createConfirmedTransfer('LC-COUTURE-C', 6);
  const lotD = createConfirmedTransfer('LC-COUTURE-D', 6);
  // Transfert volontairement annulé côté Coupe : non réceptionnable.
  const lotE = createConfirmedTransfer('LC-COUTURE-E', 4);
  db.prepare("UPDATE coupe_transfers SET status = 'annule' WHERE lot_id = ?").run(lotE.lotId);

  const rooms = db
    .prepare('SELECT id FROM sewing_rooms WHERE is_active = 1 ORDER BY id LIMIT 2')
    .all() as Array<{ id: number }>;

  const ctx = {
    db,
    CHEF,
    CHEF2,
    STOCK,
    productId,
    colorId,
    sizeIds,
    rooms: rooms.map((room) => room.id),
    lots: {
      A: lotA,
      B: lotB,
      C: lotC,
      D: lotD,
      E: lotE,
    },
  };

  await runCoutureCases1(ctx, tools);
  await runCoutureCases2(ctx, tools);

  console.log(`\n${tools.passed.count} test(s) réussi(s).`);
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
