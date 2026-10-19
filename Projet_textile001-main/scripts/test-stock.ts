/**
 * Tests du module Cartons et Stock (étape 8).
 * Exécution : npm run test:stock
 * Base temporaire dédiée : data/test-st-temp.db.
 * Construit la chaîne complète CQ → Stock : lot, transfert couture,
 * réception CQ, contrôle validé, transfert conforme vers le stock.
 */

import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-st-temp.db';

const DB_PATH = './data/test-st-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = DB_PATH + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const { ServiceError } = await import('../src/server/api/service-error');
  const { createCoutureTools } = await import('./couture-test-utils');
  const tools = createCoutureTools(ServiceError);
  const { runStockCases } = await import('./test-stock-cases');
  const db = sessionsDb();

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
         SELECT 'Test', 'ST', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const ST = { id: userIdFor('chef_stock', 'test-st-1'), roleCode: 'chef_stock' };
  const ST2 = { id: userIdFor('chef_stock', 'test-st-2'), roleCode: 'chef_stock' };
  const CQ = { id: userIdFor('controleur_qualite', 'test-st-cq'), roleCode: 'controleur_qualite' };
  const CP = { id: userIdFor('chef_coupe', 'test-st-cp'), roleCode: 'chef_coupe' };

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)')
      .run('T-Shirt Premium', 'Produit de test ST', typeId).lastInsertRowid,
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
        db.prepare('INSERT INTO defects (nom, is_active) VALUES (?, 1)').run('Tache').lastInsertRowid,
      ),
    };
  }

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
          .run('LIGNE-ST', 'Ligne test ST', room.id).lastInsertRowid,
      ),
    };
  }

  // Chaîne amont : lot → transfert couture → réception CQ → contrôle.
  const receptions = await import('../src/server/controle-qualite/receptions');
  const controls = await import('../src/server/controle-qualite/controls');
  const actions = await import('../src/server/controle-qualite/controls-actions');
  const decisions = await import('../src/server/controle-qualite/decisions');

  const lotId = Number(
    db
      .prepare(
        `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status, responsable_id)
         VALUES (?, ?, ?, ?, 'transfere', ?)`,
      )
      .run('LC-ST-A', productId, colorId, 20, CQ.id).lastInsertRowid,
  );
  const assignmentId = Number(
    db
      .prepare(
        `INSERT INTO couture_assignments (code, lot_id, room_id, line_id, responsable_id, status)
         VALUES (?, ?, ?, ?, ?, 'en_cours')`,
      )
      .run('AFF-ST-A', lotId, room.id, line.id, CQ.id).lastInsertRowid,
  );
  const transferId = Number(
    db
      .prepare(
        `INSERT INTO couture_transfers (code, assignment_id, lot_id, status, prepared_by)
         VALUES (?, ?, ?, 'confirme', ?)`,
      )
      .run('TRC-ST-A', assignmentId, lotId, CQ.id).lastInsertRowid,
  );
  for (const sizeId of sizeIds) {
    db.prepare(
      'INSERT INTO couture_assignment_sizes (assignment_id, size_id, planned_qty) VALUES (?, ?, ?)',
    ).run(assignmentId, sizeId, 10);
    db.prepare(
      'INSERT INTO couture_transfer_lines (transfer_id, size_id, qty) VALUES (?, ?, ?)',
    ).run(transferId, sizeId, 10);
  }

  receptions.receiveTransfer(CQ as never, {
    transferId,
    lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 10 })),
  });
  const reception = receptions
    .listReceptions(CQ as never)
    .find((item) => item.transferId === transferId)!;
  const control = controls.createControl(CQ as never, { receptionId: reception.id });
  actions.patchControlStatus(CQ as never, control.id, { action: 'start' });
  actions.submitResults(CQ as never, control.id, {
    lines: [
      { sizeId: sizeIds[0], inspectedQty: 10, conformeQty: 8 },
      { sizeId: sizeIds[1], inspectedQty: 10, conformeQty: 9 },
    ],
  });
  const defaut = decisions.declareDefaut(CQ as never, {
    controleId: control.id,
    sizeId: sizeIds[0],
    defectId: defect.id,
    qtyPieces: 2,
  });
  decisions.createReworkRequest(CQ as never, {
    defautId: defaut.id,
    reason: 'Tache à retoucher',
  });
  const defaut1 = decisions.declareDefaut(CQ as never, {
    controleId: control.id,
    sizeId: sizeIds[1],
    defectId: defect.id,
    qtyPieces: 1,
  });
  decisions.createReworkRequest(CQ as never, {
    defautId: defaut1.id,
    reason: 'Couture à reprendre',
  });
  actions.requestValidation(CQ as never, control.id);
  actions.validateControl(CQ as never, control.id);
  const stockTransfers = await import('../src/server/controle-qualite/transfers-stock');
  const stockTransfer = stockTransfers.createStockTransfer(CQ as never, {
    controleId: control.id,
    lines: [
      { sizeId: sizeIds[0], qty: 8 },
      { sizeId: sizeIds[1], qty: 9 },
    ],
  });

  await runStockCases({
    db,
    tools,
    ST,
    ST2,
    CQ,
    CP,
    lotId,
    control,
    stockTransferId: stockTransfer.id,
    sizeIds,
  });

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
