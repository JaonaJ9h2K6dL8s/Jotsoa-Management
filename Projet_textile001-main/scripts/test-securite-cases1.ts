/**
 * Cas de tests Sécurité — partie 1 : rôle, réception, comptage,
 * anomalies, contre-vérification, décision et confirmation de sortie
 * sur le dossier 1.
 */

import type { ActorStub, MgTestTools } from './magasinier-test-tools';

export interface SecCaseContext {
  db: import('better-sqlite3').Database;
  ServiceError: typeof import('../src/server/api/service-error').ServiceError;
  SEC: ActorStub;
  SEC2: ActorStub;
  ST: ActorStub;
  MG: ActorStub;
  productId: number;
  sizeM: number;
  sizeL: number;
  cartonIds: number[];
  cartonCodes: string[];
  order1: { orderId: number; dossier: { id: number; code: string } };
  order2: { orderId: number; dossier: { id: number; code: string }; lineIds: Map<number, number> };
  order3: { orderId: number; dossier: { id: number; code: string } };
}

type SecModules = {
  dossiers: typeof import('../src/server/securite/dossiers');
  controles: typeof import('../src/server/securite/controles');
  count: typeof import('../src/server/securite/count');
  anomalies: typeof import('../src/server/securite/anomalies');
  decisions: typeof import('../src/server/securite/decisions');
  sorties: typeof import('../src/server/securite/sorties');
};

