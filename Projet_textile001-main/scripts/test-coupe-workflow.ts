/**
 * Tests du workflow automatisé des lots de coupe (partie 1).
 * Exécution : npm run test:coupe-workflow
 * Base temporaire dédiée : data/test-coupe-workflow-temp.db.
 * Couvre : création automatique, récupération des données de la
 * commande, patron manquant, calcul du matelas, placement, validation,
 * régénération avec historique, résultats réels et anomalies.
 * Fonctionne hors ligne (SQLite locale, aucun appel réseau).
 */

import fs from 'node:fs';
import { check, expect, testPassed, throwsService } from './workflow-test-tools';
import { runTransferCases } from './test-coupe-workflow-cases2';

const DB_PATH = './data/test-coupe-workflow-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = DB_PATH + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  process.env.DATABASE_PATH = DB_PATH;
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const db = sessionsDb();
  type Actor = import('../src/server/users/users-service').Actor;
  const workflow = await import('../src/server/coupe/lot-workflow');
  const ordersService = await import('../src/server/orders/orders');

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
         SELECT 'Test', 'Workflow', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
      )
      .run(`test-wf-${roleCode}`, roleCode);
    return Number(result.lastInsertRowid);
  }

  const CHEF = { id: userIdFor('chef_coupe'), roleCode: 'chef_coupe' } as Actor;
  const STOCK = { id: userIdFor('chef_stock'), roleCode: 'chef_stock' } as Actor;

  const typeId = (
    db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }
  ).id;
  const productId = Number(
    db
      .prepare(
        'INSERT INTO products (nom, description, product_type_id) VALUES (?, ?, ?)',
      )
      .run('Polo Test Workflow', 'Produit test workflow', typeId).lastInsertRowid,
  );
  const colorId = (
    db.prepare('SELECT id FROM colors WHERE is_active = 1 LIMIT 1').get() as {
      id: number;
    }
  ).id;
  const sizes = db
    .prepare(
      'SELECT id, nom FROM sizes WHERE is_active = 1 ORDER BY display_order LIMIT 2',
    )
    .all() as Array<{ id: number; nom: string }>;
  expect(sizes.length === 2, 'deux tailles actives disponibles');

  // Catalogue technique Coupe pour le produit.
  db.prepare(
    `INSERT INTO coupe_catalogue (product_id, family, category, size_names_json, measurement_labels_json)
     VALUES (?, 'tshirt', 'adulte', ?, '[]')`,
  ).run(productId, JSON.stringify(sizes.map((s) => s.nom)));

  // Rouleau configuré (dimensions relevées).
  const rollsSvc = await import('../src/server/coupe/rolls');
  const planResourcesSvc = await import('../src/server/coupe/plan-resources');
  const rollId = rollsSvc.createRoll(CHEF, {
    fabricRef: 'COTON-180',
    colorId,
    initialWeightKg: 25,
  }).id;
  planResourcesSvc.configureRoll(CHEF, {
    id: rollId,
    widthCm: 180,
    usableWidthCm: 160,
    grammageGm2: 180,
    remainingM: 86.8,
    maxLayers: 60,
    motif: 'uni',
    reviewed: true,
  });

  // Tables : une active (seedée par la migration), une désactivée.
  const activeTable = db
    .prepare('SELECT id, nom, longueur_max_cm FROM coupe_tables WHERE is_active=1 LIMIT 1')
    .get() as { id: number; nom: string; longueur_max_cm: number };
  expect(Boolean(activeTable), 'table active seedée');
  const inactiveTableId = Number(
    db
      .prepare(
        `INSERT INTO coupe_tables (nom, largeur_cm, longueur_max_cm, largeur_utile_cm, couches_max, is_active)
         VALUES ('Table HS', 200, 800, 180, 60, 0)`,
      )
      .run().lastInsertRowid,
  );

  // Commande externe prête pour la coupe.
  const order = ordersService.createOrder(CHEF, {
    type: 'externe',
    clientNom: 'Client Test WF',
    productId,
    colorId,
    lines: [
      { sizeId: sizes[0].id, qty: 10 },
      { sizeId: sizes[1].id, qty: 6 },
    ],
  });

  console.log('— Création automatique du lot');

  let lotId = 0;
  check('le lot est créé depuis la commande avec les données chargées', () => {
    const lot = workflow.createLotFromOrder(CHEF, { orderId: order.id });
    lotId = lot.id;
    expect(lot.status === 'brouillon', 'statut initial brouillon');
    expect(lot.totalPlannedQty === 16, 'quantité prévue 16');
    expect(lot.orderCode === order.code, 'référence commande reprise');
    expect(lot.clientNom === 'Client Test WF', 'client repris');
    expect(lot.sizes.length === 2, 'deux tailles chargées');
  });

  check('les doublons de lots sont empêchés', () => {
    throwsService(
      () => workflow.createLotFromOrder(CHEF, { orderId: order.id }),
      409,
    );
  });

  check('un rôle non coupe ne peut pas créer de lot', () => {
    throwsService(
      () => workflow.createLotFromOrder(STOCK, { orderId: order.id }),
      403,
    );
  });

  console.log('— Vérifications automatiques');

  check('patron manquant détecté comme bloquant', () => {
    const result = workflow.checkLotReadiness(CHEF, lotId);
    expect(!result.ok, 'vérification en échec');
    expect(
      result.blockers.some((b) => b.toLowerCase().includes('patron')),
      `bloqueur patron attendu, obtenu : ${result.blockers.join(' | ')}`,
    );
  });

  // Fiches techniques et patrons réels validés pour les deux tailles.
  const { seedValidatedPatterns } = await import('./test-coupe-workflow-patterns');
  await seedValidatedPatterns(CHEF, productId, sizes);

  check('vérification prête après validation des patrons', () => {
    const result = workflow.checkLotReadiness(CHEF, lotId);
    expect(result.ok, `bloqueurs restants : ${result.blockers.join(' | ')}`);
  });

  console.log('— Matelas et plan de placement');

  check('table désactivée refusée', () => {
    throwsService(
      () =>
        workflow.proposeMatelas(CHEF, {
          lotId,
          rollId,
          coupeTableId: inactiveTableId,
        }),
      409,
    );
  });

  let proposal: ReturnType<typeof workflow.proposeMatelas>;
  check('la configuration du matelas est proposée automatiquement', () => {
    proposal = workflow.proposeMatelas(CHEF, { lotId, rollId });
    expect(proposal.matelasLengthCm > 0 && proposal.matelasLengthCm <= activeTable.longueur_max_cm, 'longueur dans la capacité');
    expect(proposal.layers > 0, 'couches proposées');
    expect(proposal.usableWidthCm === 160, 'largeur utile du rouleau');
  });

  let firstPlanId = 0;
  check('le plan de placement est généré avec les patrons réels', () => {
    const plan = workflow.generatePlan(CHEF, {
      lotId,
      rollId,
      usableWidthCm: proposal.usableWidthCm,
      matelasLengthCm: proposal.matelasLengthCm,
      layers: proposal.layers,
      grammageGm2: 180,
      coupeTableId: proposal.tableId,
    });
    firstPlanId = plan.id;
    expect(plan.status === 'proposition', 'plan en proposition');
    expect(plan.efficiency > 0 && plan.efficiency <= 100, 'taux utilisation cohérent');
    const placements = (plan.result?.placements ?? []).length;
    expect(placements > 0, 'pièces placées');
  });

  check('le lot passe en plan à valider', () => {
    const lot = workflow.getLot(CHEF, lotId);
    expect(lot.status === 'plan_a_valider', 'statut plan_a_valider');
    expect(lot.markerPlanId === firstPlanId, 'plan lié au lot');
  });

  check('la validation du plan exige une action explicite', () => {
    const lot = workflow.validatePlan(CHEF, lotId);
    expect(lot.status === 'pret_a_couper', 'statut pret_a_couper');
    expect(lot.validatedBy === CHEF.id, 'validateur enregistré');
  });

  check('la double validation est empêchée', () => {
    throwsService(() => workflow.validatePlan(CHEF, lotId), 409);
  });

  check('la régénération crée une nouvelle version et conserve l’ancienne', () => {
    const newPlan = workflow.generatePlan(CHEF, {
      lotId,
      rollId,
      usableWidthCm: proposal.usableWidthCm,
      matelasLengthCm: proposal.matelasLengthCm,
      layers: proposal.layers,
      grammageGm2: 180,
      coupeTableId: proposal.tableId,
    });
    expect(newPlan.id !== firstPlanId, 'nouvelle version du plan');
    const old = db
      .prepare('SELECT status FROM marker_plans WHERE id = ?')
      .get(firstPlanId) as { status: string };
    expect(old.status === 'valide', 'ancienne version conservée');
    workflow.validatePlan(CHEF, lotId);
  });

  console.log('— Coupe et résultats réels');

  check('le démarrage de coupe enregistre la tâche', () => {
    const lot = workflow.startCutting(CHEF, lotId);
    expect(lot.status === 'en_coupe', 'statut en_coupe');
    const task = db
      .prepare('SELECT id FROM coupe_tasks WHERE lot_id = ?')
      .get(lotId) as { id: number };
    expect(Boolean(task), 'tâche créée');
  });

  check('saisie des résultats réels différents du prévu + anomalie', () => {
    const lot = workflow.recordActual(CHEF, {
      lotId,
      lines: [
        { sizeId: sizes[0].id, cutQty: 9, usableQty: 8, anomalyQty: 1 },
        { sizeId: sizes[1].id, cutQty: 6 },
      ],
      anomalies: [
        { sizeId: sizes[0].id, type: 'tissu_defectueux', qty: 1 },
      ],
    });
    expect(lot.status === 'resultat_a_confirmer', 'statut resultat_a_confirmer');
    expect(lot.totalCutQty === 15, 'total coupé 15 (prévu 16)');
    const cut = db
      .prepare('SELECT cut_qty FROM coupe_lot_sizes WHERE lot_id=? AND size_id=?')
      .get(lotId, sizes[0].id) as { cut_qty: number };
    expect(cut.cut_qty === 9, 'quantité réelle enregistrée (9 ≠ 10 prévu)');
    const orderLine = db
      .prepare('SELECT cut_qty FROM order_lines WHERE order_id=? AND size_id=?')
      .get(order.id, sizes[0].id) as { cut_qty: number };
    expect(orderLine.cut_qty === 9, 'commande mise à jour');
    const anomaly = db
      .prepare('SELECT id FROM coupe_lot_anomalies WHERE lot_id=? AND type=?')
      .get(lotId, 'tissu_defectueux');
    expect(Boolean(anomaly), 'anomalie enregistrée');
  });

  check('les anomalies sont facultatives (aucune saisie imposée)', () => {
    const count = db
      .prepare('SELECT COUNT(*) total FROM coupe_lot_anomalies WHERE lot_id=?')
      .get(lotId) as { total: number };
    expect(count.total === 1, 'une seule anomalie déclarée volontairement');
  });

  check('les résultats ne peuvent pas être saisis deux fois', () => {
    throwsService(
      () =>
        workflow.recordActual(CHEF, {
          lotId,
          lines: [{ sizeId: sizes[0].id, cutQty: 9 }],
        }),
      409,
    );
  });

  check('la confirmation génère le ticket de coupe', () => {
    const lot = workflow.confirmResults(CHEF, lotId);
    expect(lot.status === 'coupe', 'statut coupe');
    const ticket = db
      .prepare("SELECT id FROM production_tickets WHERE lot_id=? AND type='coupe'")
      .get(lotId);
    expect(Boolean(ticket), 'ticket de coupe généré');
  });

  runTransferCases({
    db,
    workflow: workflow as typeof import('../src/server/coupe/lot-workflow'),
    CHEF,
    lotId,
    sizeIds: sizes.map((s) => s.id),
    orderId: order.id,
  });

  console.log(`\n${testPassed()} test(s) réussi(s).`);
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
