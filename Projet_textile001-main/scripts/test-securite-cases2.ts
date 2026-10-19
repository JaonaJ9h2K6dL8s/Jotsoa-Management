/**
 * Cas de tests Sécurité — partie 2 : carton manquant, demande de
 * correction, invalidation du contrôle, contrôle détaillé des
 * quantités, carton déjà sorti, historique, intégrité SQLite.
 */

import type { MgTestTools } from './magasinier-test-tools';
import type { SecCaseContext } from './test-securite-cases1';

type SecModules = {
  dossiers: typeof import('../src/server/securite/dossiers');
  controles: typeof import('../src/server/securite/controles');
  count: typeof import('../src/server/securite/count');
  anomalies: typeof import('../src/server/securite/anomalies');
  decisions: typeof import('../src/server/securite/decisions');
  sorties: typeof import('../src/server/securite/sorties');
};

export async function runSecurityCasesPart2(
  ctx: SecCaseContext,
  tools: MgTestTools,
  modules: SecModules,
): Promise<void> {
  const { db, SEC, SEC2, MG, cartonIds, cartonCodes, order2, order3 } = ctx;
  const { check, rejectsService, name } = tools;
  const { controles, count, anomalies, decisions, sorties } = modules;
  const dossiersMg = await import('../src/server/magasinier/dossiers');

  name('Carton manquant et demande de correction (dossier 2, v1)');
  const control2 = controles.startControl(SEC as never, {
    dossierId: order2.dossier.id,
    level: 'quantites',
  });
  const finished2 = count.finishControl(SEC as never, { controleId: control2.id });
  check('aucun carton compté : carton manquant détecté (critique)', () => {
    if (finished2.status !== 'non_conforme') throw new Error(`Statut : ${finished2.status}`);
    const missing = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies WHERE controle_id = ? AND type = 'carton_manquant' AND status = 'ouverte'`,
        )
        .get(control2.id) as { n: number }
    ).n;
    if (missing !== 1) throw new Error(`Anomalies manquantes : ${missing}`);
    const qtyGaps = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies WHERE controle_id = ? AND type = 'quantite_ecart' AND status = 'ouverte'`,
        )
        .get(control2.id) as { n: number }
    ).n;
    if (qtyGaps !== 2) throw new Error(`Quantités non vérifiées : ${qtyGaps}`);
  });
  await rejectsService(
    () =>
      decisions.decide(SEC as never, {
        dossierId: order2.dossier.id,
        decision: 'autorisee',
      }),
    409,
  );
  console.log('  ✔ sortie bloquée avec anomalie bloquante (409)');

  anomalies.requestCorrection(SEC as never, {
    dossierId: order2.dossier.id,
    reason: 'Carton non présenté : reprendre la préparation.',
  });
  check('demande de correction : la commande repart en « retour »', () => {
    const status = (
      db.prepare('SELECT status FROM mg_orders WHERE id = ?').get(order2.orderId) as { status: string }
    ).status;
    if (status !== 'retour') throw new Error(`Commande : ${status}`);
  });
  await rejectsService(
    () =>
      anomalies.requestCorrection(SEC as never, {
        dossierId: order2.dossier.id,
        reason: 'Deuxième demande : dossier déjà en retour.',
      }),
    409,
  );
  console.log('  ✔ double demande de correction refusée (409)');

  name('Reprise après correction du magasinier (dossier 2, v2)');
  dossiersMg.resumeAfterCorrection(MG as never, { orderId: order2.orderId });
  dossiersMg.verifyPreparation(MG as never, { orderId: order2.orderId });
  const dossier2v2 = dossiersMg.submitDossier(MG as never, { orderId: order2.orderId });
  check('resoumission : nouvelle version, ancienne annulée', () => {
    if (dossier2v2.id === order2.dossier.id) throw new Error('Même dossier réutilisé.');
    const oldStatus = (
      db.prepare('SELECT status FROM mg_dossiers WHERE id = ?').get(order2.dossier.id) as { status: string }
    ).status;
    if (oldStatus !== 'annule') throw new Error(`Ancien dossier : ${oldStatus}`);
  });
  await rejectsService(
    () => controles.startControl(SEC as never, { dossierId: order2.dossier.id }),
    409,
  );
  console.log('  ✔ contrôle refusé sur l’ancienne version (409)');

  const control2b = controles.startControl(SEC as never, {
    dossierId: dossier2v2.id,
    level: 'quantites',
  });
  const control2Status = (
    db.prepare('SELECT status FROM sec_controles WHERE id = ?').get(control2.id) as { status: string }
  ).status;
  check('contrôle obsolète invalidé automatiquement', () => {
    if (control2Status !== 'invalide') throw new Error(`Contrôle : ${control2Status}`);
  });
  const scanA = count.recordScan(SEC as never, {
    controleId: control2b.id,
    code: cartonCodes[2],
  });
  if (scanA.result !== 'attendu') throw new Error(`Scan carton C : ${scanA.result}`);
  // Le carton A a quitté l'usine (sortie confirmée) : présenté à tort.
  const scanOld = count.recordScan(SEC as never, {
    controleId: control2b.id,
    code: cartonCodes[0],
  });
  check('carton déjà sorti présenté : supplémentaire + déjà sorti', () => {
    if (scanOld.result !== 'supplementaire') throw new Error(`Scan : ${scanOld.result}`);
    const anomalies2 = (
      db
        .prepare(
          `SELECT type, COUNT(*) AS n FROM sec_anomalies
           WHERE controle_id = ? AND carton_id = ? AND status = 'ouverte'
           GROUP BY type`,
        )
        .all(control2b.id, cartonIds[0]) as Array<{ type: string; n: number }>
    );
    const types = new Map(anomalies2.map((row) => [row.type, row.n]));
    if (types.get('carton_supplementaire') !== 1 || types.get('carton_deja_sorti') !== 1) {
      throw new Error(`Anomalies carton A : ${JSON.stringify(anomalies2)}`);
    }
  });

  const finished2b = count.finishControl(SEC as never, { controleId: control2b.id });
  check('quantités non vérifiées : attente de correction', () => {
    if (finished2b.status !== 'non_conforme') throw new Error(`Statut : ${finished2b.status}`);
  });
  // Résolution des deux anomalies critiques (contre-vérifications).
  const criticals = (
    db
      .prepare(
        `SELECT id, type FROM sec_anomalies
         WHERE controle_id = ? AND status = 'ouverte' AND severity = 'critical' ORDER BY id`,
      )
      .all(control2b.id) as Array<{ id: number; type: string }>
  ).filter((row) => row.type !== 'carton_manquant' && row.type !== 'quantite_ecart');
  for (const critical of criticals) {
    anomalies.resolveAnomaly(SEC as never, {
      anomalyId: critical.id,
      reason: 'Écart constaté et carton écarté de la sortie.',
    });
    const request = (
      db
        .prepare(
          `SELECT id FROM sensitive_requests
           WHERE entity_type = 'sec_anomalie' AND entity_id = ? AND status = 'en_attente'`,
        )
        .get(critical.id) as { id: number }
    ).id;
    anomalies.approveCounterCheck(SEC2 as never, { requestId: request });
  }
  // Vérification détaillée : écart volontaire puis correction.
  const lines2 = (
    db
      .prepare('SELECT id, qty_prepared FROM mg_order_lines WHERE order_id = ? ORDER BY id')
      .all(order2.orderId) as Array<{ id: number; qty_prepared: number }>
  );
  count.recordLineCheck(SEC as never, {
    controleId: control2b.id,
    orderLineId: lines2[0].id,
    qtyChecked: lines2[0].qty_prepared + 1,
  });
  const finished2c = count.finishControl(SEC as never, { controleId: control2b.id });
  check('écart de quantité détecté lors du contrôle détaillé', () => {
    if (finished2c.status !== 'non_conforme') throw new Error(`Statut : ${finished2c.status}`);
    const gaps = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies WHERE controle_id = ? AND type = 'quantite_ecart' AND severity = 'critical' AND status = 'ouverte'`,
        )
        .get(control2b.id) as { n: number }
    ).n;
    if (gaps !== 1) throw new Error(`Écarts critiques : ${gaps}`);
  });
  count.recordLineCheck(SEC as never, {
    controleId: control2b.id,
    orderLineId: lines2[0].id,
    qtyChecked: lines2[0].qty_prepared,
  });
  count.recordLineCheck(SEC as never, {
    controleId: control2b.id,
    orderLineId: lines2[1].id,
    qtyChecked: lines2[1].qty_prepared,
  });
  const finished2d = count.finishControl(SEC as never, { controleId: control2b.id });
  check('contrôle conforme après corrections (recalcul des écarts)', () => {
    if (finished2d.status !== 'conforme') throw new Error(`Statut : ${finished2d.status}`);
  });

  const decision2 = decisions.decide(SEC as never, {
    dossierId: dossier2v2.id,
    decision: 'autorisee',
    reason: 'Contrôle détaillé conforme.',
  });
  check('sortie autorisée mais non confirmée : stock intact', () => {
    if (decision2.decision !== 'autorisee') throw new Error(`Décision : ${decision2.decision}`);
    const sortie = sorties
      .listSorties(SEC as never)
      .find((item) => item.dossierCode === dossier2v2.code)!;
    if (sortie.status !== 'autorisee') throw new Error(`Sortie : ${sortie.status}`);
    const movements = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM st_movements WHERE movement_type = 'sortie' AND reason LIKE '%${sortie.code}%'`)
        .get() as { n: number }
    ).n;
    if (movements !== 0) throw new Error('Mouvement créé sans confirmation physique.');
  });

  name('Dossier 3 : historique et traçabilité');
  const control3 = controles.startControl(SEC as never, { dossierId: order3.dossier.id });
  count.recordScan(SEC as never, { controleId: control3.id, code: cartonCodes[3] });
  count.finishControl(SEC as never, { controleId: control3.id });
  decisions.decide(SEC as never, {
    dossierId: order3.dossier.id,
    decision: 'refusee',
    reason: 'Test de refus enregistré.',
  });
  check('historique complet des opérations', () => {
    const actions = (
      db.prepare('SELECT DISTINCT action FROM sec_history').all() as Array<{ action: string }>
    ).map((row) => row.action);
    const expected = [
      'CONTROLE_DEMARRE',
      'CARTON_COMPTE',
      'CONTROLE_CLOTURE',
      'ANOMALIE_RESOLUE',
      'CONTREVERIFICATION_APPROUVEE',
      'CONTROLE_INVALIDE',
      'CORRECTION_DEMANDEE',
      'DECISION_ENREGISTREE',
      'SORTIE_AUTORISEE',
      'SORTIE_CONFIRMEE',
    ];
    for (const action of expected) {
      if (!actions.includes(action)) throw new Error(`Action absente : ${action}`);
    }
  });

  name('Tableau de bord');
  const dashboard = await import('../src/server/securite/dashboard');
  const metrics = dashboard.getDashboard(SEC as never);
  check('tableau de bord cohérent avec les données réelles', () => {
    if (metrics.sortiesConfirmed !== 1) throw new Error(`Confirmées : ${metrics.sortiesConfirmed}`);
    if (metrics.sortiesAuthorized < 1) throw new Error(`Autorisées : ${metrics.sortiesAuthorized}`);
    if (metrics.controlsConforme < 2) throw new Error(`Conformes : ${metrics.controlsConforme}`);
  });

  name('Intégrité SQLite');
  check('intégrité de la base de test', () => {
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result[0].integrity_check !== 'ok') {
      throw new Error(`integrity_check : ${result[0].integrity_check}`);
    }
  });
}
