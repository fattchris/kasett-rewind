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
/**
 * Cold-start / session-rollover bridge settings.
 *
 * When a new session is created for a sessionKey that has prior session JSONLs
 * on disk (typical after >24h idle), kasett's normal compaction/sibling-summary
 * paths produce no orientation if the prior session never triggered a
 * compaction. The cold-start branch fills that gap by generating a one-shot
 * rollover summary from the prior session's raw turns.
 */
export interface KasettColdStartConfig {
    /**
     * Master switch for the cold-start rollover bridge. When false, the entire
     * Tier 3 path in `before_prompt_build` is inert.
     * Default: true
     */
    enabled: boolean;
    /**
     * Minimum number of user/assistant turns in the CURRENT session before the
     * cold-start branch refuses to fire. If the current session already has
     * more than this many turns, it isn't "cold" — don't inject.
     * Default: 2
     */
    minTurns: number;
    /**
     * Maximum idle time (in hours) between the sibling's mtime and now. Older
     * siblings are skipped — stale context is worse than no context.
     * Default: 168 (7 days)
     */
    maxIdleHours: number;
    /**
     * Whether to run summarization in the background (hot-swap). When true,
     * the first turn gets a cheap synchronous stub and the rich summary is
     * picked up on the next turn. When false, the first turn blocks on the
     * LLM call (not recommended for production).
     * Default: true
     */
    hotSwap: boolean;
    /**
     * Max time (ms) the background worker will wait before giving up. The stub
     * remains in place if this timeout is exceeded.
     * Default: 30000
     */
    hotSwapTimeoutMs: number;
    /**
     * Maximum number of turns from the sibling session that feed the rollover
     * summary LLM call. Capped from the tail — most recent N turns.
     * Default: 200
     */
    maxSourceTurns: number;
}
export interface KasettConfig {
    /** Compaction provider and rolling window settings */
    compaction: KasettCompactionConfig;
    /** Per-turn orientation/steering hook settings */
    steering: KasettSteeringConfig;
    /** Cold-start / session-rollover bridge settings */
    coldStart: KasettColdStartConfig;
}
export declare const DEFAULT_CONFIG: KasettConfig;
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
//# sourceMappingURL=types.d.ts.map