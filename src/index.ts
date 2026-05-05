/**
 * kasett-rewind — OpenClaw Compaction Plugin
 *
 * Provides:
 * 1. Rolling compaction window (N summaries retained)
 * 2. Structured thread tracking across compactions
 * 3. ALLM pattern extraction pipeline
 *
 * Registration: Set as compaction.provider in openclaw.json,
 * or use compaction.customInstructions for Phase 1 (prompt-only).
 */

export { CompactionProvider } from './compaction/provider.js';
export { CompactionWindow } from './compaction/window.js';
export { ThreadTracker } from './compaction/threads.js';
export { buildCompactionPrompt } from './compaction/prompt.js';

export { PatternExtractor } from './allm/extractor.js';
export { VitalityScorer } from './allm/vitality.js';
export { DiffEngine } from './allm/diff.js';

export type {
  CompactionSummary,
  CompactionContext,
  ThreadSnapshot,
  SubThread,
  KasettConfig,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';

export type {
  Pattern,
  VitalityScore,
  VitalityConfig,
  DiffResult,
  TrainingDataset,
  PatternCategory,
  PatternLifecycle,
} from './allm/types.js';
