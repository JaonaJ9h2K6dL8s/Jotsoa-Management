/**
 * Cas de tests du module Rapports & pilotage (étape 11).
 * Exécuté par l'orchestrateur scripts/test-admin.ts (npm run test:admin).
 * Vérifie les 20 catégories exigées : indicateurs, filtres, comparaisons,
 * anti-doubles comptages, données manquantes, exports, alertes,
 * performance, intégrité SQLite et audit 400 lignes.
 */

import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import type { sessionsDb } from '../src/server/auth/sessions';
import type { CoutureTestTools } from './couture-test-utils';
import { resolvePeriod } from '../src/server/admin/periods';
import { parseReportFilters, type ReportFilters } from '../src/server/admin/filters';
import { resolveSection, transversalAlerts } from '../src/server/admin/sections';
import { buildPeriodKpi } from '../src/server/admin/overview';
import { FLOW_SOURCES } from '../src/server/admin/overview-sources';
import { initialConformityRate } from '../src/server/admin/report-production';
import { stockReport } from '../src/server/admin/report-logistics';
import { buildWorkbook, buildPdf } from '../src/server/admin/exports';
import { finalizeReport, type SectionPayload } from '../src/server/admin/report-types';

export interface AdminContext {
  db: ReturnType<typeof sessionsDb>;
  tools: CoutureTestTools;
  userIds: Record<string, number>;
  productId: number;
  lotId: number;
  lotCode: string;
  sizeIds: number[];
}

const MONTH = new URLSearchParams('period=mois');
const EMPTY: ReportFilters = parseReportFilters(new URLSearchParams());

function kpiValue(payload: SectionPayload, key: string): number {
  const kpi = payload.kpis.find((item) => item.key === key);
  if (!kpi) throw new Error(`KPI ${key} introuvable dans la section.`);
  return kpi.value;
}

function noFilters(params: string): ReportFilters {
  return parseReportFilters(new URLSearchParams(params));
}

