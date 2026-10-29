import { computeMetrics, optimizePlacement, type OptimizerInput, type OptimizerResult } from './optimizer';
import { nestPlacement } from './nesting';
import { rankBetter, consumedLength } from './nesting-score';
import { improvePlacementLocal, type ImproveOptions, type ImproveStats } from './local-improve';
import { candidateUnplaced, validateCandidate } from './nesting-validate';

const DEFAULT_TIME_BUDGET_MS = 3000;
const MIN_IMPROVE_BUDGET_MS = 50;

function improvedCandidate(
  origin: OptimizerResult,
  placements: OptimizerResult['placements'],
  stats: ImproveStats,
): OptimizerResult {
  return {
    ...origin,
    placements,
    metrics: computeMetrics(
      placements.map((placement) => placement.points),
      origin.metrics.usableWidthCm,
      placements.length,
      origin.unplaced.reduce((sum, item) => sum + item.quantity, 0),
    ),
    improve: stats,
    improveApplied: true,
  };
}

export function optimizePlacementBest(
  input: OptimizerInput,
  options: { timeBudgetMs?: number; maxExactTests?: number } = {},
): OptimizerResult {
  const started = Date.now();
  const totalBudgetMs = Math.max(0, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const deadline = started + totalBudgetMs;
  const shelfStarted = Date.now();
  const reference = optimizePlacement(input);
  const shelfFfdMs = Date.now() - shelfStarted;
  let base = reference;
  let nestedStats: OptimizerResult['stats'];
  let nestBlfMs = 0;
  let nestFailed = false;
  const remainingForNest = Math.max(0, deadline - Date.now());
  const nestSkippedForBudget = remainingForNest === 0;
  if (remainingForNest > 0) {
    const nestStarted = Date.now();
    try {
      const nested = nestPlacement(input, {
        timeBudgetMs: remainingForNest,
        maxExactTests: options.maxExactTests,
      });
      nestedStats = nested.stats;
      if (rankBetter(nested, reference)) base = nested;
    } catch {
      nestFailed = true;
    }
    nestBlfMs = Date.now() - nestStarted;
  }

  const improveStarted = Date.now();
  const baseName = base === reference ? 'shelf-ffd' : 'nest-blf';
  const named: Array<{ name: string; result: OptimizerResult }> = [
    { name: baseName, result: base },
  ];
  let lastImproveStats: ImproveStats | undefined;
  if (base.placements.length > 0 && Date.now() < deadline) {
    try {
      const remainingBase = deadline - Date.now();
      if (remainingBase >= MIN_IMPROVE_BUDGET_MS) {
        const improved = improvePlacementLocal(base.placements, input, {
          timeBudgetMs: remainingBase,
        } satisfies ImproveOptions);
        lastImproveStats = improved.stats;
        named.push({
          name: `${baseName}+local`,
          result: improvedCandidate(base, improved.placements, improved.stats),
        });
      }
      if (base !== reference) {
        const baseUnplaced = base.unplaced.reduce((sum, item) => sum + item.quantity, 0);
        const referenceUnplaced = reference.unplaced
          .reduce((sum, item) => sum + item.quantity, 0);
        if (baseUnplaced === referenceUnplaced) {
          const remainingRef = deadline - Date.now();
          if (remainingRef >= MIN_IMPROVE_BUDGET_MS) {
            const improvedRef = improvePlacementLocal(reference.placements, input, {
              timeBudgetMs: remainingRef,
            } satisfies ImproveOptions);
            lastImproveStats = improvedRef.stats;
            named.push({
              name: 'shelf-ffd+local',
              result: improvedCandidate(reference, improvedRef.placements, improvedRef.stats),
            });
          }
        }
      }
    } catch {
      // Keep the best candidate already validated.
    }
  }

  // Validation géométrique INDÉPENDANTE de chaque candidate (étape 16) :
  // une candidate rejetée n'est jamais proposée, quel que soit son
  // score. La référence shelf-ffd est valide par construction.
  const validCandidates = named.filter(
    (entry) => validateCandidate(input, entry.result).length === 0,
  );
  let bestEntry = validCandidates[0] ?? { name: baseName, result: reference };
  for (const entry of validCandidates.slice(1)) {
    if (rankBetter(entry.result, bestEntry.result)) bestEntry = entry;
  }
  const ordered = [...validCandidates].sort((first, second) => {
    if (rankBetter(first.result, second.result)) return -1;
    if (rankBetter(second.result, first.result)) return 1;
    return first.name.localeCompare(second.name);
  });
  const best = bestEntry.result;
  const localImproveMs = Date.now() - improveStarted;
  const budgetExpired = nestSkippedForBudget || nestFailed || nestedStats?.expired === true
    || named.some((entry) => entry.result.improve?.expired === true)
    || Date.now() >= deadline;
  return {
    ...best,
    improve: best.improve ?? lastImproveStats,
    improveApplied: best.improveApplied ?? false,
    computeMs: Date.now() - started,
    stats: nestedStats,
    phaseMs: { shelfFfd: shelfFfdMs, nestBlf: nestBlfMs, localImprove: localImproveMs },
    budgetExpired,
    fallbackUsed: (nestSkippedForBudget || nestFailed || nestedStats?.expired === true)
      && best === reference,
    candidates: ordered.map((entry) => ({
      strategy: entry.name,
      unplaced: candidateUnplaced(entry.result),
      consumedLengthCm: Math.round(consumedLength(entry.result.placements) * 10) / 10,
      retained: entry === bestEntry,
    })),
  };
}
