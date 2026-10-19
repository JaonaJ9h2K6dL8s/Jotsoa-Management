/**
 * Cas de test 1/2 du module Coupe : poids des rouleaux, corrections,
 * blocages, lots, tâches, résultats, consommations.
 */

import assert from 'node:assert/strict';
import {
  createTestTools,
  type CoupeTestContext,
  type CoupeTestTools,
} from './coupe-test-context';

export interface Setup1Result {
  tools: CoupeTestTools;
  rollAId: number;
  lotId: number;
  task1Id: number;
  task2Id: number;
}

/** Exécute les tests rouleaux / lots / tâches et retourne les objets créés. */
export async function runCases1(ctx: CoupeTestContext): Promise<Setup1Result> {
  const rollsSvc = await import('../src/server/coupe/rolls');
  const usageSvc = await import('../src/server/coupe/roll-usage');
  const lotsSvc = await import('../src/server/coupe/lots');
  const queriesSvc = await import('../src/server/coupe/lot-queries');
  const tasksSvc = await import('../src/server/coupe/tasks');
  const actionsSvc = await import('../src/server/coupe/task-actions');
  const tools = createTestTools((await import('../src/server/api/service-error')).ServiceError);
  const { check, throwsService } = tools;

  console.log('— Poids initial des rouleaux (9–30 kg)');
  check('8,99 kg refusé ; 9, 9,01, 29,99 et 30 kg acceptés ; 30,01 refusé', () => {
    throwsService(
      () => rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Jersey', initialWeightKg: '8,99' }),
      400,
    );
    for (const weight of ['9', '9,01', '29,99', '30']) {
      const roll = rollsSvc.createRoll(ctx.CHEF, {
        fabricRef: 'Jersey',
        initialWeightKg: weight,
      });
      assert.ok(roll.id > 0);
    }
    throwsService(
      () => rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Jersey', initialWeightKg: '30,01' }),
      400,
    );
  });
  check('vide, négatif et non numérique refusés ; code manuel unique', () => {
    throwsService(
      () => rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Jersey', initialWeightKg: '' }),
      400,
    );
    throwsService(
      () => rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Jersey', initialWeightKg: '-5' }),
      400,
    );
    throwsService(
      () => rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Jersey', initialWeightKg: 'abc' }),
      400,
    );
    const roll = rollsSvc.createRoll(ctx.CHEF, {
      code: 'RO-MANUEL-1',
      fabricRef: 'Popeline',
      initialWeightKg: 15,
    });
    assert.equal(roll.code, 'RO-MANUEL-1');
    throwsService(
      () =>
        rollsSvc.createRoll(ctx.CHEF, {
          code: 'ro-manuel-1',
          fabricRef: 'Popeline',
          initialWeightKg: 15,
        }),
      409,
    );
  });
  check('correction du poids : motif obligatoire, anciennes valeurs historisées', () => {
    const roll = rollsSvc.createRoll(ctx.CHEF, {
      fabricRef: 'Interlock',
      initialWeightKg: 12,
    });
    throwsService(
      () =>
        rollsSvc.updateRoll(ctx.CHEF, roll.id, {
          action: 'correct_weight',
          newWeightKg: 14,
        }),
      400,
    );
    const corrected = rollsSvc.updateRoll(ctx.CHEF, roll.id, {
      action: 'correct_weight',
      newWeightKg: '14,5',
      reason: 'Erreur de pesée à la réception',
    });
    assert.equal(corrected.initialWeightKg, 14.5);
    const history = ctx.db
      .prepare(
        `SELECT old_value, new_value FROM coupe_history
         WHERE entity_type = 'rouleau' AND entity_id = ?
           AND action = 'ROLL_WEIGHT_CORRECTED'`,
      )
      .get(roll.id) as { old_value: string; new_value: string };
    assert.ok(history.old_value.includes('12'));
    assert.ok(history.new_value.includes('14.5'));
    throwsService(
      () =>
        rollsSvc.updateRoll(ctx.CHEF, roll.id, {
          action: 'correct_weight',
          newWeightKg: 40,
          reason: 'x',
        }),
      400,
    );
  });
  check('rouleau bloqué : affectation refusée jusqu\'à résolution', () => {
    const roll = rollsSvc.createRoll(ctx.CHEF, { fabricRef: 'Fleece', initialWeightKg: 20 });
    rollsSvc.updateRoll(ctx.CHEF, roll.id, {
      action: 'set_status',
      status: 'bloque',
      reason: 'Tissu défectueux constaté',
    });
    throwsService(() => usageSvc.requireUsableRoll(ctx.db, roll.id), 409);
    rollsSvc.updateRoll(ctx.CHEF, roll.id, {
      action: 'set_status',
      status: 'disponible',
      reason: 'Contrôle OK',
    });
  });

  console.log('— Lots et tâches');
  const lot = lotsSvc.createLot(ctx.CHEF, {
    productId: ctx.productId,
    colorId: ctx.colorId,
    sizes: [
      { sizeId: ctx.sizeIds[0], plannedQty: 100 },
      { sizeId: ctx.sizeIds[1], plannedQty: 50 },
    ],
  });
  check('lot créé en brouillon ; quantités et tailles invalides refusées', () => {
    assert.equal(lot.status, 'brouillon');
    assert.equal(lot.totalPlannedQty, 150);
    throwsService(
      () =>
        lotsSvc.createLot(ctx.CHEF, {
          productId: ctx.productId,
          colorId: ctx.colorId,
          sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: 0 }],
        }),
      400,
    );
    throwsService(
      () =>
        lotsSvc.createLot(ctx.CHEF, {
          productId: ctx.productId,
          colorId: ctx.colorId,
          sizes: [
            { sizeId: ctx.sizeIds[0], plannedQty: 10 },
            { sizeId: ctx.sizeIds[0], plannedQty: 20 },
          ],
        }),
      400,
    );
    throwsService(
      () =>
        lotsSvc.createLot(ctx.CHEF, {
          productId: ctx.productId,
          colorId: 99999,
          sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: 10 }],
        }),
      400,
    );
    throwsService(
      () => queriesSvc.loadLotDetail(ctx.CHEF, 999999),
      404,
    );
  });
  const rollA = rollsSvc.createRoll(ctx.CHEF, {
    fabricRef: 'Jersey',
    initialWeightKg: 18,
  });
  check('démarrage de la coupe : brouillon → en cours', () => {
    const started = lotsSvc.patchLot(ctx.CHEF, lot.id, { action: 'start' });
    assert.equal(started.status, 'en_coupe');
    throwsService(
      () => lotsSvc.patchLot(ctx.CHEF, lot.id, { action: 'start' }),
      409,
    );
  });
  const task1 = tasksSvc.createTask(ctx.CHEF, {
    lotId: lot.id,
    description: 'Coupe des devants',
    rollIds: [rollA.id],
  });
  check('tâche créée ; démarrage ; fin refusée sans résultats', () => {
    assert.equal(task1.status, 'a_faire');
    assert.equal(task1.rolls.length, 1);
    actionsSvc.patchTask(ctx.CHEF, task1.id, { action: 'start' });
    throwsService(
      () => actionsSvc.patchTask(ctx.CHEF, task1.id, { action: 'finish' }),
      400,
    );
  });
  check('quantités négatives ou incohérentes refusées à la saisie', () => {
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
          results: [
            { sizeId: ctx.sizeIds[0], cutQty: -5, usableQty: 0, anomalyQty: 0, wasteQty: 0 },
          ],
        }),
      400,
    );
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
          results: [
            { sizeId: ctx.sizeIds[0], cutQty: 100, usableQty: 90, anomalyQty: 20, wasteQty: 0 },
          ],
        }),
      400,
    );
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
          results: [{ sizeId: 99999, cutQty: 10, usableQty: 0, anomalyQty: 0, wasteQty: 0 }],
        }),
      400,
    );
  });
  check('consommation > disponible refusée ; consommation valide décrémentée', () => {
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
          results: [
            { sizeId: ctx.sizeIds[0], cutQty: 100, usableQty: 100, anomalyQty: 0, wasteQty: 0 },
          ],
          consumptions: [{ rollId: rollA.id, weightUsed: 25 }],
        }),
      409,
    );
    actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
      results: [
        { sizeId: ctx.sizeIds[0], cutQty: 100, usableQty: 96, anomalyQty: 4, wasteQty: 0 },
        { sizeId: ctx.sizeIds[1], cutQty: 50, usableQty: 48, anomalyQty: 2, wasteQty: 0 },
      ],
      consumptions: [{ rollId: rollA.id, weightUsed: '8,5' }],
    });
    const detail = rollsSvc.getRollDetail(ctx.CHEF, rollA.id);
    assert.equal(detail.remainingWeightKg, 9.5);
    throwsService(
      () =>
        actionsSvc.setTaskResults(ctx.CHEF, task1.id, {
          results: [
            { sizeId: ctx.sizeIds[0], cutQty: 90, usableQty: 90, anomalyQty: 0, wasteQty: 0 },
          ],
          consumptions: [{ rollId: rollA.id, weightUsed: 10 }],
        }),
      409,
    );
  });
  check('fin de tâche puis validation par l\'exécutant lui-même', () => {
    actionsSvc.patchTask(ctx.CHEF, task1.id, { action: 'finish' });
    const validated = actionsSvc.validateTask(ctx.CHEF, task1.id, { notes: 'Conforme' });
    assert.equal(validated.status, 'validee');
    assert.equal(validated.validatedBy, ctx.CHEF.id);
  });

  return { tools, rollAId: rollA.id, lotId: lot.id, task1Id: task1.id, task2Id: 0 };
}
