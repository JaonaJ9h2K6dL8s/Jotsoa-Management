/**
 * Tests de l'étape 10 : avertissements de cohérence des métriques et
 * recalcul explicite (plan.remetrics).
 * Exécution : agrégé par scripts/test-cutting.ts (npm run test:cutting).
 */

import type Database from 'better-sqlite3';
import { ServiceError } from '../src/server/api/service-error';
import type { Actor } from '../src/server/users/users-service';
import { createRoll } from '../src/server/cutting/rolls';
import { listCatalogueProducts, type CatalogueProduct } from '../src/server/cutting/catalogue';
import { saveFiche, validateFiche } from '../src/server/cutting/fiches';
import { generateRevision, type RevisionItem, type RevisionPiece } from '../src/server/cutting/patterns';
import { validateRevision } from '../src/server/cutting/pattern-validate';
import { createPlan, getPlan } from '../src/server/cutting/plans';
import { remetricsPlan, savePlan, validatePlan } from '../src/server/cutting/plans-save';
import { checkMarkerCoherence, maxPersistedLengthCm, MARKER_TOLERANCE_CM } from '../src/lib/cutting/metrics';
import type { Point } from '../src/lib/cutting/types';
import { createTestDb } from './test-cutting-services';

const MESURES = {
  'Poitrine à plat': 52,
  'Longueur totale': 70,
  Épaules: 46,
  'Longueur manche': 22,
  'Ouverture manche': 18,
  'Largeur bas': 50,
  Encolure: 18,
  'Hauteur col': 3,
};

function expectServiceError(fn: () => void, status: number, contains?: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    if (error.status !== status) {
      throw new Error(`Statut attendu ${status}, reçu ${error.status} : ${error.message}`);
    }
    if (contains && !error.message.includes(contains)) {
      throw new Error(`Message attendu « ${contains} », reçu : ${error.message}`);
    }
    return;
  }
  throw new Error('Erreur attendue non levée.');
}

function at(pieceId: number, y: number): { pieceId: number; x: number; y: number; rotation: 0 } {
  return { pieceId, x: 2, y, rotation: 0 };
}

function piece(revision: RevisionItem, code: string): RevisionPiece {
  return revision.pieces.find((candidate) => candidate.code === code) as RevisionPiece;
}

/** Simule l'ancienne convention : longueur enregistrée = matelas déclaré. */
function simulateOldConvention(db: Database.Database, planId: number): void {
  db.prepare(
    'UPDATE marker_plans SET marker_length_cm = matelas_length_cm WHERE id = ?',
  ).run(planId);
}

