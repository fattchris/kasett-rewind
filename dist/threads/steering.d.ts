/**
 * Steering prompt builder.
 *
 * Builds prompts for two hooks:
 * 1. Orientation (before_prompt_build, runs on EVERY turn): shows agent the current
 *    thread state and trajectory across recent compactions — light, names only.
 * 2. Pre-compaction (summarize()): instructs the LLM to produce a new summary
 *    with weighted context from previous summaries for continuity.
 */
import type { ThreadMeta } from '../types.js';
import type { WeightedSummary } from './weight.js';
/**
 * Build the orientation string for the before_prompt_build hook.
 * Runs on every agent turn. Shows current thread state + trajectory over
 * recent compactions so the agent knows what it was working on.
 *
 * Accepts multiple ThreadMeta objects (most recent first) — typically the
 * last 3 compaction summaries' [THREAD_META] blocks. Shows trajectory:
 * the most recent is the "current" state, older ones show where things came from.
 *
 * @param metas - Thread meta objects, most recent FIRST (up to 3)
 * @returns Orientation string, or null if no metas provided or all are empty
 */
export declare function buildOrientationPrompt(metas: ThreadMeta[]): string | null;
/**
 * Build the pre-compaction steering prompt.
 * Shows previous summaries weighted by recency so the LLM understands
 * how much historical context to carry forward.
 * Also instructs the LLM to produce [THREAD_META] for orientation.
 *
 * @param weightedSummaries - Previous summaries with temporal weights, most recent first
 * @returns Steering prompt string to inject as system context
 */
export declare function buildSteeringPrompt(weightedSummaries: WeightedSummary[]): string;
//# sourceMappingURL=steering.d.ts.map