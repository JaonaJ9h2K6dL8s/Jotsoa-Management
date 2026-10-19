/**
 * Tests du module Contrôle qualité (étape 6).
 * Exécution : npm run test:cq
 * Base temporaire dédiée : data/test-cq-temp.db.
 * Les cas sont répartis dans test-cq-cases1.ts (réceptions, contrôles,
 * quantités) et test-cq-cases2.ts (décisions, retouches, transferts,
 * sécurité).
 */

import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-cq-temp.db';

const DB_PATH = './data/test-cq-temp.db';

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
  const { runCqCases1 } = await import('./test-cq-cases1');
  const { runCqCases2 } = await import('./test-cq-cases2');
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
         SELECT 'Test', 'CQ', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const CQ = { id: userIdFor('controleur_qualite', 'test-cq-1'), roleCode: 'controleur_qualite' } as Actor;
  const CQ2 = { id: userIdFor('controleur_qualite', 'test-cq-2'), roleCode: 'controleur_qualite' } as Actor;
  const COUTURE = { id: userIdFor('chef_couture', 'test-cq-couture'), roleCode: 'chef_couture' } as Actor;
  const STOCK = { id: userIdFor('chef_stock', 'test-cq-stock'), roleCode: 'chef_stock' } as Actor;

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)')
      .run('T-Shirt Basique', 'Produit de test CQ', typeId).lastInsertRowid,
  );
  const colorId = (
    db.prepare('SELECT id FROM colors WHERE is_active = 1 LIMIT 1').get() as { id: number }
  ).id;
  const sizeIds = (
    db
      .prepare('SELECT id FROM sizes WHERE is_active = 1 ORDER BY display_order LIMIT 2')
      .all() as Array<{ id: number }>
  ).map((row) => row.id);

  let defect = db
    .prepare('SELECT id FROM defects WHERE is_active = 1 LIMIT 1')
    .get() as { id: number } | undefined;
  if (!defect) {
    defect = {
      id: Number(
        db
          .prepare('INSERT INTO defects (nom, is_active) VALUES (?, 1)')
          .run('Couture ouverte').lastInsertRowid,
      ),
    };
  }
  const defectId = defect.id;
  const zone = db
    .prepare('SELECT id FROM rework_zones WHERE is_active = 1 LIMIT 1')
    .get() as { id: number } | undefined;
  const zoneId = zone?.id ?? null;

  const room = db
    .prepare('SELECT id FROM sewing_rooms WHERE is_active = 1 ORDER BY id LIMIT 1')
    .get() as { id: number };
  let line = db
    .prepare('SELECT id FROM sewing_lines WHERE is_active = 1 AND room_id = ? LIMIT 1')
    .get(room.id) as { id: number } | undefined;
  if (!line) {
    line = {
      id: Number(
        db
          .prepare('INSERT INTO sewing_lines (code, nom, room_id, is_active) VALUES (?, ?, ?, 1)')
          .run('LIGNE-CQ', 'Ligne test CQ', room.id).lastInsertRowid,
      ),
    };
  }
  const sewingLine: { id: number } = line;

  // Crée un lot coupe + affectation couture + transfert couture confirmé.
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
        .run(lotCode, productId, colorId, qtyPerSize * sizeIds.length, COUTURE.id)
        .lastInsertRowid,
    );
    const assignmentId = Number(
      db
        .prepare(
          `INSERT INTO couture_assignments (code, lot_id, room_id, line_id, responsable_id, status)
           VALUES (?, ?, ?, ?, ?, 'en_cours')`,
        )
        .run(`AFF-${lotCode}`, lotId, room.id, sewingLine.id, COUTURE.id).lastInsertRowid,
    );
    for (const sizeId of sizeIds) {
      db.prepare(
        'INSERT INTO couture_assignment_sizes (assignment_id, size_id, planned_qty) VALUES (?, ?, ?)',
      ).run(assignmentId, sizeId, qtyPerSize);
    }
    const transferId = Number(
      db
        .prepare(
          `INSERT INTO couture_transfers (code, assignment_id, lot_id, status, prepared_by)
           VALUES (?, ?, ?, 'confirme', ?)`,
        )
        .run(`TRC-${lotCode}`, assignmentId, lotId, COUTURE.id).lastInsertRowid,
    );
    for (const sizeId of sizeIds) {
      db.prepare(
        'INSERT INTO couture_transfer_lines (transfer_id, size_id, qty) VALUES (?, ?, ?)',
      ).run(transferId, sizeId, qtyPerSize);
    }
    return { lotId, transferId };
  }

  const lotA = createConfirmedTransfer('LC-CQ-A', 10);
  const lotC = createConfirmedTransfer('LC-CQ-C', 6);
  const lotD = createConfirmedTransfer('LC-CQ-D', 10);
  const lotE = createConfirmedTransfer('LC-CQ-E', 4);
  const lotF = createConfirmedTransfer('LC-CQ-F', 4);
  // Lot B : transfert volontairement annulé — non réceptionnable.
  const lotB = createConfirmedTransfer('LC-CQ-B', 8);
  db.prepare("UPDATE couture_transfers SET status = 'annule' WHERE id = ?").run(lotB.transferId);

  const ctx = {
    db,
    CQ,
    CQ2,
    COUTURE,
    STOCK,
    productId,
    colorId,
    sizeIds,
    defectId,
    zoneId,
    lots: { A: lotA, B: lotB, C: lotC, D: lotD, E: lotE, F: lotF },
  };

  await runCqCases1(ctx, tools);
  await runCqCases2(ctx, tools);

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
