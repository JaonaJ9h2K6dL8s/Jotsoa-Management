import type { OptimizerInput, OptimizerPlacement, Orientation } from './optimizer';
import { permittedOrientations } from './optimizer';
import { bounds, polygonsConflictFast } from './geometry';
import { PieceIndex, type StampedPiece } from './nesting-index';
import { findBestSpot, type SpotSearchState } from './nesting';

/**
 * Amélioration locale d'un placement VALIDE (pur, sans I/O — étape 6).
 *
 * Phase distincte du nesting initial : compacte une solution existante
 * par déplacements « bottom-left » contrôlés, SANS jamais l'invalider.
 *
 * Principe :
 * - les pièces sont réexaminées des plus hautes vers les plus basses
 *   (ce sont elles qui déterminent la longueur consommée) ;
 * - pour chaque pièce : retrait temporaire de l'index, recherche du
 *   meilleur emplacement bottom-left par `findBestSpot` (contours
 *   réels, gap exact, orientations autorisées — droit-fil et tissu à
 *   sens unique inclus), réinsertion ;
 * - un déplacement n'est accepté que s'il améliore STRICTEMENT la
 *   position de la pièce au sens lexicographique (sommet y + h, puis y,
 *   puis x — tolérance 1e-6) : la clé de chaque pièce décroît à chaque
 *   mouvement accepté et est bornée inférieurement, ce qui interdit
 *   tout cycle (preuve de terminaison) et garantit que la longueur
 *   globale consommée ne peut jamais augmenter ;
 * - budgets configurables : temps (ms), mouvements max, passes max ;
 *   arrêt immédiat à l'échéance en conservant la solution courante,
 *   qui reste valide à chaque instant (le placement initial n'est
 *   remplacé qu'après des mouvements tous validés géométriquement).
 *
 * Aucune suppression de pièce : identité (pieceId), quantité et
 * rotation autorisée sont préservées. Aucune garantie d'optimum.
 */

const EPSILON = 1e-6;

export interface ImproveOptions {
  /** Budget horloge (ms) ; à l'échéance la solution courante est publiée. */
  timeBudgetMs?: number;
  /** Nombre maximal de mouvements acceptés (anti-cycles robuste). */
  maxMoves?: number;
  /** Nombre maximal de passes de compactage. */
  maxPasses?: number;
}

export interface ImproveStats {
  movesAccepted: number;
  exactTests: number;
  passes: number;
  /** true si le budget horloge a interrompu l'amélioration. */
  expired: boolean;
}

export interface ImproveResult {
  placements: OptimizerPlacement[];
  stats: ImproveStats;
}

interface MoveablePiece {
  placement: OptimizerPlacement;
  orientations: Orientation[];
  stamped: StampedPiece;
}

/**
 * Compacte un placement valide : retourne des placements équivalents en
 * identités/quantités, déplacés uniquement si le score s'améliore. La
 * solution d'entrée n'est jamais modifiée (copie défensive).
 */
