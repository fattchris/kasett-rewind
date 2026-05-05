import type { DiffResult, Pattern, TrainingDataset, VitalityScore } from './types.js';

/**
 * Trailing-Window Diff Engine.
 * Compares pattern presence across N training cycles to classify lifecycle.
 */
export class DiffEngine {
  private readonly windowSize: number;
  private readonly similarityThreshold: number;
  private readonly evolutionLowerBound: number;
  private readonly evolutionUpperBound: number;

  constructor(opts?: {
    windowSize?: number;
    similarityThreshold?: number;
    evolutionLowerBound?: number;
    evolutionUpperBound?: number;
  }) {
    this.windowSize = opts?.windowSize ?? 3;
    this.similarityThreshold = opts?.similarityThreshold ?? 0.85;
    this.evolutionLowerBound = opts?.evolutionLowerBound ?? 0.70;
    this.evolutionUpperBound = opts?.evolutionUpperBound ?? 0.85;
  }

  /**
   * Run the diff across training cycle history.
   * @param currentPatterns - Patterns extracted in the current cycle
   * @param previousCycles - Patterns from previous N cycles (most recent first)
   */
  diff(
    currentPatterns: Pattern[],
    previousCycles: Pattern[][],
  ): DiffResult {
    const result: DiffResult = {
      core: [],
      stable: [],
      fading: [],
      dead: [],
      emerging: [],
      evolved: [],
    };

    const cycleCount = Math.min(previousCycles.length + 1, this.windowSize);
    const currentIds = new Set(currentPatterns.map((p) => p.id));

    // Build presence map: patternId → number of cycles present
    const presenceCount = new Map<string, number>();

    // Current cycle
    for (const p of currentPatterns) {
      presenceCount.set(p.id, (presenceCount.get(p.id) ?? 0) + 1);
    }

    // Previous cycles
    for (const cycle of previousCycles.slice(0, this.windowSize - 1)) {
      for (const p of cycle) {
        presenceCount.set(p.id, (presenceCount.get(p.id) ?? 0) + 1);
      }
    }

    // Classify based on presence
    for (const p of currentPatterns) {
      const count = presenceCount.get(p.id) ?? 0;

      if (count >= cycleCount) {
        result.core.push(p);
      } else if (count >= cycleCount - 1) {
        result.stable.push(p);
      } else if (count === 1) {
        // Only in current — check if it's truly new or an evolution
        const evolution = this.findEvolution(p, previousCycles);
        if (evolution) {
          result.evolved.push({ previous: evolution, current: p });
        } else {
          result.emerging.push(p);
        }
      } else {
        result.fading.push(p);
      }
    }

    // Dead patterns: in previous cycles but NOT in current
    for (const cycle of previousCycles.slice(0, this.windowSize - 1)) {
      for (const p of cycle) {
        if (!currentIds.has(p.id) && !result.dead.find((d) => d.id === p.id)) {
          const count = presenceCount.get(p.id) ?? 0;
          if (count >= 2) {
            // Was in multiple previous cycles but absent now → dead
            result.dead.push(p);
          }
        }
      }
    }

    return result;
  }

  /**
   * Curate a training dataset from diff results + vitality scores.
   */
  curate(
    diff: DiffResult,
    scores: Map<string, VitalityScore>,
    cycleNumber: number,
    minDatasetSize: number = 50,
  ): TrainingDataset {
    const patterns: TrainingDataset['patterns'] = [];

    // Core: weight 1.2
    for (const p of diff.core) {
      patterns.push({ pattern: p, weight: 1.2, lifecycle: 'core' });
    }

    // Stable: weight 1.0
    for (const p of diff.stable) {
      patterns.push({ pattern: p, weight: 1.0, lifecycle: 'stable' });
    }

    // Fading: weight 0.8
    for (const p of diff.fading) {
      patterns.push({ pattern: p, weight: 0.8, lifecycle: 'fading' });
    }

    // Emerging: weight 1.0 (normal, monitor next cycle)
    for (const p of diff.emerging) {
      patterns.push({ pattern: p, weight: 1.0, lifecycle: 'emerging' });
    }

    // Evolved: current version at weight 1.0
    for (const { current } of diff.evolved) {
      patterns.push({ pattern: current, weight: 1.0, lifecycle: 'stable' });
    }

    // Dead: prune (don't include) — unless it would drop below minimum
    let prunedCount = diff.dead.length;
    if (patterns.length < minDatasetSize && diff.dead.length > 0) {
      // Add back lowest-vitality dead patterns to meet minimum
      const sortedDead = [...diff.dead].sort((a, b) => {
        const sa = scores.get(a.id)?.total ?? 0;
        const sb = scores.get(b.id)?.total ?? 0;
        return sb - sa; // Highest first
      });
      const needed = minDatasetSize - patterns.length;
      const rescued = sortedDead.slice(0, needed);
      for (const p of rescued) {
        patterns.push({ pattern: p, weight: 0.5, lifecycle: 'dead' });
      }
      prunedCount -= rescued.length;
    }

    return {
      patterns,
      cycleNumber,
      curatedAt: new Date().toISOString(),
      prunedCount: Math.max(0, prunedCount),
      totalCount: patterns.length,
    };
  }

  /**
   * Find if a pattern is an evolution of a previous pattern.
   * Uses ID prefix matching for now — embedding similarity when available.
   */
  private findEvolution(
    current: Pattern,
    previousCycles: Pattern[][],
  ): Pattern | undefined {
    // Simple heuristic: same category + input substring overlap > 50%
    for (const cycle of previousCycles) {
      for (const prev of cycle) {
        if (prev.category !== current.category) continue;
        if (prev.id === current.id) continue;

        const similarity = this.textSimilarity(prev.input, current.input);
        if (
          similarity >= this.evolutionLowerBound &&
          similarity < this.evolutionUpperBound
        ) {
          return prev;
        }
      }
    }
    return undefined;
  }

  /**
   * Simple text similarity (Jaccard on word tokens).
   * In production, use embedding cosine similarity.
   */
  private textSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/));
    const tokensB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}
