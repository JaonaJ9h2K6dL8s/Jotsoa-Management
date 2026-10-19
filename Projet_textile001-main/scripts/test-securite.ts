/**
 * Tests du module Chef Sécurité (étape 10).
 * Exécution : npm run test:securite
 * Base temporaire dédiée : data/test-sec-temp.db.
 * Construit la chaîne complète CQ → Stock (4 cartons clôturés),
 * prépare 3 dossiers via le module Magasinier, puis exécute les cas
 * d'usage Sécurité : réception, comptage, anomalies, contre-
 * vérifications, décision, confirmation de sortie, stock.
 */

import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-sec-temp.db';

const DB_PATH = './data/test-sec-temp.db';

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
         SELECT 'Test', 'SEC', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const SEC = { id: userIdFor('chef_securite', 'test-sec-1'), roleCode: 'chef_securite' };
  const SEC2 = { id: userIdFor('chef_securite', 'test-sec-2'), roleCode: 'chef_securite' };
  const ST = { id: userIdFor('chef_stock', 'test-sec-st'), roleCode: 'chef_stock' };
  const MG = { id: userIdFor('chef_magasinier', 'test-sec-mg'), roleCode: 'chef_magasinier' };
  const CQ = { id: userIdFor('controleur_qualite', 'test-sec-cq'), roleCode: 'controleur_qualite' };

  const typeId = (db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }).id;
  const productId = Number(
    db
      .prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)')
      .run('Pantalon Securite', 'Produit de test SEC', typeId).lastInsertRowid,
  );
  const colorId = (db.prepare(`SELECT id FROM colors WHERE nom = 'Bleu'`).get() as { id: number }).id;
  const sizeIds = (
    db.prepare(`SELECT id FROM sizes WHERE nom IN ('M', 'L') ORDER BY display_order`).all() as Array<{ id: number }>
  ).map((row) => row.id);
  const [sizeM, sizeL] = sizeIds;

  const locationId = Number(
    db
      .prepare(
        `INSERT INTO st_locations (code, label, area, created_by) VALUES ('LOC-SEC-1', 'Zone securite test', 'zone', ?)`,
      )
      .run(ST.id).lastInsertRowid,
  );

  async function buildChain(suffix: string): Promise<{ stockTransferId: number }> {
    const receptions = await import('../src/server/controle-qualite/receptions');
    const controls = await import('../src/server/controle-qualite/controls');
    const actions = await import('../src/server/controle-qualite/controls-actions');
    const decisions = await import('../src/server/controle-qualite/decisions');
    const stockTransfers = await import('../src/server/controle-qualite/transfers-stock');
    const defectId = (db.prepare('SELECT id FROM defects WHERE is_active = 1 LIMIT 1').get() as { id: number }).id;
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
            .run(`LIGNE-SEC-${suffix}`, `Ligne test ${suffix}`, room.id).lastInsertRowid,
        ),
      };
    }
    const lotId = Number(
      db
        .prepare(
          `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status, responsable_id)
           VALUES (?, ?, ?, ?, 'transfere', ?)`,
        )
        .run(`LC-SEC-${suffix}`, productId, colorId, 20, CQ.id).lastInsertRowid,
    );
    const assignmentId = Number(
      db
        .prepare(
          `INSERT INTO couture_assignments (code, lot_id, room_id, line_id, responsable_id, status)
           VALUES (?, ?, ?, ?, ?, 'en_cours')`,
        )
        .run(`AFF-SEC-${suffix}`, lotId, room.id, line.id, CQ.id).lastInsertRowid,
    );
    const transferId = Number(
      db
        .prepare(
          `INSERT INTO couture_transfers (code, assignment_id, lot_id, status, prepared_by)
           VALUES (?, ?, ?, 'confirme', ?)`,
        )
        .run(`TRC-SEC-${suffix}`, assignmentId, lotId, CQ.id).lastInsertRowid,
    );
    for (const sizeId of sizeIds) {
      db.prepare('INSERT INTO couture_assignment_sizes (assignment_id, size_id, planned_qty) VALUES (?, ?, ?)').run(assignmentId, sizeId, 10);
      db.prepare('INSERT INTO couture_transfer_lines (transfer_id, size_id, qty) VALUES (?, ?, ?)').run(transferId, sizeId, 10);
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
        { sizeId: sizeM, inspectedQty: 10, conformeQty: 8 },
        { sizeId: sizeL, inspectedQty: 10, conformeQty: 9 },
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
        { sizeId: sizeM, qty: 8 },
        { sizeId: sizeL, qty: 9 },
      ],
    });
    return { stockTransferId: stockTransfer.id };
  }

  // 4 chaînes → 4 cartons clôturés (A, B : dossier 1 ; C : dossier 2 ; D : dossier 3).
  const cartons = await import('../src/server/stock/cartons');
  const entries = await import('../src/server/stock/entries');
  const cartonIds: number[] = [];
  const cartonCodes: string[] = [];
  for (const suffix of ['A', 'B', 'C', 'D']) {
    const chain = await buildChain(suffix);
    const carton = cartons.createCarton(ST as never, { code: `CT-SEC-${suffix}` });
    entries.receiveCqTransfer(ST as never, {
      transferId: chain.stockTransferId,
      lines: sizeIds.map((sizeId) => ({ sizeId, cartonId: carton.id })),
    });
    cartons.closeCarton(ST as never, { cartonId: carton.id, locationId });
    cartonIds.push(carton.id);
    cartonCodes.push(carton.code);
  }

  // Préparation de 3 dossiers via le module Magasinier.
  const documents = await import('../src/server/magasinier/documents');
  const orders = await import('../src/server/magasinier/orders');
  const preparations = await import('../src/server/magasinier/preparations');
  const dossiers = await import('../src/server/magasinier/dossiers');
  const { makePdf } = await import('./magasinier-test-tools');

  async function prepareOrder(
    externalNo: string,
    reserves: Array<{ lineSizeId: number; cartonId: number; qty: number }>,
    manual: boolean,
  ): Promise<{ orderId: number; dossier: { id: number; code: string }; lineIds: Map<number, number> }> {
    let order: {
      id: number;
      lines: Array<{ id: number; sizeId: number | null; rawText: string | null }>;
    };
    if (manual) {
      const partial = await documents.importDocument(MG as never, {
        name: `sec-${externalNo}.pdf`,
        buffer: makePdf(['Texte libre sans ligne exploitable.']),
      });
      documents.createManualOrder(MG as never, {
        documentId: String(partial.documentId),
        clientName: 'Client Securite',
        externalOrderNo: externalNo,
        lines: [
          { rawText: 'Pantalon Securite / Bleu / M / 3', qty: 3 },
          { rawText: 'Pantalon Securite / Bleu / L / 3', qty: 3 },
        ],
      });
      order = orders
        .listOrders(MG as never)
        .find((item) => item.externalOrderNo === externalNo)!;
      for (const line of order.lines) {
        orders.matchOrderLine(MG as never, {
          lineId: line.id,
          productId,
          colorId,
          sizeId: line.rawText?.includes('/ L /') ? sizeL : sizeM,
        });
      }
    } else {
      const pdfLines = reserves.map((reserve) => {
        const sizeNom = reserve.lineSizeId === sizeL ? 'L' : 'M';
        return `Pantalon Securite / Bleu / ${sizeNom} / ${reserve.qty}`;
      });
      const imported = await documents.importDocument(MG as never, {
        name: `sec-${externalNo}.pdf`,
        buffer: makePdf([
          `Commande n° : ${externalNo}`,
          'Client : Client Securite',
          ...pdfLines,
        ]),
      });
      order = orders.listOrders(MG as never).find((item) => item.documentCode === imported.code)!;
    }
    orders.validateOrder(MG as never, { orderId: order.id });
    const prep = preparations.getOrderPreparation(MG as never, order.id);
    const lineIds = new Map<number, number>();
    const items = reserves.map((reserve) => {
      const line = prep.lines.find((item) => item.sizeId === reserve.lineSizeId)!;
      lineIds.set(reserve.lineSizeId, line.id);
      return { lineId: line.id, cartonId: reserve.cartonId, qty: reserve.qty };
    });
    preparations.reserveStock(MG as never, { orderId: order.id, items });
    dossiers.verifyPreparation(MG as never, { orderId: order.id });
    const dossier = dossiers.submitDossier(MG as never, { orderId: order.id });
    return { orderId: order.id, dossier: { id: dossier.id, code: dossier.code }, lineIds };
  }

  const order1 = await prepareOrder(
    'MG-EXT-SEC-001',
    [
      { lineSizeId: sizeM, cartonId: cartonIds[0], qty: 4 },
      { lineSizeId: sizeL, cartonId: cartonIds[1], qty: 5 },
    ],
    false,
  );
  const order2 = await prepareOrder(
    'MG-EXT-SEC-002',
    [
      { lineSizeId: sizeM, cartonId: cartonIds[2], qty: 3 },
      { lineSizeId: sizeL, cartonId: cartonIds[2], qty: 3 },
    ],
    true,
  );
  const order3 = await prepareOrder(
    'MG-EXT-SEC-003',
    [{ lineSizeId: sizeM, cartonId: cartonIds[3], qty: 2 }],
    false,
  );

  const tools = (await import('./magasinier-test-tools')).createMgTestTools(ServiceError);
  const modules = {
    dossiers: await import('../src/server/securite/dossiers'),
    controles: await import('../src/server/securite/controles'),
    count: await import('../src/server/securite/count'),
    anomalies: await import('../src/server/securite/anomalies'),
    decisions: await import('../src/server/securite/decisions'),
    sorties: await import('../src/server/securite/sorties'),
  };
  const cases1 = await import('./test-securite-cases1');
  const cases2 = await import('./test-securite-cases2');
  await cases1.runSecurityCasesPart1(
    {
      db,
      ServiceError,
      SEC,
      SEC2,
      ST,
      MG,
      productId,
      sizeM,
      sizeL,
      cartonIds,
      cartonCodes,
      order1,
      order2,
      order3,
    },
    tools,
    modules,
  );
  await cases2.runSecurityCasesPart2(
    {
      db,
      ServiceError,
      SEC,
      SEC2,
      ST,
      MG,
      productId,
      sizeM,
      sizeL,
      cartonIds,
      cartonCodes,
      order1,
      order2,
      order3,
    },
    tools,
    modules,
  );

  console.log(`\n${tools.passed.count} test(s) réussi(s).`);
  console.log('\nTests sécurité terminés.');
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
