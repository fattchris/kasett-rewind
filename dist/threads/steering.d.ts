/**
 * Steering prompt builder.
 *
 * Builds prompts for two hooks:
 * 1. Orientation (before_prompt_build, runs on EVERY turn): shows agent the current
 *    thread state and trajectory across recent compactions — light, names only.
 * 2. Pre-compaction (summarize()): instructs the LLM to produce a new summary
 *    with weighted context from previous summaries for continuity.
 *
 * ## Schema versioning
 *
 * As of B2 (2026-05-12), the steering prompt defaults to `structuredOutput: 'json'`,
 * which asks the LLM for a fenced ```json``` block conforming to schema v2.
 * Legacy `'markdown'` mode preserves the v1 `[THREAD_META]` block for callers
 * that need it. A future `'tool'` mode will wire provider-native tool_use /
 * response_format=json_schema; for now it falls through to 'json' and the call
 * site is responsible for adding the API-level structured-output flag.
 */
import type { ThreadMeta } from '../types.js';
import type { ThreadMetaV2 } from './schema.js';
import type { WeightedSummary } from './weight.js';
/** Steering output mode — controls how the prompt instructs the LLM to format the meta. */
export type StructuredOutputMode = 'json' | 'tool' | 'markdown';
/**
 * Optional tuning for buildSteeringPrompt. All fields default to v2/json.
 */
export interface SteeringOptions {
    /**
     * Output format the LLM should produce.
     *   - 'json' (default): fenced ```json``` block conforming to v2 schema.
     *   - 'tool': same prompt as 'json' for now; assumes the call site is
     *     also passing a tool_use / response_format payload to the provider.
     *   - 'markdown': legacy v1 [THREAD_META] block — backward compat only.
     */
    structuredOutput?: StructuredOutputMode;
    /**
     * Optional list of sub-thread IDs from the previous compaction. When
     * present, the prompt asks the LLM to reuse these `id`s for continuing
     * threads (and only assign new ids for genuinely new work). Critical
     * for ID-based continuity tracking in weight.ts (B2.8).
     */
    previousSubIds?: ReadonlyArray<string>;
}
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
 * V2-aware orientation builder. When V2 metas are available we can render
 * status (active/blocked/completed/fading) and decisions inline, which the
 * v1 string-only schema couldn't express.
 *
 * Fallback rule: if a position has only v1 data (no v2), we render the v1
 * line; if v2, we render the richer line. Mixed timelines are normal during
 * the migration window.
 *
 * @param metas - Most-recent-first list. Each entry can be V1, V2, or both.
 *                When both are present, V2 wins.
 */
export declare function buildOrientationPromptV2(metas: Array<{
    v1?: ThreadMeta;
    v2?: ThreadMetaV2;
}>): string | null;
/**
 * Build the pre-compaction steering prompt.
 *
 * Default mode (v2/json) asks the LLM for both a human-readable summary AND
 * a fenced ```json``` block conforming to the v2 thread-meta schema. The
 * combination is non-negotiable in tone — we treat this as a contract, not
 * a suggestion.
 *
 * Legacy mode ('markdown') preserves the v1 [THREAD_META] sentinel for
 * callers that haven't migrated.
 *
 * @param weightedSummaries - Previous summaries with temporal weights, most recent first
 * @param options - Output format and continuity hints
 * @returns Steering prompt string to inject as system context
 */
export declare function buildSteeringPrompt(weightedSummaries: WeightedSummary[], options?: SteeringOptions): string;
//# sourceMappingURL=steering.d.ts.map