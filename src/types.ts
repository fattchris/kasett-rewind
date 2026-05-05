/**
 * OpenClaw plugin interface types for kasett-rewind.
 * Simple thread meta model: 1 main thread + 3 sub-threads as plain strings.
 */

export interface KasettConfig {
  /** Number of previous compaction thread metas to evaluate (default: 3) */
  windowSize: number;
  /** Weight per compaction slot, most recent first (default: [1.0, 0.6, 0.3]) */
  weights: number[];
  /** Enable thread tracking (default: true) */
  threadTracking: boolean;
  /**
   * Model to use for compaction LLM calls.
   * - "default" (or unset): use whatever model OC provides (the agent's primary model via env vars)
   * - Any other string: treated as a model identifier and passed directly to the API
   *   e.g. "claude-haiku-3-5-20241022" or "anthropic/claude-haiku-3-5"
   */
  compactionModel?: string;
  /**
   * Enable hot-swap compaction (zero-delay stub return with background rewrite).
   * When true, summarize() returns a stub immediately and the full LLM summary
   * is written to the JSONL between turns via an atomic hot-swap.
   * Default: true
   */
  hotSwap: boolean;
  /**
   * Maximum time (ms) to wait for the session write lock to clear before
   * the background hot-swap worker gives up.
   * Default: 30000
   */
  hotSwapTimeoutMs: number;
}

export const DEFAULT_CONFIG: KasettConfig = {
  windowSize: 3,
  weights: [1.0, 0.6, 0.3],
  threadTracking: true,
  // compactionModel is intentionally unset — defaults to agent's primary model
  hotSwap: true,
  hotSwapTimeoutMs: 30_000,
};

/**
 * A compaction event as stored in the session JSONL.
 */
export interface CompactionEvent {
  type: 'compaction';
  id?: string;
  timestamp?: string;
  data: {
    summary: string;
    kaspiett?: ThreadMeta;
  };
}

/**
 * Thread meta — always exactly 1 main + 3 subs.
 */
export interface ThreadMeta {
  main: string;
  sub: [string, string, string];
}

/**
 * A single conversation turn (for context in hooks).
 */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
}
