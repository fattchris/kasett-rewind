/**
 * ALLM — Adaptive LoRA Lifecycle Management
 * Type definitions for pattern extraction, vitality scoring, and diff engine.
 */

export type PatternCategory =
  | 'instruction_following'
  | 'multi_part'
  | 'tool_call'
  | 'correction_recovery'
  | 'disambiguation'
  | 'formatting'
  | 'domain_specific';

export type PatternSource = 'organic' | 'correction';

export type PatternQuality = 'positive' | 'negative';

export type PatternLifecycle = 'emerging' | 'stable' | 'core' | 'fading' | 'dead';

export interface Pattern {
  id: string;
  category: PatternCategory;
  /** Structural representation of the input that triggered this pattern */
  input: string;
  /** Structural representation of the model's output */
  output: string;
  quality: PatternQuality;
  source: PatternSource;
  /** When this pattern was first extracted */
  createdAt: string;
  /** When this pattern was last matched in a session */
  lastMatchedAt: string;
  /** Number of times matched in sessions */
  matchCount: number;
  /** Embedding vector for semantic similarity (optional, computed lazily) */
  embedding?: number[];
}

export interface VitalityScore {
  patternId: string;
  /** Overall vitality V(p,t) ∈ [0, 1] */
  total: number;
  /** Component scores */
  recency: number;   // R(p,t)
  frequency: number; // F(p,t)
  correction: number; // C(p)
  quality: number;   // Q(p,t)
  /** Lifecycle classification based on trailing-window diff */
  lifecycle: PatternLifecycle;
  /** Computed at */
  computedAt: string;
}

export interface VitalityConfig {
  /** Weight for recency component (default: 0.35) */
  alpha: number;
  /** Weight for frequency component (default: 0.30) */
  beta: number;
  /** Weight for correction-source component (default: 0.20) */
  gamma: number;
  /** Weight for quality signal component (default: 0.15) */
  delta: number;
  /** Decay rate for recency (default: 0.05, half-life ~14 days) */
  lambda: number;
  /** Frequency saturation threshold (default: 10) */
  frequencyMax: number;
  /** Trailing window in days (default: 30) */
  windowDays: number;
}

export const DEFAULT_VITALITY_CONFIG: VitalityConfig = {
  alpha: 0.35,
  beta: 0.30,
  gamma: 0.20,
  delta: 0.15,
  lambda: 0.05,
  frequencyMax: 10,
  windowDays: 30,
};

export interface DiffResult {
  /** Patterns present in all N cycles */
  core: Pattern[];
  /** Patterns present in N-1 cycles */
  stable: Pattern[];
  /** Patterns present in only 1 cycle */
  fading: Pattern[];
  /** Patterns absent from most recent, present in previous */
  dead: Pattern[];
  /** Patterns present only in latest cycle */
  emerging: Pattern[];
  /** Patterns that evolved (similarity 0.70-0.85 to previous version) */
  evolved: Array<{ previous: Pattern; current: Pattern }>;
}

export interface TrainingDataset {
  /** Curated patterns with weights */
  patterns: Array<{
    pattern: Pattern;
    weight: number; // 1.2 for core, 1.0 for stable, 0.8 for fading, 0.5 for emerging
    lifecycle: PatternLifecycle;
  }>;
  /** Metadata */
  cycleNumber: number;
  curatedAt: string;
  prunedCount: number;
  totalCount: number;
}
