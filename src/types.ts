/**
 * OpenClaw plugin interface types.
 * These match the OC plugin contract for compaction.provider registration.
 */

export interface CompactionSummary {
  summary: string;
  windowIndex: number;
  windowTotal: number;
  threadSnapshot: ThreadSnapshot;
  timestamp: string;
  tokenCount: number;
}

export interface ThreadSnapshot {
  mainThread: string;
  subThreads: SubThread[];
  keyState: Record<string, string>;
  unresolved: string[];
  threadHistory: ThreadHistoryEntry[];
}

export interface SubThread {
  name: string;
  status: 'active' | 'completed' | 'blocked' | 'backgrounded';
  detail?: string;
}

export interface ThreadHistoryEntry {
  thread: string;
  status: 'active' | 'completed' | 'blocked' | 'backgrounded' | 'deprioritized';
  lastSeen: string; // ISO timestamp of compaction where this was last active
}

export interface CompactionContext {
  /** Full conversation turns to summarize */
  turns: ConversationTurn[];
  /** Previous compaction summaries in the window (oldest first) */
  previousSummaries: CompactionSummary[];
  /** Token budget for this summary */
  tokenBudget: number;
  /** Model to use for summarization */
  model: string;
  /** Agent identity info (for thread context) */
  agentMeta: {
    name?: string;
    sessionKey?: string;
  };
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

export interface KasettConfig {
  /** Number of compaction summaries to retain (default: 2) */
  windowSize: number;
  /** Token budget split [oldest..newest, recentTurns] — must sum to 1.0 */
  windowBudgetSplit: number[];
  /** Enable structured thread tracking (default: true) */
  threadTracking: boolean;
  /** Enable ALLM pattern extraction during compaction (default: false) */
  allmExtraction: boolean;
  /** Path to store ALLM patterns (default: ./data/allm/) */
  allmDataPath: string;
}

export const DEFAULT_CONFIG: KasettConfig = {
  windowSize: 2,
  windowBudgetSplit: [0.3, 0.3, 0.4],
  threadTracking: true,
  allmExtraction: false,
  allmDataPath: './data/allm/',
};