export function runAdminCases(ctx: AdminContext): void {
  const { db, tools } = ctx;
  const { current, previous } = resolvePeriod(MONTH);
  const section = resolveSection('general');
  const general = section.build({ current, previous, filters: EMPTY });

  tools.check('périodes : presets valides, erreurs 400', () => {
    for (const preset of ['jour', 'semaine', 'mois', 'trimestre', 'annee']) {
      resolvePeriod(new URLSearchParams(`period=${preset}`));
    }
    for (const bad of [
      'period=hebdo',
      'period=personnalisee',
      'period=personnalisee&from=2026-01-10&to=2026-01-01',
      'period=personnalisee&from=2026-13-01&to=2026-13-05',
    ]) {
      let threw = false;
      try {
        resolvePeriod(new URLSearchParams(bad));
      } catch (error) {
        threw = true;
        if (!(error as { status?: number }).status) throw error;
      }
      if (!threw) throw new Error(`Période invalide acceptée : ${bad}`);
    }
  });

  tools.check('comparaison : période précédente de même durée', () => {
    const days = (from: string, to: string) =>
      Math.round((Date.parse(to.replace(' ', 'T') + 'Z') - Date.parse(from.replace(' ', 'T') + 'Z')) / 86_400_000);
    const cur = resolvePeriod(new URLSearchParams('period=mois'));
    const curDays = days(cur.current.from, cur.current.to);
    const prevDays = days(cur.previous.from, cur.previous.to);
    if (curDays !== prevDays) throw new Error(`Durées différentes : ${curDays} vs ${prevDays}`);
    const custom = resolvePeriod(new URLSearchParams('period=personnalisee&from=2000-01-01&to=2000-01-07'));
    // Fenêtre de 7 jours inclusifs mesurée avec la borne de fin exclusive.
    if (days(custom.current.from, custom.current.to) !== 7) {
      throw new Error('Durée personnalisée incorrecte.');
    }
    if (days(custom.previous.from, custom.previous.to) !== 7) {
      throw new Error('Période précédente personnalisée de durée différente.');
    }
  });

  tools.check('comparaison : dénominateur nul → pas de pourcentage', () => {
    const empty = resolvePeriod(
      new URLSearchParams('period=personnalisee&from=2000-01-01&to=2000-01-07'),
    );
    const kpi = buildPeriodKpi(FLOW_SOURCES[0], empty.current, empty.previous, EMPTY);
    if (kpi.previous !== 0 || kpi.deltaPercent !== null) {
      throw new Error('Pourcentage calculé sur un dénominateur nul.');
    }
  });

  tools.check('généraux : quantités coupées issues de coupe_results', () => {
    const value = kpiValue(general, 'coupe_cut');
    const row = db
      .prepare('SELECT COALESCE(SUM(cut_qty), 0) AS n FROM coupe_results')
      .get() as { n: number };
    if (value !== row.n) throw new Error(`coupe_cut ${value} ≠ SQL ${row.n}`);
    if (kpiValue(general, 'coupe_usable') !== 28) {
      throw new Error('coupe_usable inattendu.');
    }
  });

  tools.check('couture : seules les productions normales comptent', () => {
    const value = kpiValue(general, 'couture_cousu');
    if (value !== 20) throw new Error(`couture_cousu ${value} ≠ 20 (annulée exclue).`);
  });

  tools.check('qualité : contrôlées / conformes / défectueuses', () => {
    if (kpiValue(general, 'cq_controle') !== 20) throw new Error('cq_controle ≠ 20');
    if (kpiValue(general, 'cq_conforme') !== 18) throw new Error('cq_conforme ≠ 18');
    if (kpiValue(general, 'cq_defectueuses') !== 2) throw new Error('cq_defectueuses ≠ 2');
  });

  tools.check('qualité : taux de conformité initiale', () => {
    const rate = initialConformityRate(current, EMPTY);
    if (rate.controlled !== 20 || rate.conforme !== 18) {
      throw new Error('Périmètre du taux incorrect.');
    }
    if (rate.rate === null || Math.abs(rate.rate - 90) > 0.01) {
      throw new Error(`Taux ${rate.rate} ≠ 90 %`);
    }
  });

  tools.check('qualité : pièces défectueuses ≠ défauts déclarés', () => {
    const defects = db
      .prepare('SELECT COALESCE(SUM(qty_pieces), 0) AS n FROM cq_defauts')
      .get() as { n: number };
    if (defects.n !== 3) throw new Error('Somme des défauts attendue : 3.');
    if (kpiValue(general, 'cq_defectueuses') === defects.n) {
      throw new Error('Les défauts multiples ont été additionnés en pièces.');
    }
  });

  tools.check('retouche : interventions ≠ demandes (double comptage)', () => {
    if (kpiValue(general, 'rt_interventions') !== 2) throw new Error('Interventions ≠ 2');
    if (kpiValue(general, 'rt_demandes') !== 1) throw new Error('Demandes ≠ 1');
  });

  tools.check('stock : soldes = entrées + retours − sorties (transferts exclus)', () => {
    const stockSection = resolveSection('stock').build({ current, previous, filters: EMPTY });
    const balances = stockSection.tables.find((item) => item.key === 'stock_balances');
    if (!balances) throw new Error('Table stock_balances manquante.');
    const rows = balances.rows.filter((row) => row.lot === ctx.lotCode) as Array<{
      taille: string;
      'en stock': number;
    }>;
    const bySize = new Map(rows.map((row) => [row.taille, row['en stock']]));
    const sizes = (
      db.prepare('SELECT id, nom FROM sizes WHERE id IN (?, ?)').all(ctx.sizeIds[0], ctx.sizeIds[1]) as Array<{
        id: number;
        nom: string;
      }>
    ).map((row) => ({ ...row }));
    const nom0 = sizes.find((row) => row.id === ctx.sizeIds[0])!.nom;
    const nom1 = sizes.find((row) => row.id === ctx.sizeIds[1])!.nom;
    if (bySize.get(nom0) !== 17) throw new Error(`Taille 0 : ${bySize.get(nom0)} ≠ 17 (20 − 3)`);
    if (bySize.get(nom1) !== 22) throw new Error(`Taille 1 : ${bySize.get(nom1)} ≠ 22 (20 + 2)`);
    if (bySize.get(nom0) === 22) throw new Error('Le transfert interne a été compté.');
  });

  tools.check('stock : KPI entrées / sorties de la période', () => {
    if (kpiValue(general, 'stock_entrees') !== 40) throw new Error('stock_entrees ≠ 40');
    if (kpiValue(general, 'stock_sorties') !== 3) throw new Error('stock_sorties ≠ 3');
  });

  tools.check('sorties : autorisée ≠ confirmée', () => {
    const value = kpiValue(general, 'sorties_confirmees');
    if (value !== 1) throw new Error(`sorties_confirmees ${value} ≠ 1`);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM sec_sorties WHERE status = 'autorisee'")
      .get() as { n: number };
    if (count.n !== 1) throw new Error('Sortie autorisée non tracée.');
  });

  tools.check('commandes : préparation ≠ sortie définitive (snapshots)', () => {
    if (kpiValue(general, 'commandes_preparation') !== 1) {
      throw new Error('Commandes en préparation ≠ 1');
    }
    const movements = db
      .prepare("SELECT COUNT(*) AS n FROM st_movements WHERE movement_type = 'sortie'")
      .get() as { n: number };
    if (movements.n !== 1) throw new Error('Aucun mouvement de sortie physique attendu ici.');
  });

  tools.check('dossiers : attente de sécurité = dernière version sans résultat', () => {
    if (kpiValue(general, 'dossiers_attente') !== 1) {
      throw new Error('dossiers_attente ≠ 1');
    }
  });

  tools.check('anomalies critiques ouvertes (snapshot)', () => {
    if (kpiValue(general, 'anomalies_bloquantes') !== 1) {
      throw new Error('anomalies_bloquantes ≠ 1');
    }
  });

  tools.check('données manquantes : taux null (Données insuffisantes)', () => {
    const empty = resolvePeriod(
      new URLSearchParams('period=personnalisee&from=2000-01-01&to=2000-01-07'),
    );
    const rate = initialConformityRate(empty.current, EMPTY);
    if (rate.rate !== null || rate.controlled !== 0) {
      throw new Error('Taux calculé sur une période sans contrôles.');
    }
  });

  tools.check('période sans données : valeurs nulles, aucun NaN', () => {
    const empty = resolvePeriod(
      new URLSearchParams('period=personnalisee&from=2000-01-01&to=2000-01-07'),
    );
    const payload = resolveSection('general').build({
      current: empty.current,
      previous: empty.previous,
      filters: EMPTY,
    });
    const flowKeys = new Set(FLOW_SOURCES.map((source) => source.key));
    for (const kpi of payload.kpis) {
      if (!Number.isFinite(kpi.value)) {
        throw new Error(`KPI ${kpi.key} = ${kpi.value} sur période vide.`);
      }
      if (flowKeys.has(kpi.key) && kpi.value !== 0) {
        throw new Error(`KPI périodique ${kpi.key} = ${kpi.value} sur période vide.`);
      }
    }
  });

  tools.check('filtres : erreurs de requêtes (400)', () => {
    for (const bad of ['lotId=abc', 'lotId=-2', 'severity=grave', 'status=INVALIDE', 'productId=1.5']) {
      let threw = false;
      try {
        parseReportFilters(new URLSearchParams(bad));
      } catch (error) {
        threw = true;
        if ((error as { status?: number }).status !== 400) throw error;
      }
      if (!threw) throw new Error(`Filtre invalide accepté : ${bad}`);
    }
  });

  tools.check('alertes : filtres gravité, statut et responsable', () => {
    const critical = transversalAlerts(noFilters('severity=critical&status=nouvelle'), current);
    if (!critical.some((alert) => alert.category === 'TEST_SEC')) {
      throw new Error('Alerte critique TEST_SEC absente.');
    }
    const resolved = transversalAlerts(noFilters('status=resolue'), current);
    if (resolved.some((alert) => alert.status !== 'resolue')) {
      throw new Error('Filtre statut non appliqué.');
    }
    const byOwner = transversalAlerts(noFilters(`userId=${ctx.userIds.securite}`), current);
    if (byOwner.length === 0 || byOwner.some((alert) => alert.ownerRole !== 'chef_securite')) {
      throw new Error('Filtre responsable non appliqué.');
    }
  });

  tools.check('cohérence interface ↔ export Excel (mêmes valeurs)', () => {
    const definition = resolveSection('coupe');
    const payload = definition.build({ current, previous, filters: EMPTY });
    const report = finalizeReport(definition, current, previous, payload);
    const cut = payload.kpis.find((item) => item.key === 'coupe_cut')!.value;
    const workbook = XLSX.read(buildWorkbook(report, 'lot=' + ctx.lotCode), { type: 'buffer' });
    if (!workbook.SheetNames.includes('Information')) {
      throw new Error('Feuille Information manquante.');
    }
    const sheet = workbook.Sheets['coupe_lots'];
    if (!sheet) throw new Error('Feuille coupe_lots manquante.');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const lotRow = rows.find((row) => row[0] === ctx.lotCode) as unknown[];
    if (!lotRow) throw new Error('Lot absent de l’export.');
    if (lotRow[4] !== cut) throw new Error(`Export coupé ${lotRow[4]} ≠ interface ${cut}`);
    if (lotRow[5] !== 28) throw new Error('Export utilisable incorrect.');
  });

  tools.check('export PDF généré depuis le même rapport', () => {
    const definition = resolveSection('coupe');
    const payload = definition.build({ current, previous, filters: EMPTY });
    const report = finalizeReport(definition, current, previous, payload);
    const pdf = buildPdf(report, 'test');
    if (!(pdf.length > 500) || pdf.subarray(0, 4).toString() !== '%PDF') {
      throw new Error('PDF invalide.');
    }
  });

  tools.check('performance : agrégats sur volumétrie < 2 s', () => {
    const insert = db.prepare(
      `INSERT INTO st_movements (movement_type, lot_id, size_id, qty, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, '2019-05-05 10:00:00')`,
    );
    db.transaction(() => {
      for (let index = 0; index < 4000; index += 1) {
        const type = index % 3 === 0 ? 'entree_cq' : index % 3 === 1 ? 'sortie' : 'retour';
        insert.run(type, ctx.lotId, ctx.sizeIds[index % 2], 1, ctx.userIds.stock);
      }
    })();
    const wide = resolvePeriod(
      new URLSearchParams('period=personnalisee&from=2019-01-01&to=2020-01-01'),
    );
    const started = Date.now();
    stockReport(wide.current, EMPTY);
    const elapsed = Date.now() - started;
    if (elapsed > 2000) throw new Error(`Agrégat trop lent : ${elapsed} ms`);
  });

  tools.check('intégrité SQLite : integrity_check ok', () => {
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result[0].integrity_check !== 'ok') throw new Error('Intégrité SQLite compromise.');
  });

  tools.check('audit 400 lignes : 0 infraction', () => {
    const run = spawnSync('node', ['scripts/check-line-limit.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    if (run.status !== 0) {
      throw new Error(`Audit 400 lignes en échec :\n${run.stdout ?? ''}${run.stderr ?? ''}`);
    }
  });
}
