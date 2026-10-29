import type { Box, Point } from './types';
import {
  computeMetrics,
  permittedOrientations,
  type OptimizerInput,
  type OptimizerPlacement,
  type OptimizerResult,
  type OptimizerUnplaced,
  type Orientation,
} from './optimizer';
import { polygonArea, polygonsConflictFast } from './geometry';
import { PieceIndex, bboxDistance, capValues, type StampedPiece } from './nesting-index';
import { NEST_ORDERS } from './nesting-orders';
import { consumedLength } from './nesting-score';

/**
 * Nesting « bottom-left-fill » sur les CONTOURS RÉELS (pur, sans I/O).
 *
 * Différence avec `shelf-ffd` (enveloppes rectangulaires par étagères) :
 * ici les positions candidates proviennent des sommets des contours déjà
 * placés (± gap) et de leurs bords d'enveloppe, ce qui permet d'occuper
 * les espaces libres des pièces concaves (creux d'une pièce en L, vides
 * entre galbes). Chaque candidat est validé par le contrôle géométrique
 * EXACT (`polygonsConflictFast` avec gap, préfiltré par distance
 * d'enveloppes et par index spatial) : la validité ne repose jamais sur
 * une approximation.
 *
 * Performance (étape 6) : conflits testés par OFFSET (aucun contour
 * intermédiaire alloué par candidat), une seule requête d'index par
 * colonne (réutilisée pour tous les y de la colonne), dédoublonnage des
 * requêtes par tampon de génération. L'amélioration locale
 * (`local-improve.ts`) et l'orchestration best-of
 * (`best-placement.ts`) sont des modules séparés.
 *
 * Stratégie déterministe :
 * - 4 ordres de placement (hauteur max, aire, largeur max, complexité
 *   du contour — décroissants, voir `nesting-orders.ts`) ;
 * - pour chaque pièce : candidats triés « bottom-left » (y puis x),
 *   orientations triées par hauteur croissante ; premier emplacement
 *   valide retenu ;
 * - budgets explicites : tests géométriques exacts max (déterministe) et
 *   budget horloge de sécurité (ms), vérifiés à chaque colonne. Une passe
 *   interrompue retourne son résultat PARTIEL (pièces restantes listées
 *   « non placées — budget »), jamais une solution prétendue complète.
 *
 * Score de comparaison documenté (`nesting-score.ts`) : non placées,
 * puis longueur consommée, puis empreinte stable. AUCUNE garantie
 * d'optimum global : heuristique constructive.
 * Unité unique : le centimètre réel (X = largeur tissu, Y = matelas).
 */

const EPSILON = 1e-6;
/** Valeurs candidates max par colonne-x (échantillonnage déterministe). */
const MAX_AXIS_VALUES = 40;
/** Y candidats max par colonne (échantillonnage déterministe). */
const MAX_COLUMN_YS = 24;
/** Tests géométriques exacts max par passe (déterministe ; le garde-fou
 * opérationnel reste le budget horloge). */
const DEFAULT_MAX_EXACT_TESTS = 500000;
/** Budget horloge par défaut de la méthode combinée (sécurité). */
const DEFAULT_TIME_BUDGET_MS = 3000;

export interface NestOptions {
  /** Budget horloge de sécurité (ms) ; dépassement → repli sûr. */
  timeBudgetMs?: number;
  /** Tests géométriques exacts max par passe (déterministe). */
  maxExactTests?: number;
}

export interface NestItem {
  pieceId: number;
  code: string;
  label: string;
  orientations: Orientation[];
  minH: number;
  maxW: number;
  areaM2: number;
}

export interface SpotSearchState {
  candidatesTested: number;
  exactTests: number;
  maxExactTests: number;
  expired: boolean;
  truncated: boolean;
}

interface PassResult {
  placements: OptimizerPlacement[];
  unplaced: OptimizerUnplaced[];
  stats: SpotSearchState;
}

function translate(points: Point[], x: number, y: number): Point[] {
  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}

/** Préparation des pièces (mêmes règles de rejet que shelf-ffd). */
function prepareItems(input: OptimizerInput): { items: NestItem[]; unplaced: OptimizerUnplaced[] } {
  const items: NestItem[] = [];
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
    const invalid = piece.points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    );
    const areaM2 = polygonArea(piece.points) / 10000;
    if (invalid || !(areaM2 > 0)) {
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
      unplaced.push({ code: piece.code, label: piece.label, quantity: qty, reason: reason ?? 'Placement impossible.' });
      continue;
    }
    for (let copy = 0; copy < qty; copy += 1) {
      items.push({
        pieceId: piece.id,
        code: piece.code,
        label: piece.label,
        orientations,
        minH: Math.min(...orientations.map((o) => o.h)),
        maxW: Math.max(...orientations.map((o) => o.w)),
        areaM2,
      });
    }
  }
  return { items, unplaced };
}

