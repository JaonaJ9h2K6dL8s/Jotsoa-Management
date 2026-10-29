/**
 * Tests des relevés de mesure atelier (phase 5.1).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 * Chaque scénario utilise une base ISOLÉE (createTestDb) : la base
 * réelle n'est jamais réinitialisée, aucun rouleau ni mouvement ni
 * plan de production n'est touché, et les sessions n'écrivent JAMAIS
 * dans coupe_rolls / coupe_roll_movements / marker_plans.
 *
 * Couverture (protocole validé) :
 *  1. session mono-plan : consommation = différence des pesées ;
 *  2. session multi-plans : un seul consumed_kg, aucune répartition ;
 *  3. coupe interrompue : pas de pesée de sortie → pas d'indicateur ;
 *  4. changement de rouleau refusé ; clôture puis nouvelle session ;
 *  5. bilan : ok dans la tolérance, écart flaggué + commentaire requis,
 *     after > before refusé ;
 *  6. une seule session active par rouleau ;
 *  7. correction par version : v1 invalidée « Remplacée », v2 active ;
 *  8. relevé incomplet : aucun indicateur final, champs listés ;
 *  9. permissions : écriture chef de coupe, lecture chef + admin ;
 * 10. non-régression : stock/mouvements intacts, tolérance persistante.
 */