export async function runSecurityCasesPart1(
  ctx: SecCaseContext,
  tools: MgTestTools,
  modules: SecModules,
): Promise<void> {
  const { db, ServiceError, SEC, SEC2, ST, cartonIds, cartonCodes, order1 } = ctx;
  const { check, rejectsService, name } = tools;
  const { dossiers, controles, count, anomalies, decisions, sorties } = modules;
  const movementsModule = await import('../src/server/stock/movements');

  name('Sécurité des rôles et réception');
  check('un chef_stock ne peut pas voir les dossiers (403)', () => {
    let threw = false;
    try {
      dossiers.listDossiers(ST as never);
    } catch (error) {
      threw = error instanceof ServiceError && error.status === 403;
    }
    if (!threw) throw new Error('Accès autorisé à tort.');
  });
  await rejectsService(() => controles.startControl(ST as never, { dossierId: 1 }), 403);
  console.log('  ✔ un chef_stock ne peut pas démarrer un contrôle (403)');
  await rejectsService(() => controles.startControl(SEC as never, { dossierId: 999999 }), 404);
  console.log('  ✔ dossier inexistant refusé (404)');

  const received = dossiers.listDossiers(SEC as never);
  check('dossiers réellement soumis reçus du magasinier', () => {
    for (const expected of [order1.dossier.code]) {
      if (!received.some((dossier) => dossier.code === expected)) {
        throw new Error(`Dossier ${expected} absent de la file.`);
      }
    }
    const dossier1 = received.find((dossier) => dossier.id === order1.dossier.id)!;
    if (dossier1.cartons.length !== 2) {
      throw new Error(`Cartons attendus : ${dossier1.cartons.length}`);
    }
  });

  name('Comptage physique (dossier 1)');
  const control1 = controles.startControl(SEC as never, {
    dossierId: order1.dossier.id,
    level: 'cartons',
  });
  const scan1 = count.recordScan(SEC as never, {
    controleId: control1.id,
    code: `JO|CARTON|${cartonCodes[0]}`,
  });
  check('carton attendu compté via payload QR', () => {
    if (scan1.result !== 'attendu' || scan1.expectedLeft !== 1) {
      throw new Error(`Scan : ${scan1.result}, restant ${scan1.expectedLeft}`);
    }
  });
  const scan2 = count.recordScan(SEC as never, {
    controleId: control1.id,
    code: cartonCodes[0],
  });
  check('double comptage signalé sans augmenter le total', () => {
    if (scan2.result !== 'doublon') throw new Error(`Scan : ${scan2.result}`);
    const doubles = control1.anomalies;
    void doubles;
    const open = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies WHERE controle_id = ? AND type = 'carton_double'`,
        )
        .get(control1.id) as { n: number }
    ).n;
    if (open !== 1) throw new Error('Anomalie de doublon absente.');
  });
  const scan3 = count.recordScan(SEC as never, {
    controleId: control1.id,
    code: 'CT-INCONNU',
  });
  check('carton inconnu détecté et bloquant', () => {
    if (scan3.result !== 'inconnu') throw new Error(`Scan : ${scan3.result}`);
  });
  const scan4 = count.recordScan(SEC as never, {
    controleId: control1.id,
    code: cartonCodes[1],
  });
  if (scan4.result !== 'attendu') throw new Error(`Scan carton 2 : ${scan4.result}`);

  const finished1 = count.finishControl(SEC as never, { controleId: control1.id });
  check('clôture : contrôle non conforme à cause de l’anomalie critique', () => {
    if (finished1.status !== 'non_conforme') {
      throw new Error(`Statut : ${finished1.status}`);
    }
    if (finished1.observations.length !== 2) {
      throw new Error(`Observations : ${finished1.observations.length}`);
    }
  });

  name('Décision bloquée puis contre-vérification');
  await rejectsService(
    () =>
      decisions.decide(SEC as never, {
        dossierId: order1.dossier.id,
        decision: 'autorisee',
      }),
    409,
  );
  console.log('  ✔ autorisation refusée avec anomalie critique ouverte (409)');
  const unknownAnomaly = (
    db
      .prepare(
        `SELECT id FROM sec_anomalies WHERE controle_id = ? AND type = 'carton_inconnu' AND status = 'ouverte'`,
      )
      .get(control1.id) as { id: number }
  ).id;
  const resolved = anomalies.resolveAnomaly(SEC as never, {
    anomalyId: unknownAnomaly,
    reason: 'Carton étranger présenté par erreur, retourné à la zone.',
  });
  check('anomalie critique : contre-vérification exigée, aucun effet immédiat', () => {
    if (resolved.status !== 'contrev_crequise') {
      throw new Error(`Résolution : ${resolved.status}`);
    }
    const stillOpen = (
      db
        .prepare('SELECT status FROM sec_anomalies WHERE id = ?')
        .get(unknownAnomaly) as { status: string }
    ).status;
    if (stillOpen !== 'ouverte') throw new Error('Anomalie fermée sans approbation.');
  });
  const pending = (
    db
      .prepare(
        `SELECT id, requested_by FROM sensitive_requests
         WHERE entity_type = 'sec_anomalie' AND entity_id = ? AND status = 'en_attente'`,
      )
      .get(unknownAnomaly) as { id: number; requested_by: number }
  ).id;
  let selfApproved = false;
  try {
    anomalies.approveCounterCheck(SEC as never, { requestId: pending });
  } catch {
    selfApproved = true;
  }
  check('auto-approbation impossible (auteur ≠ approbateur)', () => {
    if (!selfApproved) throw new Error('L’auteur a pu approuver sa propre demande.');
  });
  anomalies.approveCounterCheck(SEC2 as never, { requestId: pending, note: 'Vérifié physiquement.' });
  console.log('  ✔ contre-vérification approuvée par une seconde personne');

  const doubleAnomaly = (
    db
      .prepare(
        `SELECT id FROM sec_anomalies WHERE controle_id = ? AND type = 'carton_double' AND status = 'ouverte'`,
      )
      .get(control1.id) as { id: number }
  ).id;
  const resolvedDouble = anomalies.resolveAnomaly(SEC as never, {
    anomalyId: doubleAnomaly,
    reason: 'Présentation répétée, observation unique conservée.',
  });
  check('anomalie non critique résolue directement', () => {
    if (resolvedDouble.status !== 'resolue') {
      throw new Error(`Résolution : ${resolvedDouble.status}`);
    }
  });

  const refinished1 = count.finishControl(SEC as never, { controleId: control1.id });
  check('reprise du contrôle : conforme après résolution', () => {
    if (refinished1.status !== 'conforme') {
      throw new Error(`Statut : ${refinished1.status}`);
    }
  });

  name('Sortie autorisée puis physiquement confirmée');
  const movementsBefore = (
    db.prepare(`SELECT COUNT(*) AS n FROM st_movements WHERE movement_type = 'sortie'`).get() as { n: number }
  ).n;
  const decision = decisions.decide(SEC as never, {
    dossierId: order1.dossier.id,
    decision: 'autorisee',
    reason: 'Contrôle conforme, aucun écart.',
  });
  check('sortie autorisée (distincte de la confirmation)', () => {
    if (decision.decision !== 'autorisee') throw new Error(`Décision : ${decision.decision}`);
    const sortie = sorties
      .listSorties(SEC as never)
      .find((item) => item.dossierCode === order1.dossier.code)!;
    if (sortie.status !== 'autorisee' || sortie.movementLogged) {
      throw new Error(`Sortie : ${sortie.status}, mouvement ${sortie.movementLogged}`);
    }
    const movementsAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM st_movements WHERE movement_type = 'sortie'`).get() as { n: number }
    ).n;
    if (movementsAfter !== movementsBefore) {
      throw new Error('Le stock a été décrémenté à la simple autorisation.');
    }
  });
  await rejectsService(
    () =>
      decisions.decide(SEC as never, {
        dossierId: order1.dossier.id,
        decision: 'autorisee',
      }),
    409,
  );
  console.log('  ✔ double autorisation refusée (409)');

  const sortie = sorties
    .listSorties(SEC as never)
    .find((item) => item.dossierCode === order1.dossier.code)!;
  const availableBefore = (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN -qty ELSE qty END), 0) AS total
         FROM st_movements WHERE movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')`,
      )
      .get() as { total: number }
  ).total;
  const confirmed = sorties.confirmSortie(SEC as never, { sortieId: sortie.id });
  check('confirmation physique : mouvement de stock enregistré une seule fois', () => {
    if (confirmed.status !== 'confirmee' || !confirmed.movementLogged) {
      throw new Error(`Sortie : ${confirmed.status}, mouvement ${confirmed.movementLogged}`);
    }
    const movementsAfter = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM st_movements WHERE movement_type = 'sortie' AND reason LIKE '%${sortie.code}%'`)
        .get() as { n: number }
    ).n;
    if (movementsAfter !== 2) {
      throw new Error(`Mouvements de sortie créés : ${movementsAfter} (attendu 2)`);
    }
    const availableAfter = (
      db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN -qty ELSE qty END), 0) AS total
           FROM st_movements WHERE movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')`,
        )
        .get() as { total: number }
    ).total;
    if (availableAfter !== availableBefore - 9) {
      throw new Error(`Solde : ${availableAfter} vs ${availableBefore} - 9`);
    }
    const cartonStatus = (
      db.prepare('SELECT status FROM st_cartons WHERE id = ?').get(cartonIds[0]) as { status: string }
    ).status;
    if (cartonStatus !== 'partiellement_sorti') {
      throw new Error(`Carton A : ${cartonStatus}`);
    }
  });
  await rejectsService(() => sorties.confirmSortie(SEC as never, { sortieId: sortie.id }), 409);
  console.log('  ✔ double confirmation refusée (409)');
  await rejectsService(
    () => controles.startControl(SEC as never, { dossierId: order1.dossier.id }),
    409,
  );
  console.log('  ✔ aucun nouveau contrôle après sortie confirmée (409)');

  check('le chef sécurité ne peut pas écrire dans le stock (403)', () => {
    let threw = false;
    try {
      movementsModule.recordSortie(SEC as never, {
        lotId: 1,
        sizeId: 1,
        qty: 1,
        reason: 'Tentative directe',
      });
    } catch (error) {
      threw = error instanceof ServiceError && error.status === 403;
    }
    if (!threw) throw new Error('Sortie directe autorisée à tort.');
  });
}