/**
 * Recherche « bottom-left » du meilleur emplacement d'une pièce contre
 * l'index courant : balayage de colonnes (x ascendant), y candidats par
 * colonne (sol, plafonds d'enveloppe, sommets des pièces proches),
 * orientations par hauteur croissante. Conflits testés par OFFSET sur
 * le contour non translaté (zéro allocation par candidat). Retourne le
 * premier emplacement valide le plus bas/gauche, ou le meilleur trouvé
 * avant interruption du budget (state.expired).
 */
export function findBestSpot(
  item: { orientations: Orientation[] },
  index: PieceIndex,
  fillMaxX: number,
  usableWidthCm: number,
  maxLengthCm: number,
  gapCm: number,
  state: SpotSearchState,
  timeDeadline: number,
): { x: number; y: number; orientation: Orientation } | null {
  // Ancres X : origine, bord droit de la zone remplie, sommets/bords
  // des pièces situées sous le front de remplissage.
  const baseXs: number[] = [0, fillMaxX + gapCm, fillMaxX];
  const anchorPieces = fillMaxX > 0
    ? index.query(0, 0, fillMaxX + gapCm, maxLengthCm + gapCm)
    : [];
  for (const piece of anchorPieces) {
    baseXs.push(piece.box.minX, piece.box.minX - gapCm, piece.box.maxX, piece.box.maxX + gapCm);
    for (const vertex of piece.contour) {
      baseXs.push(vertex.x, vertex.x + gapCm, vertex.x - gapCm);
    }
  }
  const baseAxis = capValues(baseXs.filter((v) => v >= -EPSILON), MAX_AXIS_VALUES);
  const orientations = [...item.orientations].sort((a, b) => a.h - b.h || b.w - a.w);
  let best: { x: number; y: number; orientation: Orientation } | null = null;
  for (const orientation of orientations) {
    const w = orientation.w;
    const columns = capValues(
      baseAxis.filter((x) => x + w <= usableWidthCm + EPSILON),
      MAX_AXIS_VALUES,
    );
    for (const x of columns) {
      if (Date.now() > timeDeadline) {
        state.expired = true;
        return best;
      }
      if (best !== null && best.y === 0 && best.x <= x) break;
      // Y candidats de la colonne : sol, plafonds d'enveloppe et
      // sommets des pièces proches (le creux d'une pièce concave
      // provient de ses sommets internes, ex. bas de barre d'un L).
      const ys: number[] = [0];
      const near = index.query(x - gapCm, 0, x + w + gapCm, maxLengthCm + gapCm);
      for (const piece of near) {
        ys.push(piece.box.maxY + gapCm);
        for (const vertex of piece.contour) {
          if (vertex.x >= x - gapCm - EPSILON && vertex.x <= x + w + gapCm + EPSILON) {
            ys.push(vertex.y + gapCm);
          }
        }
      }
      const columnYs = capValues(ys.filter((y) => y + orientation.h <= maxLengthCm + EPSILON), MAX_COLUMN_YS);
      for (const y of columnYs) {
        if (best !== null && (y > best.y || (y === best.y && x >= best.x))) break;
        state.candidatesTested += 1;
        const box: Box = {
          minX: x, minY: y, maxX: x + w, maxY: y + orientation.h,
        };
        let conflict = false;
        // `near` couvre x-gap..x+w+gap sur TOUTE la longueur : il
        // contient donc toute pièce dont l'enveloppe élargie toucherait
        // la boîte candidate (zone incluse) — aucune 2e requête utile.
        for (const piece of near) {
          if (bboxDistance(box, piece.box) > gapCm + EPSILON) continue;
          state.exactTests += 1;
          if (state.exactTests > state.maxExactTests) {
            state.expired = true;
            return best;
          }
          if (polygonsConflictFast(orientation.points, piece.contour, gapCm, x, y)) {
            conflict = true;
            break;
          }
        }
        if (!conflict) {
          best = { x, y, orientation };
          break;
        }
      }
    }
  }
  return best;
}

/**
 * Une passe de nesting complet. Si le budget expire en cours de passe,
 * la passe retourne son résultat partiel (pièces restantes explicitement
 * « non placées — budget ») : jamais une solution prétendue complète.
 */
