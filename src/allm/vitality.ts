import type { Pattern, VitalityConfig, VitalityScore } from './types.js';
import { DEFAULT_VITALITY_CONFIG } from './types.js';

/**
 * Vitality scoring engine.
 * Computes V(p, t) = α·R(p,t) + β·F(p,t) + γ·C(p) + δ·Q(p,t)
 */
export class VitalityScorer {
  private config: VitalityConfig;

  constructor(config: Partial<VitalityConfig> = {}) {
    this.config = { ...DEFAULT_VITALITY_CONFIG, ...config };
  }

  /**
   * Compute vitality score for a single pattern.
   * @param pattern - The pattern to score
   * @param now - Current timestamp (ISO string or Date)
   * @param qualitySignal - Q(p,t) if available, defaults to 1.0
   */
  score(
    pattern: Pattern,
    now: Date = new Date(),
    qualitySignal: number = 1.0,
  ): VitalityScore {
    const { alpha, beta, gamma, delta } = this.config;

    const recency = this.computeRecency(pattern, now);
    const frequency = this.computeFrequency(pattern);
    const correction = this.computeCorrectionWeight(pattern);
    const quality = Math.min(2.0, Math.max(0.0, qualitySignal)); // Clamp [0, 2]

    const total = alpha * recency + beta * frequency + gamma * correction + delta * quality;

    return {
      patternId: pattern.id,
      total: Math.min(1.0, Math.max(0.0, total)), // Clamp [0, 1]
      recency,
      frequency,
      correction,
      quality,
      lifecycle: this.classifyLifecycle(total),
      computedAt: now.toISOString(),
    };
  }

  /**
   * Batch score all patterns.
   */
  scoreAll(
    patterns: Pattern[],
    now: Date = new Date(),
    qualitySignals?: Map<string, number>,
  ): VitalityScore[] {
    return patterns.map((p) =>
      this.score(p, now, qualitySignals?.get(p.id) ?? 1.0),
    );
  }

  /**
   * R(p, t) = exp(-λ · Δt(p))
   * Δt = days since last match
   */
  private computeRecency(pattern: Pattern, now: Date): number {
    const lastMatched = new Date(pattern.lastMatchedAt);
    const daysSinceMatch =
      (now.getTime() - lastMatched.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-this.config.lambda * Math.max(0, daysSinceMatch));
  }

  /**
   * F(p, t) = min(1.0, count / F_max)
   * Uses matchCount as proxy for frequency in window
   */
  private computeFrequency(pattern: Pattern): number {
    return Math.min(1.0, pattern.matchCount / this.config.frequencyMax);
  }

  /**
   * C(p) = 1.0 if correction, 0.5 if organic
   */
  private computeCorrectionWeight(pattern: Pattern): number {
    return pattern.source === 'correction' ? 1.0 : 0.5;
  }

  /**
   * Classify lifecycle stage based on vitality score.
   */
  private classifyLifecycle(score: number): VitalityScore['lifecycle'] {
    if (score >= 0.8) return 'core';
    if (score >= 0.5) return 'stable';
    if (score >= 0.2) return 'fading';
    return 'dead';
  }
}