export function runCuttingRemetricsTests(check: (label: string, fn: () => void) => void): void {
  const { db, admin, chef, couture, colorId } = createTestDb('cut-remetrics-');
  (globalThis as { __joManagementDb?: unknown }).__joManagementDb = db;
  const tshirt = listCatalogueProducts(db).find(
    (item): item is CatalogueProduct => item.family === 'tshirt' && item.category === 'adulte',
  );
  if (!tshirt) throw new Error('Catalogue : T-shirt adulte introuvable.');
  const sizeM = tshirt.sizes.find((size) => size.nom === 'M');
  if (!sizeM) throw new Error('Catalogue : taille M requise.');
  const roll = createRoll(db, chef, {
    code: 'R-REMET', fabricRef: 'JERSEY-200', colorId,
    // Cohérent : implicite = 20000/(50×1,8) ≈ 222,2 g/m².
    weightKg: 20, lengthM: 50, widthCm: 180, usableWidthCm: 170, grammageGm2: 222.2,
  });
  const fiche = validateFiche(db, admin, saveFiche(db, chef, {
    productId: tshirt.productId, sizeId: sizeM.id, mesures: MESURES,
  }).id);
  const revision = validateRevision(db, admin, generateRevision(db, chef, fiche.id).id);
  const devant = piece(revision, 'devant');
  const dos = piece(revision, 'dos');
  const col = piece(revision, 'col');
  const mancheG = piece(revision, 'manche_gauche');
  const mancheD = piece(revision, 'manche_droite');
  const table1 = (db.prepare("SELECT id FROM coupe_tables WHERE nom = 'Table 1'").get() as { id: number }).id;
  const placements = [
    at(devant.id, 2), at(dos.id, 90), at(col.id, 178),
    at(mancheG.id, 430), at(mancheD.id, 470),
  ];
  const planA = createPlan(db, chef, {
    revisionId: revision.id, rollId: roll.id, tableId: table1,
    layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1,
  });
  const saved = savePlan(db, chef, planA.id, placements);
  const realLength = maxPersistedLengthCm(saved.placements);

  check('Remetrics : helpers purs (maxPersistedLengthCm, cohérence, tolérance)', () => {
    const contour: Point[] = [{ x: 0, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 42 }, { x: 0, y: 42 }];
    if (maxPersistedLengthCm([{ points: [{ x: 0, y: 3 }] }, { points: contour }]) !== 42) {
      throw new Error('maxPersistedLengthCm : mauvais maximum.');
    }
    if (maxPersistedLengthCm([]) !== 0) throw new Error('Placement vide : longueur attendue 0.');
    if (checkMarkerCoherence(72, 72.5).stale) throw new Error('Écart 0,5 cm : avertissement injustifié.');
    const boundary = checkMarkerCoherence(72, 72 + MARKER_TOLERANCE_CM);
    if (boundary.stale || boundary.deltaCm !== MARKER_TOLERANCE_CM) {
      throw new Error('Égalité à la tolérance : pas de dépassement attendu.');
    }
    if (!checkMarkerCoherence(72, 72 + MARKER_TOLERANCE_CM + 0.01).stale) {
      throw new Error('Dépassement de tolérance non détecté.');
    }
    if (!checkMarkerCoherence(500, 72, 50).stale) throw new Error('Tolérance personnalisée ignorée.');
  });

  check('Remetrics : plan cohérent → aucun avertissement', () => {
    const coherence = checkMarkerCoherence(saved.marker_length_cm, realLength);
    if (coherence.stale) {
      throw new Error(`Avertissement injustifié : écart ${coherence.deltaCm} cm.`);
    }
  });

  check('Remetrics : ancienne convention simulée → avertissement justifié', () => {
    simulateOldConvention(db, planA.id);
    const reloaded = getPlan(db, planA.id);
    const coherence = checkMarkerCoherence(reloaded.marker_length_cm, realLength);
    if (!coherence.stale) throw new Error('Divergence 500 cm vs 72 cm non détectée.');
    if (Math.abs(reloaded.marker_length_cm - 500) > 0.01) {
      throw new Error(`Matelas déclaré attendu (500), reçu ${reloaded.marker_length_cm}.`);
    }
  });

  check('Remetrics : annulation → anciennes données conservées', () => {
    const before = getPlan(db, planA.id).marker_length_cm;
    // Annulation = aucune action : la valeur enregistrée ne change pas.
    const after = getPlan(db, planA.id).marker_length_cm;
    if (before !== after) throw new Error('Valeur modifiée sans action.');
  });

  let remetrics: ReturnType<typeof remetricsPlan> | null = null;
  check('Remetrics : recalcul explicite d’un plan brouillon (avant → après)', () => {
    remetrics = remetricsPlan(db, chef, planA.id);
    if (Math.abs(remetrics.before.markerLengthCm - 500) > 0.01) {
      throw new Error(`Ancienne valeur attendue 500, reçu ${remetrics.before.markerLengthCm}.`);
    }
    if (Math.abs(remetrics.after.markerLengthCm - realLength) > 0.01) {
      throw new Error(`Recalcul attendu ${realLength}, reçu ${remetrics.after.markerLengthCm}.`);
    }
    const reloaded = getPlan(db, planA.id);
    if (Math.abs(reloaded.marker_length_cm - realLength) > 0.01) {
      throw new Error('Longueur non réenregistrée.');
    }
    if (checkMarkerCoherence(reloaded.marker_length_cm,
      maxPersistedLengthCm(reloaded.placements)).stale) {
      throw new Error('Avertissement encore affiché après recalcul.');
    }
  });

  check('Remetrics : plan validé (a fortiori transféré) → refus 409', () => {
    validatePlan(db, admin, planA.id);
    expectServiceError(() => remetricsPlan(db, chef, planA.id), 409, 'immuable');
    // Les métriques historiques restent intactes.
    if (Math.abs(getPlan(db, planA.id).marker_length_cm - realLength) > 0.01) {
      throw new Error('Métriques modifiées malgré le refus.');
    }
  });

  check('Remetrics : placement enregistré invalide → refus 409, données intactes', () => {
    const planB = createPlan(db, chef, {
      revisionId: revision.id, rollId: roll.id, tableId: table1,
      layers: 1, gapCm: 1, matelasLengthCm: 500, qty: 1,
    });
    const savedB = savePlan(db, chef, planB.id, placements);
    // Chevauchement injecté au niveau DB (simulation d'un état invalide).
    const overlapping = JSON.stringify([savedB.placements[0], savedB.placements[0]]);
    db.prepare('UPDATE marker_plans SET pieces_json = ? WHERE id = ?').run(overlapping, planB.id);
    expectServiceError(() => remetricsPlan(db, chef, planB.id), 409, 'recalcul refusé');
    const untouched = getPlan(db, planB.id);
    if (untouched.marker_length_cm !== savedB.marker_length_cm
      || untouched.pieces_json !== overlapping) {
      throw new Error('Données modifiées malgré le refus du recalcul.');
    }
  });

  check('Remetrics : rôle sans droit d’écriture → refus 403', () => {
    expectServiceError(() => remetricsPlan(db, couture, planA.id), 403);
  });
}
