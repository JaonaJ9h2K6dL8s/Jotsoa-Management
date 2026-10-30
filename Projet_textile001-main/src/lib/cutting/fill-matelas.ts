import type {
  OptimizerInput,
  OptimizerPiece,
  OptimizerPlacement,
  OptimizerResult,
  OptimizerUnplaced,
  Orientation,
} from './optimizer';
import { computeMetrics, permittedOrientations } from './optimizer';
import { optimizePlacementBest } from './best-placement';
import { findBestSpot, type SpotSearchState } from './nesting';
import { PieceIndex, type StampedPiece } from './nesting-index';
import { polygonArea } from './geometry';

/**
 * Remplissage COMPLET d'un matelas par jeux successifs du patron.
 *
 * Repère serveur (cf. optimizer.ts) : X = largeur du tissu,
 * Y = longueur du matelas. Le nesting BLF empile les pièces depuis
 * y = 0 (sol) vers la longueur croissante.
 *
 * Pourquoi jeu par jeu : une estimation unique du nombre de jeux
 * (par longueur du 1er jeu ou par aire) est soit sous-estimée, soit
 * provoque une passe géante qui expire avant d'avoir placé les
 * petites pièces (col, ceinture placées en dernier) — et le résultat
 * partiel ne contient alors AUCUN jeu complet.
 *
 * Stratégie : on place UN jeu complet à la fois (pièces triées par
 * aire décroissante). Chaque jeu engagé est soit COMPLET et validé
 * (inscrit dans l'index), soit ANNULÉ (rollback de l'index) — jamais
 * de jeu incomplet, une pièce orpheline ne produit pas de vêtement.
 * La boucle s'arrête quand plus aucun jeu ne tient (matelas plein)
 * ou quand le budget de calcul est atteint : les jeux déjà posés
 * restent acquis.
 */

/** Plafond de jeux placés (protection ; le budget horloge reste le vrai garde-fou). */
const SETS_CAP = 30;
/** Budget horloge total par défaut du remplissage (ms). */
const DEFAULT_FILL_BUDGET_MS = 12_000;
/** Marge horloge minimale pour tenter un jeu supplémentaire (ms). */
const MIN_SET_BUDGET_MS = 300;

/** Journal d'un jeu posé (transparence du remplissage). */
export interface FillAttempt {
  /** Numéro du jeu (1-based). */
  sets: number;
  /** Pièces cumulées placées après ce jeu. */
  placed: number;
  /** Longueur consommée après ce jeu (cm, axe Y). */
  lengthCm: number;
}

export interface FillMatelasResult {
  /** Placement du matelas PLEIN en jeux complets (à valider par le caller). */
  result: OptimizerResult;
  /** Pièces scalées correspondantes (qty × capacitySets) pour validateCandidate. */
  scaledPieces: OptimizerPiece[];
  /** Jeux complets posés sur le matelas. */
  capacitySets: number;
  /** Journal par jeu. */
  attempts: FillAttempt[];
}

/** Item d'un jeu : une pièce du patron avec ses orientations permises. */
interface SetItem {
  piece: OptimizerPiece;
  qty: number;
  orientations: Orientation[];
  areaCm2: number;
}

function prepareSetItems(input: OptimizerInput): { items: SetItem[]; unplaced: OptimizerUnplaced[] } {
  const items: SetItem[] = [];
  const unplaced: OptimizerUnplaced[] = [];
  for (const piece of input.pieces) {
    const qty = Number.isFinite(piece.qty) ? Math.max(0, Math.floor(piece.qty)) : 0;
    if (piece.status === 'incomplete' || piece.points.length < 3) {
      if (qty > 0) {
        unplaced.push({
          code: piece.code,
          label: piece.label,
          quantity: qty,
          reason: `Pièce ${piece.label} non configurée : exclue de la coupe réelle.`,
        });
      }
      continue;
    }
    const areaCm2 = polygonArea(piece.points);
    const invalid = piece.points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    );
    if (invalid || !(areaCm2 > 0)) {
      if (qty > 0) {
        unplaced.push({
          code: piece.code,
          label: piece.label,
          quantity: qty,
          reason: `Contour de ${piece.label} invalide ou dégénéré `
            + '(aire nulle, coordonnées non numériques) : coupe refusée.',
        });
      }
      continue;
    }
    const { orientations, reason } = permittedOrientations(
      piece, input.usableWidthCm, input.gapCm, input.oneWayFabric ?? false,
    );
    if (orientations.length === 0) {
      unplaced.push({
        code: piece.code,
        label: piece.label,
        quantity: qty,
        reason: reason ?? 'Placement impossible.',
      });
      continue;
    }
    items.push({ piece, qty, orientations, areaCm2 });
  }
  // Grandes pièces d'abord : le BLF loge les petites dans les creux restants.
  items.sort((a, b) => b.areaCm2 - a.areaCm2);
  return { items, unplaced };
}

