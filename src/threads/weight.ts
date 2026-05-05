/**
 * Temporal decay weighting for compaction summaries.
 *
 * Weights govern how much each previous compaction summary influences
 * the new summary. Higher weight = more influence. Lower weight = older
 * context that should only be retained if still relevant.
 *
 * Example: weights [1.0, 0.6, 0.3] applied to the last 3 summaries means:
 *   - Most recent summary: 100% influence (reference heavily)
 *   - Previous summary: 60% influence (retain still-relevant threads)
 *   - Oldest summary: 30% influence (background context only)
 */

/**
 * A previous compaction summary paired with its temporal weight.
 */
export interface WeightedSummary {
  /** The full compaction summary text (may include [THREAD_META] block) */
  summary: string;
  /** Temporal weight [0,1] — higher = more recent, more influential */
  weight: number;
  /** Human-readable label for use in prompts */
  label: string;
}

/**
 * Pair previous compaction summaries with their temporal decay weights.
 *
 * @param summaries - Previous summaries, most recent FIRST
 * @param weights - Weight per slot, most recent first (e.g. [1.0, 0.6, 0.3])
 * @returns Array of WeightedSummary objects, most recent first
 */
export function weightSummaries(
  summaries: string[],
  weights: number[],
): WeightedSummary[] {
  if (summaries.length === 0) return [];

  return summaries.slice(0, weights.length).map((summary, i) => {
    const weight = weights[i] ?? 0;
    const label = i === 0
      ? `Previous summary (weight ${weight} — most recent)`
      : `Earlier summary (weight ${weight}${i === summaries.length - 1 && summaries.length > 1 ? ' — oldest context' : ''})`;

    return { summary, weight, label };
  });
}
