/**
 * Tests du module Chef Magasinier (étape 9).
 * Exécution : npm run test:magasinier
 * Base temporaire dédiée : data/test-mg-temp.db.
 * Construit la chaîne complète CQ → Stock (2 cartons clôturés) puis
 * exécute les cas d'usage Magasinier : import PDF, doublons,
 * réservations, vérification et dossiers de sortie.
 */

import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-mg-temp.db';

const DB_PATH = './data/test-mg-temp.db';

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
         SELECT 'Test', 'MG', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const MG = { id: userIdFor('chef_magasinier', 'test-mg-1'), roleCode: 'chef_magasinier' };
  const ST = { id: userIdFor('chef_stock', 'test-mg-st'), roleCode: 'chef_stock' };
  const CQ = { id: userIdFor('controleur_qualite', 'test-mg-cq'), roleCode: 'controleur_qualite' };

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)')
      .run('T-Shirt Premium MG', 'Produit de test MG', typeId).lastInsertRowid,
  );
  const colorId = (
    db.prepare(`SELECT id FROM colors WHERE nom = 'Bleu'`).get() as { id: number }
  ).id;
  const sizeIds = (
    db
      .prepare(
        `SELECT id FROM sizes WHERE nom IN ('M', 'L') ORDER BY display_order`,
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id);

  const locationId = Number(
    db
      .prepare(
        `INSERT INTO st_locations (code, label, area, created_by) VALUES ('LOC-MG-1', 'Zone magasin test', 'zone', ?)`,
      )
      .run(ST.id).lastInsertRowid,
  );

  // Chaîne amont lot → transfert couture → réception CQ → contrôle validé
  // → transfert conforme vers le stock (réplique le harness de l'étape 8).
  async function buildChain(
    suffix: string,
  ): Promise<{ lotId: number; stockTransferId: number }> {
    const receptions = await import('../src/server/controle-qualite/receptions');
    const controls = await import('../src/server/controle-qualite/controls');
    const actions = await import('../src/server/controle-qualite/controls-actions');
    const decisions = await import('../src/server/controle-qualite/decisions');
    const stockTransfers = await import('../src/server/controle-qualite/transfers-stock');

    const defectId = (
      db.prepare('SELECT id FROM defects WHERE is_active = 1 LIMIT 1').get() as { id: number }
    ).id;
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
            .prepare(
              'INSERT INTO sewing_lines (code, nom, room_id, is_active) VALUES (?, ?, ?, 1)',
            )
            .run(`LIGNE-MG-${suffix}`, `Ligne test ${suffix}`, room.id).lastInsertRowid,
        ),
      };
    }

    const lotId = Number(
      db
        .prepare(
          `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status, responsable_id)
           VALUES (?, ?, ?, ?, 'transfere', ?)`,
        )
        .run(`LC-MG-${suffix}`, productId, colorId, 20, CQ.id).lastInsertRowid,
    );
    const assignmentId = Number(
      db
        .prepare(
          `INSERT INTO couture_assignments (code, lot_id, room_id, line_id, responsable_id, status)
           VALUES (?, ?, ?, ?, ?, 'en_cours')`,
        )
        .run(`AFF-MG-${suffix}`, lotId, room.id, line.id, CQ.id).lastInsertRowid,
    );
    const transferId = Number(
      db
        .prepare(
          `INSERT INTO couture_transfers (code, assignment_id, lot_id, status, prepared_by)
           VALUES (?, ?, ?, 'confirme', ?)`,
        )
        .run(`TRC-MG-${suffix}`, assignmentId, lotId, CQ.id).lastInsertRowid,
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
      .find((item: { transferId: number }) => item.transferId === transferId)!;
    const control = controls.createControl(CQ as never, { receptionId: reception.id });
    actions.patchControlStatus(CQ as never, control.id, { action: 'start' });
    actions.submitResults(CQ as never, control.id, {
      lines: [
        { sizeId: sizeIds[0], inspectedQty: 10, conformeQty: 8 },
        { sizeId: sizeIds[1], inspectedQty: 10, conformeQty: 9 },
      ],
    });
    for (const [index, sizeId] of sizeIds.entries()) {
      const defaut = decisions.declareDefaut(CQ as never, {
        controleId: control.id,
        sizeId,
        defectId,
        qtyPieces: index === 0 ? 2 : 1,
      });
      decisions.createReworkRequest(CQ as never, {
        defautId: defaut.id,
        reason: 'Défaut de test à retoucher',
      });
    }
    actions.requestValidation(CQ as never, control.id);
    actions.validateControl(CQ as never, control.id);
    const stockTransfer = stockTransfers.createStockTransfer(CQ as never, {
      controleId: control.id,
      lines: [
        { sizeId: sizeIds[0], qty: 8 },
        { sizeId: sizeIds[1], qty: 9 },
      ],
    });
    return { lotId, stockTransferId: stockTransfer.id };
  }

  // Deux chaînes → deux cartons clôturés prêts pour la préparation.
  const cartons = await import('../src/server/stock/cartons');
  const entries = await import('../src/server/stock/entries');
  const cartonIds: number[] = [];
  for (const suffix of ['A', 'B']) {
    const chain = await buildChain(suffix);
    const carton = cartons.createCarton(ST as never, { code: `CT-MG-${suffix}` });
    entries.receiveCqTransfer(ST as never, {
      transferId: chain.stockTransferId,
      lines: sizeIds.map((sizeId) => ({ sizeId, cartonId: carton.id })),
    });
    cartons.closeCarton(ST as never, { cartonId: carton.id, locationId });
    cartonIds.push(carton.id);
  }

  const { runMagasinierCases } = await import('./test-magasinier-cases');
  await runMagasinierCases({
    db,
    ServiceError,
    MG,
    ST,
    productId,
    colorId,
    sizeIds,
    cartonIds,
  });

  console.log('\nTests magasinier terminés.');
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
