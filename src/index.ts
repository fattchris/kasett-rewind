/**
 * kasett-rewind — OpenClaw Compaction Plugin
 *
 * Rolling compaction window + structured thread tracking.
 * Prevents goldfish brain by retaining N compaction summaries
 * and enforcing thread evolution rules across compactions.
 *
 * ALLM (Adaptive LoRA Lifecycle Management) is a separate system
 * that consumes data from this plugin's output. See /research and /patents.
 */

export { CompactionProvider } from './compaction/provider.js';
export { CompactionWindow } from './compaction/window.js';
export { ThreadTracker } from './compaction/threads.js';
export { buildCompactionPrompt } from './compaction/prompt.js';

export type {
  CompactionSummary,
  CompactionContext,
  ThreadSnapshot,
  SubThread,
  KasettConfig,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