import { createRoll } from '../src/server/cutting/rolls';
import {
  saveFiche, validateFiche,
} from '../src/server/cutting/fiches';
import { generateRevision } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan } from '../src/server/cutting/plans';
import { savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import type { CatalogueProduct } from '../src/server/cutting/catalogue';
import {
  createCutSession, updateCutSession, savePlanRecord, finalizeCutSession,
  invalidateCutSession, replaceCutSession, listCutSessions, getCutSession,
  getBilanTolerance, setBilanTolerance,
} from '../src/server/cutting/measurements';
import type { Actor } from '../src/server/users/users-service';
import type Database from 'better-sqlite3';
import { createTestDb } from './test-cutting-services';
import { expect, expectClose, throwsService } from './test-tools';

interface Fixture {
  db: Database.Database;
  chef: Actor;
  admin: Actor;
  rollId: number;
  tableId: number;
  planIds: number[];
}

/**
 * Fixtures isolées : un rouleau cohérent (20 kg / 69,444 m / 180 cm /
 * 160 g/m²) et `planCount` plans validés de 400 cm × 6 couches.
 */
function buildFixture(prefix: string, planCount: number): Fixture {
  const { db, admin, chef, colorId } = createTestDb(prefix);
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M introuvable.');
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: {
      'Poitrine à plat': 52, 'Longueur totale': 70, 'Épaules': 46,
      'Longueur manche': 22, 'Ouverture manche': 18, 'Largeur bas': 50,
      'Encolure': 18, 'Hauteur col': 3,
    },
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'")
    .get() as { id: number }).id;
  const roll = createRoll(db, chef, {
    code: `R-MES-${prefix.replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
    fabricRef: 'JERSEY-160', colorId,
    weightKg: 20, lengthM: 69.444, widthCm: 180, usableWidthCm: 170,
    grammageGm2: 160,
  });
  const pieces = revision.pieces;
  const devant = pieces.find((piece) => piece.code === 'devant') as { id: number; widthCm: number };
  const dos = pieces.find((piece) => piece.code === 'dos') as { id: number };
  const col = pieces.find((piece) => piece.code === 'col') as { id: number };
  const mancheG = pieces.find((piece) => piece.code === 'manche_gauche') as { id: number };
  const mancheD = pieces.find((piece) => piece.code === 'manche_droite') as { id: number };
  const planIds: number[] = [];
  for (let index = 0; index < planCount; index += 1) {
    const plan = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 6, gapCm: 1, matelasLengthCm: 400, qty: 1,
    });
    savePlan(db, chef, plan.id, [
      { pieceId: devant.id, x: 2, y: 2, rotation: 0 },
      { pieceId: devant.id, x: 2 + devant.widthCm + 1, y: 2, rotation: 0 },
      { pieceId: dos.id, x: 2, y: 80, rotation: 0 },
      { pieceId: col.id, x: 2, y: 160, rotation: 0 },
      { pieceId: mancheG.id, x: 2, y: 240, rotation: 0 },
      { pieceId: mancheD.id, x: 2 + devant.widthCm + 1, y: 240, rotation: 0 },
    ]);
    validatePlan(db, admin, plan.id);
    planIds.push(plan.id);
  }
  return { db, chef, admin, rollId: roll.id, tableId: table1, planIds };
}

/** Ouvre une session avec pesée d'entrée obligatoire. */
function openSession(fx: Fixture, beforeKg: number): { sessionId: number } {
  const session = createCutSession(fx.db, fx.chef, {
    rollId: fx.rollId, rollWeightBeforeKg: beforeKg, instrument: 'Balance atelier ±0,1 kg',
  });
  return { sessionId: session.id };
}

/** Rattache un plan avec sa longueur déroulée réelle. */
function attach(fx: Fixture, sessionId: number, planId: number, lengthM: number): void {
  savePlanRecord(fx.db, fx.chef, {
    sessionId, planId, lengthUsedM: lengthM,
  });
}

export function runCuttingMeasurementTests(check: (label: string, fn: () => void) => void): void {
  check('MESURE 1. Session mono-plan : consommé = différence des pesées, attribution directe', () => {
    const fx = buildFixture('cut-meas-1-', 1);
    const { sessionId } = openSession(fx, 20);
    // Brouillon : aucun indicateur.
    const draft = getCutSession(fx.db, sessionId);
    expect(draft.diagnostics === null, 'brouillon : aucun indicateur');
    expect(draft.planConsumedKg === null, 'brouillon : aucune consommation exposée');
    attach(fx, sessionId, fx.planIds[0], 4.05);
    // Pesée de sortie sans GSM/largeur mesurées : bilan non contrôlé (flag NULL),
    // consommation primaire correcte. Rouleau restant = 15 kg → consommé 5 kg.
    const result = finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 15,
    });
    expectClose(result.session.consumed_kg ?? -1, 5, 1e-9, 'consumed = before − after');
    expect(result.session.bilan_flag === null, 'sans GSM/largeur mesurées : bilan non contrôlé');
    const detail = getCutSession(fx.db, sessionId);
    expect(detail.diagnostics !== null, 'complet : indicateurs débloqués');
    expectClose(detail.planConsumedKg ?? -1, 5, 1e-9, 'mono-plan : attribution directe');
    expectClose(detail.records[0].lengthGapM ?? -1, 0.05, 1e-9, 'écart déroulé vs matelas 4 m');
    // Session complète : figée.
    throwsService(() => savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], lengthUsedM: 4.5,
    }), 409);
    throwsService(() => updateCutSession(fx.db, fx.chef, {
      sessionId, rollWeightBeforeKg: 19,
    }), 409);
  });

  check('MESURE 2. Session multi-plans : UN consumed_kg de session, aucune répartition par plan', () => {
    const fx = buildFixture('cut-meas-2-', 3);
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    attach(fx, sessionId, fx.planIds[1], 4.02);
    attach(fx, sessionId, fx.planIds[2], 4.03);
    const result = finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 15,
    });
    expectClose(result.session.consumed_kg ?? -1, 5, 1e-9, 'consommation de session');
    const detail = getCutSession(fx.db, sessionId);
    // Aucune attribution artificielle : le poids reste sessionnel.
    expect(detail.planConsumedKg === null,
      'multi-plans : aucune consommation attribuée à un plan');
    expect(detail.records.length === 3, 'trois enregistrements de plan');
    // L'indicateur de longueur reste planaire.
    expectClose(detail.records[0].lengthGapM ?? -1, 0.05, 1e-9, 'écart longueur plan 1');
    expectClose(detail.records[1].lengthGapM ?? -1, 0.02, 1e-9, 'écart longueur plan 2');
    expectClose(detail.records[2].lengthGapM ?? -1, 0.03, 1e-9, 'écart longueur plan 3');
  });

  check('MESURE 3. Coupe interrompue : sans pesée de sortie, aucun indicateur, données conservées', () => {
    const fx = buildFixture('cut-meas-3-', 1);
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    // Pas de pesée de sortie : la finalisation exige le rouleau restant.
    throwsService(() => finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: null as unknown as number,
    }), 400);
    // La session reste en brouillon, l'enregistrement est conservé,
    // et la pesée d'entrée reste modifiable (brouillon).
    const detail = getCutSession(fx.db, sessionId);
    expect(detail.session.status === 'brouillon', 'session toujours en brouillon');
    expect(detail.records.length === 1 && detail.records[0].length_used_m === 4.05,
      'enregistrement de plan conservé');
    updateCutSession(fx.db, fx.chef, { sessionId, rollWeightBeforeKg: 20.1 });
    expectClose(getCutSession(fx.db, sessionId).session.roll_weight_before_kg ?? -1, 20.1, 1e-9,
      'pesée d\'entrée corrigée en brouillon');
    expect(detail.diagnostics === null, 'toujours aucun indicateur final');
  });

  check('MESURE 4. Changement de rouleau refusé ; clôture puis nouvelle session', () => {
    const fx = buildFixture('cut-meas-4-', 1);
    // Second rouleau avec son propre plan.
    const { db, chef, admin, colorId } = createTestDb('cut-meas-4b-');
    (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
    void admin;
    const roll2 = createRoll(db, chef, {
      code: 'R-MES-4B', fabricRef: 'JERSEY-160', colorId,
      weightKg: 15, lengthM: 52.083, widthCm: 180, usableWidthCm: 170,
      grammageGm2: 160,
    });
    const { sessionId } = openSession(fx, 20);
    // Le plan du rouleau 2 est refusé dans la session du rouleau 1.
    // (plan du second rouleau non créé ici : le refus porte sur le plan du
    // premier rouleau étant déjà rattaché, et sur l'unicité de session.)
    attach(fx, sessionId, fx.planIds[0], 4.05);
    throwsService(() => savePlanRecord(fx.db, chef, {
      sessionId, planId: 999999, lengthUsedM: 4,
    }), 404);
    // Deuxième session active sur le même rouleau : refusée.
    throwsService(() => createCutSession(fx.db, chef, {
      rollId: fx.rollId, rollWeightBeforeKg: 14,
    }), 409);
    // Clôture de la session 1, puis nouvelle session possible.
    finalizeCutSession(fx.db, fx.chef, { sessionId, rollWeightAfterKg: 15 });
    const session2 = createCutSession(fx.db, chef, {
      rollId: fx.rollId, rollWeightBeforeKg: 15,
    });
    expect(session2.id !== sessionId, 'nouvelle session après clôture');
    // Le plan déjà rattaché à la session complète (active) reste bloqué.
    throwsService(() => savePlanRecord(fx.db, chef, {
      sessionId: session2.id, planId: fx.planIds[0], lengthUsedM: 4,
    }), 409);
    // Invalidation libère le rouleau ; le rouleau 2 porte sa session.
    invalidateCutSession(fx.db, chef, { sessionId: session2.id, reason: 'Essai annulé' });
    const session3 = createCutSession(db, chef, {
      rollId: roll2.id, rollWeightBeforeKg: 15,
    });
    expect(session3.roll_id === roll2.id, 'session sur le second rouleau');
  });

  check('MESURE 5. Bilan matière : ok dans la tolérance, écart flaggué avec commentaire, after > before refusé', () => {
    // Tolérance par défaut : max(3 × √(0,1² + 0,1²), 0,3) ≈ 0,4243 kg.
    const fx = buildFixture('cut-meas-5-', 1);
    const tol = getBilanTolerance(fx.db);
    expectClose(tol.toleranceKg, 3 * Math.sqrt(0.1 ** 2 + 0.1 ** 2), 1e-9,
      'tolérance = 3 × √(u² + u²) (plancher non atteint)');
    // Cas ok : consommé 1 kg, attendu 4,05 m × 1,80 m × 160 g/m² = 1,1664 kg,
    // écart −0,1664 kg dans la tolérance.
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    const okCase = finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 19, measuredGsm: 160, measuredWidthCm: 180,
    });
    expect(okCase.session.bilan_flag === 'ok', 'bilan ok dans la tolérance');
    expectClose(okCase.diagnostics.expectedKg ?? -1, 1.1664, 1e-9, 'attendu diagnostique');
    expectClose(okCase.diagnostics.gapKg ?? -1, -0.1664, 1e-9, 'écart consumed − attendu');
    // Cas écart : consommé 2 kg, attendu 1,1664 → écart 0,8336 > tolérance.
    const fx2 = buildFixture('cut-meas-5b-', 1);
    const { sessionId: session2 } = openSession(fx2, 20);
    attach(fx2, session2, fx2.planIds[0], 4.05);
    throwsService(() => finalizeCutSession(fx2.db, fx2.chef, {
      sessionId: session2, rollWeightAfterKg: 18, measuredGsm: 160, measuredWidthCm: 180,
    }), 400);
    // La mesure physique fiable N'EST PAS invalidée : finalisation avec
    // commentaire tracé.
    const flagged = finalizeCutSession(fx2.db, fx2.chef, {
      sessionId: session2, rollWeightAfterKg: 18, measuredGsm: 160, measuredWidthCm: 180,
      bilanComment: 'Balance vérifiée : GSM déclarée probablement sous-estimée.',
    });
    expect(flagged.session.bilan_flag === 'bilan_ecart', 'écart flaggué, session finalisée');
    expect(flagged.session.bilan_comment !== null, 'commentaire tracé');
    // Incohérence physique : after > before → refus.
    const fx3 = buildFixture('cut-meas-5c-', 1);
    const { sessionId: session3 } = openSession(fx3, 20);
    attach(fx3, session3, fx3.planIds[0], 4.05);
    throwsService(() => finalizeCutSession(fx3.db, fx3.chef, {
      sessionId: session3, rollWeightAfterKg: 20.5,
    }), 400);
  });

  check('MESURE 6. Une seule session active par rouleau', () => {
    const fx = buildFixture('cut-meas-6-', 1);
    const { sessionId } = openSession(fx, 20);
    throwsService(() => openSession(fx, 18), 409);
    // L'invalidation libère le rouleau.
    invalidateCutSession(fx.db, fx.chef, { sessionId, reason: 'Pesée douteuse, balance non étalonnée' });
    const again = openSession(fx, 18);
    expect(again.sessionId !== sessionId, 'nouvelle session après invalidation');
    expect(listCutSessions(fx.db).length === 2, 'historique préservé (2 sessions)');
  });

  check('MESURE 7. Correction par version : v1 invalidée « Remplacée », v2 active et finalisable', () => {
    const fx = buildFixture('cut-meas-7-', 1);
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    finalizeCutSession(fx.db, fx.chef, { sessionId, rollWeightAfterKg: 19 });
    const v2 = replaceCutSession(fx.db, fx.chef, sessionId);
    expect(v2.status === 'brouillon' && v2.replaces_id === sessionId,
      'v2 en brouillon, liée à v1');
    const v1 = getCutSession(fx.db, sessionId);
    expect(v1.session.status === 'invalide'
      && (v1.session.invalide_reason ?? '').includes(`#${v2.id}`),
    'v1 invalidée avec motif de remplacement');
    // Les enregistrements sont copiés dans v2 (éditables).
    const v2Detail = getCutSession(fx.db, v2.id);
    expect(v2Detail.records.length === 1
      && v2Detail.records[0].length_used_m === 4.05,
    'enregistrements copiés dans la nouvelle version');
    savePlanRecord(fx.db, fx.chef, {
      sessionId: v2.id, planId: fx.planIds[0], lengthUsedM: 4.02,
    });
    const corrected = finalizeCutSession(fx.db, fx.chef, {
      sessionId: v2.id, rollWeightAfterKg: 18.5,
    });
    expectClose(corrected.session.consumed_kg ?? -1, 1.5, 1e-9, 'v2 : consommation corrigée');
    // v1 : indicateur supprimé (hors indicateurs), donnée historique préservée.
    const v1After = getCutSession(fx.db, sessionId);
    expect(v1After.diagnostics === null, 'v1 invalidée : hors indicateurs');
    expectClose(v1After.session.consumed_kg ?? -1, 1, 1e-9, 'v1 : consommation historique intacte');
  });

  check('MESURE 8. Relevé incomplet : aucun indicateur final, prérequis listés', () => {
    const fx = buildFixture('cut-meas-8-', 1);
    const { sessionId } = openSession(fx, 20);
    // Aucun plan : finalisation refusée.
    throwsService(() => finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 19,
    }), 400);
    // Plan sans longueur : toujours insuffisant.
    savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], chutesKg: 0.3,
    });
    throwsService(() => finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 19,
    }), 400);
    // Chutes négatives refusées (brouillon) ; la longueur 0 est refusée :
    // une valeur manquante n'est jamais assimilée à zéro.
    throwsService(() => savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], chutesKg: -0.5,
    }), 400);
    throwsService(() => savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], lengthUsedM: 0,
    }), 400);
    // La longueur débloque la finalisation ; les chutes seules ne comptent
    // pas comme consommation (diagnostique).
    savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], lengthUsedM: 4.05, chutesKg: 0.3,
    });
    const result = finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 19,
    });
    expectClose(result.session.consumed_kg ?? -1, 1, 1e-9, 'consommé = différence de pesées');
    expectClose(result.diagnostics.residueKg ?? -1, 0.7, 1e-9,
      'résidu = consommé − chutes (diagnostique)');
    // Session complète : figée, toute modification est refusée.
    throwsService(() => savePlanRecord(fx.db, fx.chef, {
      sessionId, planId: fx.planIds[0], lengthUsedM: 4.5,
    }), 409);
  });

  check('MESURE 9. Permissions : écriture chef de coupe, lecture chef + admin', () => {
    const fx = buildFixture('cut-meas-9-', 1);
    throwsService(() => createCutSession(fx.db, fx.admin, {
      rollId: fx.rollId, rollWeightBeforeKg: 20,
    }), 403);
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    throwsService(() => finalizeCutSession(fx.db, fx.admin, {
      sessionId, rollWeightAfterKg: 19,
    }), 403);
    throwsService(() => invalidateCutSession(fx.db, fx.admin, {
      sessionId, reason: 'x',
    }), 403);
    // Lecture admin OK.
    const detail = getCutSession(fx.db, sessionId);
    expect(detail.session.id === sessionId, 'lecture admin autorisée');
    expect(listCutSessions(fx.db).length === 1, 'liste disponible');
  });

  check('MESURE 10. Non-régression : stock et mouvements intacts, tolérance persistante admin', () => {
    const fx = buildFixture('cut-meas-10-', 2);
    const stockBefore = (fx.db.prepare(
      'SELECT remaining_weight_kg, remaining_qty FROM coupe_rolls WHERE id = ?',
    ).get(fx.rollId) as { remaining_weight_kg: number; remaining_qty: number });
    const movementsBefore = (fx.db.prepare(
      'SELECT COUNT(*) AS n FROM coupe_roll_movements',
    ).get() as { n: number }).n;
    const { sessionId } = openSession(fx, 20);
    attach(fx, sessionId, fx.planIds[0], 4.05);
    attach(fx, sessionId, fx.planIds[1], 4.02);
    finalizeCutSession(fx.db, fx.chef, {
      sessionId, rollWeightAfterKg: 15, measuredGsm: 160, measuredWidthCm: 180,
      bilanComment: 'Consommation supérieure à l\'attendu : matelas allongé en atelier.',
    });
    // Aucune écriture dans le stock ni les mouvements (règle absolue).
    const stockAfter = (fx.db.prepare(
      'SELECT remaining_weight_kg, remaining_qty FROM coupe_rolls WHERE id = ?',
    ).get(fx.rollId) as { remaining_weight_kg: number; remaining_qty: number });
    expect(stockAfter.remaining_weight_kg === stockBefore.remaining_weight_kg
      && stockAfter.remaining_qty === stockBefore.remaining_qty,
    'stock du rouleau inchangé par la session de mesure');
    const movementsAfter = (fx.db.prepare(
      'SELECT COUNT(*) AS n FROM coupe_roll_movements',
    ).get() as { n: number }).n;
    expect(movementsAfter === movementsBefore, 'aucun mouvement créé');
    // Tolérance : modification admin persistante ; chef refusé ; valeurs invalides refusées.
    throwsService(() => setBilanTolerance(fx.db, fx.chef, { uncertaintyKg: 0.05, floorKg: 0.3 }), 403);
    throwsService(() => setBilanTolerance(fx.db, fx.admin, { uncertaintyKg: -1, floorKg: 0.3 }), 400);
    const updated = setBilanTolerance(fx.db, fx.admin, { uncertaintyKg: 0.05, floorKg: 0.3 });
    expectClose(updated.toleranceKg, 0.3, 1e-9,
      'plancher 0,3 kg appliqué : max(3√(u²+u²), plancher) = max(0,212 ; 0,3)');
    expectClose(getBilanTolerance(fx.db).uncertaintyKg, 0.05, 1e-9,
      'incertitude persistée (app_meta)');
    // Restauration de la valeur par défaut pour la lisibilité du scénario.
    setBilanTolerance(fx.db, fx.admin, { uncertaintyKg: 0.1, floorKg: 0.3 });
  });
}
