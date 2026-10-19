/**
 * Cas de tests Magasinier — partie 2 : préparation et réservations
 * atomiques, cartons multiples, vérification, dossier de sortie,
 * annulation, traçabilité et intégrité SQLite.
 */

import type { MgCaseContext, MgTestTools } from './magasinier-test-tools';
import type { ImportCaseResult } from './test-magasinier-import';

export async function runPreparationCases(
  ctx: MgCaseContext,
  tools: MgTestTools,
  results: ImportCaseResult,
): Promise<void> {
  const { db, MG, sizeIds, cartonIds } = ctx;
  const { check, rejectsService, name } = tools;
  const orders = await import('../src/server/magasinier/orders');
  const preparations = await import('../src/server/magasinier/preparations');
  const dossiers = await import('../src/server/magasinier/dossiers');
  const [sizeM, sizeL] = sizeIds;
  const order1 = results.order1;
  const order3 = results.order3;

  name('Préparation et réservations');
  const prep1 = preparations.getOrderPreparation(MG as never, order1.id);
  const prepLineM = prep1.lines.find((line) => line.sizeId === sizeM)!;
  const prepLineL = prep1.lines.find((line) => line.sizeId === sizeL)!;
  const carton1 = prepLineM.reservableCartons?.find(
    (carton) => carton.cartonId === cartonIds[0],
  );
  check('cartons clôturés réellement réservables (vue préparation)', () => {
    if (!carton1 || carton1.reservableQty !== 8) {
      throw new Error(`Carton 1 indisponible : ${JSON.stringify(carton1)}`);
    }
  });
  await rejectsService(
    () =>
      preparations.reserveStock(MG as never, {
        orderId: order1.id,
        items: [{ lineId: prepLineM.id, cartonId: cartonIds[0], qty: 99 }],
      }),
    409,
  );
  console.log('  ✔ refus d’une quantité supérieure au reste à préparer (409)');
  await rejectsService(
    () =>
      preparations.reserveStock(MG as never, {
        orderId: order1.id,
        items: [{ lineId: prepLineM.id, cartonId: 999999, qty: 1 }],
      }),
    404,
  );
  console.log('  ✔ refus d’un carton inconnu (404)');

  const stockBefore = (
    db
      .prepare(
        `SELECT COALESCE(SUM(qty), 0) AS n FROM st_movements WHERE movement_type = 'entree_cq'`,
      )
      .get() as { n: number }
  ).n;
  await rejectsService(
    () =>
      preparations.reserveStock(MG as never, {
        orderId: order1.id,
        items: [
          { lineId: prepLineM.id, cartonId: cartonIds[0], qty: 4 },
          { lineId: prepLineM.id, cartonId: 999999, qty: 1 },
        ],
      }),
    404,
  );
  const lineAfter = db
    .prepare('SELECT qty_prepared FROM mg_order_lines WHERE id = ?')
    .get(prepLineM.id) as { qty_prepared: number };
  const reservationCount = (
    db.prepare('SELECT COUNT(*) AS n FROM mg_reservations').get() as { n: number }
  ).n;
  check('transaction atomique : échec d’une ligne = aucun effet partiel', () => {
    if (lineAfter.qty_prepared !== 0 || reservationCount !== 0) {
      throw new Error('Écriture partielle détectée après échec.');
    }
  });

  preparations.reserveStock(MG as never, {
    orderId: order1.id,
    items: [
      { lineId: prepLineM.id, cartonId: cartonIds[0], qty: 4 },
      { lineId: prepLineL.id, cartonId: cartonIds[0], qty: 5 },
    ],
  });
  check('réservation valide : quantités tracées, statut partiel', () => {
    const order = orders.getOrder(MG as never, order1.id);
    if (order.status !== 'partielle') throw new Error(`Statut ${order.status}`);
    const prepared = order.lines.reduce((sum, line) => sum + line.qtyPrepared, 0);
    if (prepared !== 9) throw new Error(`Préparé ${prepared}`);
  });

  await rejectsService(
    () =>
      preparations.reserveStock(MG as never, {
        orderId: order3.id,
        items: [
          {
            lineId: orders.getOrder(MG as never, order3.id).lines.find(
              (line) => line.sizeId === sizeM,
            )!.id,
            cartonId: cartonIds[0],
            qty: 5,
          },
        ],
      }),
    409,
  );
  console.log('  ✔ réservation concurrente refusée sur quantités déjà réservées (409)');

  const order3Lines = orders.getOrder(MG as never, order3.id).lines;
  preparations.reserveStock(MG as never, {
    orderId: order3.id,
    items: [
      { lineId: order3Lines.find((line) => line.sizeId === sizeM)!.id, cartonId: cartonIds[1], qty: 5 },
      { lineId: order3Lines.find((line) => line.sizeId === sizeL)!.id, cartonId: cartonIds[1], qty: 6 },
    ],
  });
  const stockAfter = (
    db
      .prepare(
        `SELECT COALESCE(SUM(qty), 0) AS n FROM st_movements WHERE movement_type = 'entree_cq'`,
      )
      .get() as { n: number }
  ).n;
  check('plusieurs cartons utilisés ; le stock réel n’est jamais décrémenté', () => {
    if (stockAfter !== stockBefore) {
      throw new Error('Les mouvements de stock ont été modifiés.');
    }
    const complete = orders.getOrder(MG as never, order3.id);
    if (complete.status !== 'complete') throw new Error(`Statut ${complete.status}`);
  });

  const firstReservation = preparations
    .listReservations(MG as never)
    .find((item) => item.orderCode === order1.code && item.status === 'active')!;
  preparations.releaseReservation(MG as never, {
    reservationId: firstReservation.id,
    reason: 'Erreur de saisie de quantité',
  });
  check('libération contrôlée d’une réservation (motif obligatoire)', () => {
    const released = preparations
      .listReservations(MG as never)
      .find((item) => item.id === firstReservation.id)!;
    if (released.status !== 'liberee' || !released.releaseReason) {
      throw new Error('Libération non tracée.');
    }
  });
  preparations.reserveStock(MG as never, {
    orderId: order1.id,
    items: [{ lineId: prepLineL.id, cartonId: cartonIds[0], qty: 4 }],
  });

  name('Vérification et dossier de sortie');
  await rejectsService(
    () => dossiers.submitDossier(MG as never, { orderId: order1.id }),
    409,
  );
  console.log('  ✔ soumission refusée sans vérification préalable (409)');
  const verify = dossiers.verifyPreparation(MG as never, {
    orderId: order1.id,
    notes: 'Sortie partielle acceptée par le service commercial.',
  });
  check('vérification : écarts calculés côté serveur', () => {
    if (verify.result !== 'partielle' || verify.gaps.length === 0) {
      throw new Error(`Résultat ${verify.result}, écarts ${verify.gaps.length}`);
    }
  });
  const dossier = dossiers.submitDossier(MG as never, { orderId: order1.id });
  check('dossier de sortie soumis au Chef Sécurité', () => {
    if (dossier.status !== 'soumis' || dossier.version !== 1) {
      throw new Error(`Dossier ${dossier.status} v${dossier.version}`);
    }
    if (dossier.cartons.length === 0) throw new Error('Aucun carton associé.');
    const order = orders.getOrder(MG as never, order1.id);
    if (order.status !== 'soumis') throw new Error(`Commande ${order.status}`);
  });
  await rejectsService(
    () => dossiers.submitDossier(MG as never, { orderId: order1.id }),
    409,
  );
  console.log('  ✔ double soumission refusée (409)');

  name('Annulation, traçabilité et intégrité');
  orders.cancelOrder(MG as never, { orderId: order3.id, reason: 'Client a annulé' });
  check('annulation : réservations libérées et historisées', () => {
    const order = orders.getOrder(MG as never, order3.id);
    if (order.status !== 'annule') throw new Error(`Statut ${order.status}`);
    const active = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM mg_reservations WHERE order_id = ? AND status = 'active'`,
        )
        .get(order3.id) as { n: number }
    ).n;
    if (active !== 0) throw new Error('Réservations encore actives.');
  });
  const historyActions = (
    db.prepare(`SELECT DISTINCT action FROM mg_history`).all() as Array<{ action: string }>
  ).map((row) => row.action);
  check('historique complet des opérations', () => {
    for (const action of [
      'PDF_IMPORTE',
      'COMMANDE_VALIDEE',
      'STOCK_RESERVE',
      'RESERVATION_LIBEREE',
      'COMMANDE_ANNULEE',
      'DOSSIER_SOUMIS',
    ]) {
      if (!historyActions.includes(action)) {
        throw new Error(`Action manquante : ${action}`);
      }
    }
  });
  const alertCategories = (
    db.prepare(`SELECT DISTINCT category FROM alerts`).all() as Array<{ category: string }>
  ).map((row) => row.category);
  check('alertes internes levées (doublons, excédent, dossier)', () => {
    for (const category of [
      'DOUBLON_COMMANDE_MG',
      'RESERVATION_EXCEDENT_MG',
      'DOSSIER_A_VERIFIER_SEC',
    ]) {
      if (!alertCategories.includes(category)) {
        throw new Error(`Alerte manquante : ${category}`);
      }
    }
  });
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  check('intégrité SQLite : ok', () => {
    if (integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`Intégrité : ${JSON.stringify(integrity)}`);
    }
  });

  console.log(`\n${tools.passed.count} test(s) réussi(s).`);
}
