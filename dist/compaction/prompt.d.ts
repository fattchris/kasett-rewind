import type { CompactionSummary } from '../types.js';
/**
 * Builds the compaction prompt that enforces structured thread tracking.
 * This prompt is injected via compaction.customInstructions or used by the
 * full compaction.provider when registered.
 */
export declare function buildCompactionPrompt(previousSummaries: CompactionSummary[], tokenBudget: number): string;
//# sourceMappingURL=prompt.d.ts.map