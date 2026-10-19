/**
 * Cas de test 2/2 du module Coupe : validation refusée, correction après
 * validation, déchets, paquets, codes/QR, sécurité, dashboard.
 * Les transferts sont désormais couverts par test-coupe-workflow.ts.
 */

import assert from 'node:assert/strict';
import type { CoupeTestContext, CoupeTestTools } from './coupe-test-context';

/** Exécute les tests codes / sécurité / dashboard sur les objets créés. */
export async function runCases2(
  ctx: CoupeTestContext,
  tools: CoupeTestTools,
  ids: { lotId: number; rollAId: number; task1Id: number },
): Promise<void> {
  const { check, throwsService } = tools;
  const { db } = ctx;
  const tasksSvc = await import('../src/server/coupe/tasks');
  const actionsSvc = await import('../src/server/coupe/task-actions');
  const lotsSvc = await import('../src/server/coupe/lots');
  const rollsSvc = await import('../src/server/coupe/rolls');
  const queriesSvc = await import('../src/server/coupe/lot-queries');
  const wasteSvc = await import('../src/server/coupe/waste');
  const identSvc = await import('../src/server/coupe/identifiers');
  const bundlesSvc = await import('../src/server/coupe/bundles');
  const dashSvc = await import('../src/server/coupe/dashboard');

  console.log('— Correction après validation');
  check('correction sans motif refusée ; avec motif : historique + revalidation', () => {
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, ids.task1Id, {
          results: [
            { sizeId: ctx.sizeIds[0], cutQty: 95, usableQty: 95, anomalyQty: 0, wasteQty: 0 },
          ],
        }),
      400,
    );
    const corrected = actionsSvc.setTaskResults(ctx.CHEF, ids.task1Id, {
      results: [
        { sizeId: ctx.sizeIds[0], cutQty: 95, usableQty: 95, anomalyQty: 0, wasteQty: 0 },
      ],
      reason: 'Erreur de comptage',
    });
    assert.equal(corrected.status, 'terminee');
    assert.equal(corrected.validatedBy, null);
    const history = db
      .prepare(
        `SELECT old_value FROM coupe_history WHERE entity_type = 'tache'
         AND entity_id = ? AND action = 'TASK_RESULTS_CORRECTED'`,
      )
      .get(ids.task1Id) as { old_value: string };
    assert.ok(history.old_value.includes('96'));
    actionsSvc.validateTask(ctx.CHEF, ids.task1Id, {
      notes: 'Revalidé après correction',
    });
  });

  console.log('— Déchets, paquets et codes');
  let bundleId = 0;
  check('déclaration de déchet : types contrôlés, quantités positives', () => {
    const waste = wasteSvc.declareWaste(ctx.CHEF, {
      lotId: ids.lotId,
      rollId: ids.rollAId,
      wasteType: 'chute',
      qty: '2,5',
      unit: 'kg',
      reason: 'Chutes de coupe',
    });
    assert.ok(waste.id > 0);
    throwsService(
      () =>
        wasteSvc.declareWaste(ctx.CHEF, { lotId: ids.lotId, wasteType: 'chute', qty: 0 }),
      400,
    );
    throwsService(
      () =>
        wasteSvc.declareWaste(ctx.CHEF, { lotId: ids.lotId, wasteType: 'inconnu', qty: 1 }),
      400,
    );
  });
  check('paquet : code + QR générés, recherche par code et payload QR', () => {
    const bundle = bundlesSvc.createBundle(ctx.CHEF, {
      lotId: ids.lotId,
      sizeId: ctx.sizeIds[0],
      qty: 48,
    });
    bundleId = bundle.id;
    assert.ok(bundle.code.startsWith('PKG-'));
    const byCode = identSvc.lookupByCode(ctx.CHEF, bundle.code);
    assert.equal(byCode.objectType, 'paquet');
    const byQr = identSvc.lookupByCode(ctx.CHEF, bundle.qrPayload);
    assert.equal(byQr.objectId, byCode.objectId);
    const rollIdent = identSvc.lookupByCode(ctx.CHEF, 'RO-MANUEL-1');
    assert.equal(rollIdent.objectType, 'rouleau');
    throwsService(() => identSvc.lookupByCode(ctx.CHEF, 'CODE-INCONNU'), 404);
    throwsService(() => identSvc.reprintLabel(ctx.CHEF, 'paquet', 999999), 404);
    identSvc.reprintLabel(ctx.CHEF, 'paquet', bundle.id);
    const count = (
      db
        .prepare(
          `SELECT reprint_count AS n FROM coupe_identifiers
           WHERE object_type = 'paquet' AND object_id = ?`,
        )
        .get(bundle.id) as { n: number }
    ).n;
    assert.equal(count, 1);
  });

  console.log('— Sécurité et tableau de bord');
  check('rôles non autorisés (dont admin) refusés sur les opérations coupe', () => {
    throwsService(
      () =>
        rollsSvc.createRoll(ctx.STOCK, { fabricRef: 'X', initialWeightKg: 15 }),
      403,
    );
    throwsService(() => rollsSvc.listRolls(ctx.STOCK), 403);
    throwsService(
      () =>
        lotsSvc.createLot(ctx.ADMIN, {
          productId: ctx.productId,
          colorId: ctx.colorId,
          sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: 10 }],
        }),
      403,
    );
    throwsService(() => wasteSvc.listWaste(ctx.STOCK), 403);
    throwsService(() => identSvc.lookupByCode(ctx.ADMIN, 'RO-MANUEL-1'), 403);
    throwsService(() => actionsSvc.validateTask(ctx.STOCK, ids.task1Id, {}), 403);
  });
  check('tableau de bord : compteurs réels cohérents', () => {
    const dash = dashSvc.getDashboard(ctx.CHEF);
    assert.ok((dash.tasksByStatus['validee'] ?? 0) >= 1);
    assert.ok(dash.quantities.cutQty >= 145);
    assert.ok(Array.isArray(dash.recentHistory));
  });
  check('historique : opérations tracées', () => {
    const history = db
      .prepare('SELECT COUNT(*) AS n FROM coupe_history')
      .get() as { n: number };
    assert.ok(history.n > 10);
  });
}
