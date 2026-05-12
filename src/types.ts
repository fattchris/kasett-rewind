/**
 * OpenClaw plugin interface types for kasett-rewind.
 * Simple thread meta model: 1 main thread + 3 sub-threads as plain strings.
 */

export interface KasettCompactionConfig {
  /**
   * Model to use for compaction LLM calls.
   * - "default" (or unset): use whatever model OC provides (the agent's primary model via env vars)
   * - Any other string: treated as a model identifier and passed directly to the API
   *   e.g. "claude-haiku-3-5-20241022" or "anthropic/claude-haiku-3-5"
   */
  model?: string;
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
  /** Number of previous compaction thread metas to evaluate (default: 3) */
  windowSize: number;
  /** Weight per compaction slot, most recent first (default: [1.0, 0.6, 0.3]) */
  weights: number[];
  /**
   * Maximum tokens for the compaction LLM call output.
   *
   * Phase F: increased from the previous 4096 default to 32000. Sonnet 4.5
   * supports 64k output; the V3 structured JSON block (5 sub-threads, 20
   * key_state entries, decisions, open_questions) plus a 2-3k word prose
   * summary regularly produces 12-18k chars (~4-6k tokens). Truncation
   * around 14k chars (Phase F live evidence) loses the closing JSON fence
   * and breaks the parser. 32000 leaves comfortable headroom.
   *
   * Default: 32000
   */
  compactionMaxTokens: number;
}

export interface KasettSteeringConfig {
  /** Enable thread tracking and injection on every agent turn (default: true) */
  threadTracking: boolean;
}

export interface KasettConfig {
  /** Compaction provider and rolling window settings */
  compaction: KasettCompactionConfig;
  /** Per-turn orientation/steering hook settings */
  steering: KasettSteeringConfig;
}

export const DEFAULT_CONFIG: KasettConfig = {
  compaction: {
    // model is intentionally unset — defaults to agent's primary model
    hotSwap: true,
    hotSwapTimeoutMs: 30_000,
    windowSize: 3,
    weights: [1.0, 0.6, 0.3],
    compactionMaxTokens: 32000,
  },
  steering: {
    threadTracking: true,
  },
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
