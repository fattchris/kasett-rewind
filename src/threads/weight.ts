/**
 * Weighted thread evaluation.
 *
 * Takes N previous ThreadMeta objects + configured weights and produces
 * a classification of threads as core, new, or fading.
 */

import type { ThreadMeta } from '../types.js';

/**
 * Result of weighted thread analysis.
 */
export interface WeightedThreadAnalysis {
  /** Threads appearing in 2+ compactions with high combined weight */
  core: string[];
  /** Threads only in the most recent compaction */
  fresh: string[];
  /** Threads in older compactions but NOT in the most recent */
  fading: string[];
}

/**
 * Weighted entry for a single thread string + its accumulated weight.
 */
interface ThreadWeight {
  text: string;
  weight: number;
  /** Which compaction indices (0=most recent) this thread appeared in */
  appearances: number[];
}

/**
 * Analyze N previous ThreadMeta objects with configured weights.
 *
 * @param metas - Previous thread metas, most recent FIRST
 * @param weights - Weight per slot, most recent first (e.g. [1.0, 0.6, 0.3])
 * @returns Classification of threads into core/fresh/fading
 */
export function analyzeThreads(
  metas: ThreadMeta[],
  weights: number[],
): WeightedThreadAnalysis {
  if (metas.length === 0) {
    return { core: [], fresh: [], fading: [] };
  }

  // Collect all thread strings with their weights
  const threadMap = new Map<string, ThreadWeight>();

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    const weight = weights[i] ?? 0;

    // Collect all threads from this compaction (main + 3 subs)
    const allThreads = [meta.main, ...meta.sub];

    for (const text of allThreads) {
      const normalized = normalizeThread(text);
      if (!normalized) continue;

      const existing = findSimilar(threadMap, normalized);
      if (existing) {
        existing.weight += weight;
        existing.appearances.push(i);
      } else {
        threadMap.set(normalized, {
          text,
          weight,
          appearances: [i],
        });
      }
    }
  }

  // Classify
  const core: string[] = [];
  const fresh: string[] = [];
  const fading: string[] = [];

  for (const entry of threadMap.values()) {
    const inMostRecent = entry.appearances.includes(0);
    const multipleAppearances = entry.appearances.length >= 2;

    if (multipleAppearances && inMostRecent) {
      // Appears in 2+ compactions including the most recent = core
      core.push(entry.text);
    } else if (inMostRecent && !multipleAppearances) {
      // Only in most recent = new/fresh
      fresh.push(entry.text);
    } else if (!inMostRecent) {
      // Not in most recent = fading
      fading.push(entry.text);
    }
  }

  return { core, fresh, fading };
}

/**
 * Normalize a thread string for comparison (lowercase, trim, collapse whitespace).
 */
function normalizeThread(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Find a similar thread in the map using fuzzy matching.
 * Two threads are "similar" if one contains the other or they share
 * significant overlap (>60% of the shorter string).
 */
function findSimilar(
  map: Map<string, ThreadWeight>,
  normalized: string,
): ThreadWeight | undefined {
  // Exact match first
  const exact = map.get(normalized);
  if (exact) return exact;

  // Fuzzy: check for substring containment or significant overlap
  for (const [key, entry] of map.entries()) {
    if (isSimilar(key, normalized)) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Check if two normalized thread strings are similar enough to be the same thread.
 */
function isSimilar(a: string, b: string): boolean {
  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;

  // Significant word overlap
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 3));
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  const smaller = wordsA.size <= wordsB.size ? wordsA : wordsB;
  const larger = wordsA.size <= wordsB.size ? wordsB : wordsA;

  let overlap = 0;
  for (const word of smaller) {
    if (larger.has(word)) overlap++;
  }

  return overlap / smaller.size >= 0.6;
}
