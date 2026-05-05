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
}

export const DEFAULT_CONFIG: KasettConfig = {
  windowSize: 3,
  weights: [1.0, 0.6, 0.3],
  threadTracking: true,
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