function runPass(
  items: NestItem[],
  input: OptimizerInput,
  maxExactTests: number,
  timeDeadline: number,
): PassResult {
  const { usableWidthCm, maxLengthCm, gapCm } = input;
  const index = new PieceIndex();
  let fillMaxX = 0;
  const placements: OptimizerPlacement[] = [];
  const unplaced: OptimizerUnplaced[] = [];
  const state: SpotSearchState = {
    candidatesTested: 0, exactTests: 0, maxExactTests, expired: false, truncated: false,
  };
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    const spot = findBestSpot(
      item, index, fillMaxX, usableWidthCm, maxLengthCm, gapCm, state, timeDeadline,
    );
    if (spot === null) {
      const alone = item.minH > maxLengthCm + EPSILON;
      unplaced.push({
        code: item.code,
        label: item.label,
        quantity: 1,
        reason: state.expired
          ? `Budget de calcul dépassé avant le placement de ${item.label}.`
          : alone
            ? `Longueur de tissu insuffisante pour ${item.label} `
              + `(${item.minH.toFixed(1)} cm requis, ${maxLengthCm.toFixed(0)} cm disponibles).`
            : state.truncated
              ? `Recherche interrompue (budget de candidats) pour ${item.label}.`
              : `Aucun emplacement disponible pour ${item.label} `
                + `dans les limites et marges du matelas.`,
      });
      if (state.expired) {
        for (const rest of items.slice(position + 1)) {
          unplaced.push({
            code: rest.code,
            label: rest.label,
            quantity: 1,
            reason: `Budget de calcul dépassé avant le placement de ${rest.label}.`,
          });
        }
        break;
      }
      continue;
    }
    const points = translate(spot.orientation.points, spot.x, spot.y);
    placements.push({
      pieceId: item.pieceId,
      code: item.code,
      label: item.label,
      x: spot.x,
      y: spot.y,
      rotation: spot.orientation.rotation,
      points,
    });
    const stamped: StampedPiece = {
      contour: points,
      box: {
        minX: spot.x, minY: spot.y,
        maxX: spot.x + spot.orientation.w, maxY: spot.y + spot.orientation.h,
      },
      queryStamp: 0,
    };
    index.insert(stamped, gapCm);
    fillMaxX = Math.max(fillMaxX, spot.x + spot.orientation.w);
  }
  return { placements, unplaced, stats: state };
}

function passScore(pass: PassResult): number {
  return pass.unplaced.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Nesting BLF : meilleure passe parmi les ordres déterministes.
 * L'amélioration locale et l'orchestration best-of sont assurées par
 * `best-placement.ts`.
 */
export function nestPlacement(input: OptimizerInput, options: NestOptions = {}): OptimizerResult {
  const started = Date.now();
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxExactTests = options.maxExactTests ?? DEFAULT_MAX_EXACT_TESTS;
  const deadline = started + timeBudgetMs;
  const { items, unplaced } = prepareItems(input);
  const orders = NEST_ORDERS;
  let best: PassResult | null = null;
  const totals: SpotSearchState = {
    candidatesTested: 0, exactTests: 0, maxExactTests, expired: false, truncated: false,
  };
  for (const order of orders) {
    if (best !== null && Date.now() > deadline) {
      totals.expired = true;
      break;
    }
    const attempt = runPass([...items].sort(order), input, maxExactTests, deadline);
    totals.candidatesTested += attempt.stats.candidatesTested;
    totals.exactTests += attempt.stats.exactTests;
    totals.expired = totals.expired || attempt.stats.expired;
    if (best === null || passScore(attempt) < passScore(best)
      || (passScore(attempt) === passScore(best)
        && consumedLength(attempt.placements) < consumedLength(best.placements))) {
      best = attempt;
    }
  }
  if (best === null) {
    // Aucune pièce n'a pu être traitée (budget épuisé immédiatement).
    return {
      placements: [],
      unplaced: [
        ...unplaced,
        ...items.map((item) => ({
          code: item.code,
          label: item.label,
          quantity: 1,
          reason: `Budget de calcul dépassé pour ${item.label} : `
            + 'relancez l’optimisation ou réduisez le nombre de pièces.',
        })),
      ],
      metrics: computeMetrics([], input.usableWidthCm, 0, items.length + unplaced.length),
      method: 'nest-blf',
      computeMs: Date.now() - started,
      stats: { candidatesTested: 0, exactTests: 0, expired: true },
    };
  }
  const merged = { ...best, unplaced: [...unplaced, ...best.unplaced] };
  const metrics = computeMetrics(
    merged.placements.map((placement) => placement.points),
    input.usableWidthCm,
    merged.placements.length,
    merged.unplaced.reduce((sum, item) => sum + item.quantity, 0),
  );
  return {
    ...merged,
    metrics,
    method: 'nest-blf',
    computeMs: Date.now() - started,
    stats: {
      candidatesTested: totals.candidatesTested,
      exactTests: totals.exactTests,
      expired: totals.expired,
    },
  };
}