export function improvePlacementLocal(
  placements: OptimizerPlacement[],
  input: OptimizerInput,
  options: ImproveOptions = {},
): ImproveResult {
  const timeBudgetMs = options.timeBudgetMs ?? 1500;
  const maxMoves = options.maxMoves ?? 400;
  const maxPasses = options.maxPasses ?? 3;
  const deadline = Date.now() + timeBudgetMs;
  const { usableWidthCm, maxLengthCm, gapCm, oneWayFabric = false } = input;
  const stats: ImproveStats = { movesAccepted: 0, exactTests: 0, passes: 0, expired: false };
  if (placements.length === 0) return { placements: [...placements], stats };

  // Orientations autorisées par pièce source (droit-fil + rotations).
  const orientationByPiece = new Map<number, Orientation[]>();
  for (const piece of input.pieces) {
    if (piece.status !== 'configuree' || piece.points.length < 3) continue;
    const { orientations } = permittedOrientations(piece, usableWidthCm, gapCm, oneWayFabric);
    orientationByPiece.set(piece.id, orientations);
  }

  const index = new PieceIndex();
  const pieces: MoveablePiece[] = [];
  let fillMaxX = 0;
  // Copie défensive : les mouvements s'appliquent aux COPIES (result),
  // jamais aux objets reçus de l'appelant.
  const result = placements.map((placement) => ({ ...placement }));
  for (const placement of result) {
    const orientations = orientationByPiece.get(placement.pieceId);
    if (!orientations || orientations.length === 0) continue;
    const box = bounds(placement.points);
    const stamped: StampedPiece = {
      contour: placement.points, box, queryStamp: 0,
    };
    index.insert(stamped, gapCm);
    pieces.push({ placement, orientations, stamped });
    fillMaxX = Math.max(fillMaxX, box.maxX);
  }
  if (pieces.length === 0) return { placements: [...placements], stats };

  const state: SpotSearchState = {
    candidatesTested: 0, exactTests: 0, maxExactTests: Number.MAX_SAFE_INTEGER,
    expired: false, truncated: false,
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    // Comparaison large (>=) : un budget déjà échu (timeBudgetMs: 0
    // inclus) interrompt AVANT tout travail, de façon déterministe —
    // aucun mouvement n'est publié après interruption immédiate.
    if (stats.movesAccepted >= maxMoves || Date.now() >= deadline) {
      if (Date.now() >= deadline) stats.expired = true;
      break;
    }
    stats.passes += 1;
    let moved = 0;
    // Ordre déterministe : pièces les plus hautes d'abord, départage
    // par identifiant puis x (reproductibilité d'une exécution à l'autre).
    const order = [...pieces].sort((a, b) => {
      const topA = bounds(a.placement.points).maxY;
      const topB = bounds(b.placement.points).maxY;
      return topB - topA || a.placement.pieceId - b.placement.pieceId
        || a.placement.x - b.placement.x;
    });
    for (const piece of order) {
      if (stats.movesAccepted >= maxMoves || Date.now() >= deadline) {
        if (Date.now() >= deadline) stats.expired = true;
        break;
      }
      const { placement, stamped } = piece;
      // Sommet actuel de la pièce (cm) : référentiel d'amélioration.
      // Comparer les sommets (y + h) et non les seuls y : un changement
      // d'orientation plus haut ne doit jamais allonger le matelas.
      const oldTop = bounds(placement.points).maxY;
      index.remove(stamped, gapCm);
      const spot = findBestSpot(
        { orientations: piece.orientations },
        index,
        fillMaxX,
        usableWidthCm,
        maxLengthCm,
        gapCm,
        state,
        deadline,
      );
      const improves = spot !== null
        && (spot.y + spot.orientation.h < oldTop - EPSILON
          || (spot.y + spot.orientation.h <= oldTop + EPSILON
            && (spot.y < placement.y - EPSILON
              || (Math.abs(spot.y - placement.y) <= EPSILON
                && spot.x < placement.x - EPSILON))));
      if (improves) {
        const newPoints = spot.orientation.points.map((point) => ({
          x: point.x + spot.x,
          y: point.y + spot.y,
        }));
        const newBox = bounds(newPoints);
        // Double contrôle défensif : limites + conflits exacts.
        let valid = newBox.maxX <= usableWidthCm + EPSILON
          && newBox.maxY <= maxLengthCm + EPSILON;
        if (valid) {
          const near = index.query(
            newBox.minX - gapCm, newBox.minY - gapCm, newBox.maxX + gapCm, newBox.maxY + gapCm,
          );
          for (const neighbour of near) {
            if (polygonsConflictFast(newPoints, neighbour.contour, gapCm)) {
              valid = false;
              break;
            }
          }
        }
        if (valid) {
          placement.x = spot.x;
          placement.y = spot.y;
          placement.rotation = spot.orientation.rotation;
          placement.points = newPoints;
          stamped.contour = newPoints;
          stamped.box = newBox;
          index.insert(stamped, gapCm);
          fillMaxX = Math.max(fillMaxX, newBox.maxX);
          stats.movesAccepted += 1;
          moved += 1;
          continue;
        }
      }
      // Aucune amélioration valide : la pièce retrouve sa position.
      index.insert(stamped, gapCm);
    }
    if (moved === 0) break;
  }
  stats.exactTests = state.exactTests;
  return { placements: result, stats };
}
