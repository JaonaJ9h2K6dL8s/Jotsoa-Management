/**
 * Tests du module Rapports & pilotage (étape 11).
 * Exécution : npm run test:admin
 * Base temporaire dédiée : data/test-adm-temp.db.
 * Construit la chaîne amont réelle (lot → couture → CQ → retouche),
 * puis vérifie les indicateurs, filtres, comparaisons, exports,
 * anti-doubles comptages, performance et intégrité SQLite.
 */

import fs from 'node:fs';
import type { sessionsDb } from '../src/server/auth/sessions';

type Db = ReturnType<typeof sessionsDb>;

process.env.DATABASE_PATH = './data/test-adm-temp.db';

const DB_PATH = './data/test-adm-temp.db';

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
  const db = sessionsDb();

  function userIdFor(roleCode: string, username: string): number {
    const existing = db
      .prepare(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.code = ? AND u.username = ?`,
      )
      .get(roleCode, username) as { id: number } | undefined;
    if (existing) return existing.id;
    const result = db
      .prepare(
        `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
         SELECT 'Test', 'ADM', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(username, roleCode);
    return Number(result.lastInsertRowid);
  }

  const userIds: Record<string, number> = {
    admin: userIdFor('admin', 'test-adm-admin'),
    coupe: userIdFor('chef_coupe', 'test-adm-coupe'),
    couture: userIdFor('chef_couture', 'test-adm-couture'),
    cq: userIdFor('controleur_qualite', 'test-adm-cq'),
    retouche: userIdFor('retoucheur', 'test-adm-rt'),
    stock: userIdFor('chef_stock', 'test-adm-stock'),
    magasinier: userIdFor('chef_magasinier', 'test-adm-mg'),
    securite: userIdFor('chef_securite', 'test-adm-sec'),
  };

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)')
      .run('Pantalon ADM', 'Produit de test ADM', typeId).lastInsertRowid,
  );
  const colorId = (
    db.prepare('SELECT id FROM colors WHERE is_active = 1 LIMIT 1').get() as { id: number }
  ).id;
  const sizeIds = (
    db
      .prepare('SELECT id FROM sizes WHERE is_active = 1 ORDER BY display_order LIMIT 2')
      .all() as Array<{ id: number }>
  ).map((row) => row.id);
  const defect = db
    .prepare('SELECT id FROM defects WHERE is_active = 1 LIMIT 1')
    .get() as { id: number };
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
          .run('LIGNE-ADM', 'Ligne test ADM', room.id).lastInsertRowid,
      ),
    };
  }

  // Chaîne amont réelle : lot → affectation → transfert → réception CQ.
  const receptions = await import('../src/server/controle-qualite/receptions');
  const controls = await import('../src/server/controle-qualite/controls');
  const actions = await import('../src/server/controle-qualite/controls-actions');
  const decisions = await import('../src/server/controle-qualite/decisions');
  const CQ = { id: userIds.cq, roleCode: 'controleur_qualite' };

  const lotId = Number(
    db
      .prepare(
        `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status, responsable_id)
         VALUES (?, ?, ?, ?, 'transfere', ?)`,
      )
      .run('LC-ADM-A', productId, colorId, 40, CQ.id).lastInsertRowid,
  );
  const assignmentId = Number(
    db
      .prepare(
        `INSERT INTO couture_assignments (code, lot_id, room_id, line_id, responsable_id, status)
         VALUES (?, ?, ?, ?, ?, 'en_cours')`,
      )
      .run('AFF-ADM-A', lotId, room.id, line.id, userIds.couture).lastInsertRowid,
  );
  const transferId = Number(
    db
      .prepare(
        `INSERT INTO couture_transfers (code, assignment_id, lot_id, status, prepared_by)
         VALUES (?, ?, ?, 'confirme', ?)`,
      )
      .run('TRC-ADM-A', assignmentId, lotId, userIds.couture).lastInsertRowid,
  );
  for (const sizeId of sizeIds) {
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
      { sizeId: sizeIds[1], inspectedQty: 10, conformeQty: 10 },
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
  // Défaut supplémentaire (pièce déjà défectueuse : plusieurs défauts).
  db.prepare(
    `INSERT INTO cq_defauts (controle_id, lot_id, size_id, defect_id, qty_pieces, severity, decision, declared_by)
     VALUES (?, ?, ?, ?, 1, 'mineure', 'attente', ?)`,
  ).run(control.id, lotId, sizeIds[1], defect.id, CQ.id);
  const request0Id = (
    db.prepare('SELECT MAX(id) AS m FROM cq_rework_requests').get() as { m: number }
  ).m;

  // Coupe : tâche validée + résultats + déchets (kg).
  const taskId = Number(
    db
      .prepare(
        `INSERT INTO coupe_tasks (lot_id, code, description, status, responsable_id)
         VALUES (?, ?, ?, 'validee', ?)`,
      )
      .run(lotId, 'TCH-ADM-1', 'Tâche test', userIds.coupe).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO coupe_results (task_id, lot_id, size_id, planned_qty, cut_qty, usable_qty, anomaly_qty, waste_qty, created_by)
     VALUES (?, ?, ?, 40, 30, 28, 2, 0, ?)`,
  ).run(taskId, lotId, sizeIds[0], userIds.coupe);
  db.prepare(
    `INSERT INTO coupe_waste (lot_id, waste_type, qty, unit, user_id) VALUES (?, 'chute', 12.5, 'kg', ?)`,
  ).run(lotId, userIds.coupe);

  // Couture : 2 productions normales + 1 annulée.
  const production = db.prepare(
    `INSERT INTO couture_productions (assignment_id, lot_id, size_id, qty, operator_id, recorded_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  production.run(assignmentId, lotId, sizeIds[0], 12, userIds.couture, userIds.couture, 'normal');
  production.run(assignmentId, lotId, sizeIds[1], 8, userIds.couture, userIds.couture, 'normal');
  production.run(assignmentId, lotId, sizeIds[0], 5, userIds.couture, userIds.couture, 'annulee');

  // Retouche : une demande → deux interventions (distinction exigée).
  const rtAssignmentId = Number(
    db
      .prepare(
        `INSERT INTO rt_assignments (code, request_id, retoucheur_id, assigned_by, status)
         VALUES (?, ?, ?, ?, 'affectee')`,
      )
      .run('RTA-ADM-A', request0Id, userIds.retouche, userIds.couture).lastInsertRowid,
  );
  const intervention = db.prepare(
    `INSERT INTO rt_interventions (code, assignment_id, retoucheur_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
  );
  intervention.run('RTI-ADM-1', rtAssignmentId, userIds.retouche, 'en_cours', null);
  intervention.run('RTI-ADM-2', rtAssignmentId, userIds.retouche, 'terminee', datetimeNow());

  // Stock : mouvements selon la convention + cartons.
  const movement = db.prepare(
    `INSERT INTO st_movements (movement_type, lot_id, size_id, qty, user_id) VALUES (?, ?, ?, ?, ?)`,
  );
  movement.run('entree_cq', lotId, sizeIds[0], 20, userIds.stock);
  movement.run('entree_cq', lotId, sizeIds[1], 20, userIds.stock);
  movement.run('sortie', lotId, sizeIds[0], 3, userIds.stock);
  movement.run('retour', lotId, sizeIds[1], 2, userIds.stock);
  movement.run('transfert', lotId, sizeIds[0], 5, userIds.stock);
  const carton = db.prepare(
    `INSERT INTO st_cartons (code, status, created_by) VALUES (?, ?, ?)`,
  );
  carton.run('CT-ADM-1', 'cloture', userIds.stock);
  carton.run('CT-ADM-2', 'cloture', userIds.stock);
  carton.run('CT-ADM-3', 'vide', userIds.stock);

  // Magasinier + Sécurité : commandes, dossiers, sorties, anomalies.
  const doc1 = insertDocument(db, 'DOC-ADM-1', 'hash-adm-1', userIds.magasinier, 'EXT-ADM-1');
  const order1 = insertOrder(db, 'CMD-ADM-1', doc1, 'EXT-ADM-1', 'en_preparation', userIds.magasinier);
  db.prepare(
    `INSERT INTO mg_order_lines (order_id, product_id, color_id, size_id, qty_ordered, qty_prepared, match_status)
     VALUES (?, ?, ?, ?, 10, 4, 'reconnu')`,
  ).run(order1, productId, colorId, sizeIds[0]);
  const dossier1 = Number(
    db
      .prepare(
        `INSERT INTO mg_dossiers (code, order_id, status, submitted_by) VALUES (?, ?, 'soumis', ?)`,
      )
      .run('DOS-ADM-1', order1, userIds.magasinier).lastInsertRowid,
  );
  const doc2 = insertDocument(db, 'DOC-ADM-2', 'hash-adm-2', userIds.magasinier, 'EXT-ADM-2');
  const order2 = insertOrder(db, 'CMD-ADM-2', doc2, 'EXT-ADM-2', 'complete', userIds.magasinier);
  const dossier2 = Number(
    db
      .prepare(
        `INSERT INTO mg_dossiers (code, order_id, status, submitted_by, security_result, security_checked_by, security_checked_at)
         VALUES (?, ?, 'soumis', ?, 'conforme', ?, datetime('now'))`,
      )
      .run('DOS-ADM-2', order2, userIds.magasinier, userIds.securite).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO sec_sorties (code, dossier_id, status, authorized_by, confirmed_by, confirmed_at, movement_logged)
     VALUES (?, ?, 'confirmee', ?, ?, datetime('now'), 1)`,
  ).run('SOR-ADM-1', dossier1, userIds.securite, userIds.securite);
  db.prepare(
    `INSERT INTO sec_sorties (code, dossier_id, status, authorized_by, movement_logged)
     VALUES (?, ?, 'autorisee', ?, 0)`,
  ).run('SOR-ADM-2', dossier2, userIds.securite);
  db.prepare(
    `INSERT INTO sec_anomalies (code, dossier_id, type, severity, description, status, detected_by)
     VALUES (?, ?, 'quantite_ecart', 'critical', 'Écart de test', 'ouverte', ?)`,
  ).run('ANM-ADM-1', dossier1, userIds.securite);

  // Alertes transversales.
  const alert = db.prepare(
    `INSERT INTO alerts (category, severity, message, owner_role, status) VALUES (?, ?, ?, ?, ?)`,
  );
  alert.run('TEST_STOCK', 'warning', 'Alerte stock test', 'chef_stock', 'nouvelle');
  alert.run('TEST_SEC', 'critical', 'Alerte sécurité test', 'chef_securite', 'nouvelle');
  alert.run('TEST_OLD', 'info', 'Alerte résolue test', 'admin', 'resolue');

  const { runAdminCases } = await import('./test-admin-cases');
  runAdminCases({ db, tools, userIds, productId, lotId, lotCode: 'LC-ADM-A', sizeIds });

  console.log(`\n${tools.passed.count} test(s) réussi(s).`);
}

function datetimeNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function insertDocument(
  db: Db,
  code: string,
  hash: string,
  userId: number,
  externalNo: string,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mg_documents (code, file_name, sha256, size_bytes, page_count, status, external_order_no, imported_by)
         VALUES (?, ?, ?, 1234, 2, 'valide', ?, ?)`,
      )
      .run(code, `${code}.pdf`, hash, externalNo, userId).lastInsertRowid,
  );
}

function insertOrder(
  db: Db,
  code: string,
  documentId: number,
  externalNo: string,
  status: string,
  userId: number,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mg_orders (code, document_id, external_order_no, client_name, status, created_by)
         VALUES (?, ?, ?, 'Client test', ?, ?)`,
      )
      .run(code, documentId, externalNo, status, userId).lastInsertRowid,
  );
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