export function fillMatelas(
  input: OptimizerInput,
  options: { timeBudgetMs?: number } = {},
): FillMatelasResult {
  const started = Date.now();
  const deadline = started + Math.max(1000, options.timeBudgetMs ?? DEFAULT_FILL_BUDGET_MS);
  const { usableWidthCm, maxLengthCm, gapCm } = input;
  const { items, unplaced: excluded } = prepareSetItems(input);

  const state: SpotSearchState = {
    candidatesTested: 0,
    exactTests: 0,
    maxExactTests: 2_000_000,
    expired: false,
    truncated: false,
  };
  const index = new PieceIndex();
  const placements: OptimizerPlacement[] = [];
  const attempts: FillAttempt[] = [];
  let fillMaxX = 0;
  let capacitySets = 0;
  let stopReason: 'plein' | 'budget' | null = null;

  for (let setIndex = 0; setIndex < SETS_CAP; setIndex += 1) {
    if (Date.now() > deadline - MIN_SET_BUDGET_MS) {
      stopReason = 'budget';
      break;
    }
    const setStart = placements.length;
    const setStamped: StampedPiece[] = [];
    let complete = true;
    for (const item of items) {
      for (let copy = 0; copy < item.qty; copy += 1) {
        const spot = findBestSpot(
          { orientations: item.orientations },
          index,
          fillMaxX,
          usableWidthCm,
          maxLengthCm,
          gapCm,
          state,
          deadline,
        );
        if (spot === null) {
          complete = false;
          break;
        }
        const points = spot.orientation.points.map((point) => ({
          x: point.x + spot.x,
          y: point.y + spot.y,
        }));
        placements.push({
          pieceId: item.piece.id,
          code: item.piece.code,
          label: item.piece.label,
          x: spot.x,
          y: spot.y,
          rotation: spot.orientation.rotation,
          points,
        });
        const stamped: StampedPiece = {
          contour: points,
          box: {
            minX: spot.x,
            minY: spot.y,
            maxX: spot.x + spot.orientation.w,
            maxY: spot.y + spot.orientation.h,
          },
          queryStamp: 0,
        };
        index.insert(stamped, gapCm);
        setStamped.push(stamped);
        fillMaxX = Math.max(fillMaxX, spot.x + spot.orientation.w);
      }
      if (!complete) break;
    }
    if (!complete) {
      // Jeu incomplet → annulé intégralement (rollback de l'index).
      // Aucune pièce orpheline n'est retenue.
      for (const stamped of setStamped) index.remove(stamped, gapCm);
      placements.length = setStart;
      stopReason = state.expired ? 'budget' : 'plein';
      break;
    }
    capacitySets = setIndex + 1;
    attempts.push({
      sets: capacitySets,
      placed: placements.length,
      lengthCm: Math.round(
        placements.reduce(
          (max, placement) => Math.max(max, ...placement.points.map((point) => point.y)),
          0,
        ) * 10,
      ) / 10,
    });
  }

  if (capacitySets < 1) {
    // Filet de sécurité : un seul jeu via la méthode combinée historique
    // (qui restitue proprement les pièces non placées).
    return {
      result: optimizePlacementBest(input),
      scaledPieces: input.pieces,
      capacitySets: 0,
      attempts,
    };
  }

  const scaledPieces = input.pieces.map((piece) => ({
    ...piece,
    qty: piece.qty * capacitySets,
  }));
  const result: OptimizerResult = {
    placements,
    unplaced: excluded,
    metrics: computeMetrics(
      placements.map((placement) => placement.points),
      usableWidthCm,
      placements.length,
      excluded.reduce((sum, item) => sum + item.quantity, 0),
    ),
    method: 'nest-blf',
    computeMs: Date.now() - started,
    stats: {
      candidatesTested: state.candidatesTested,
      exactTests: state.exactTests,
      expired: state.expired,
    },
  };
  void stopReason;
  return { result, scaledPieces, capacitySets, attempts };
}
