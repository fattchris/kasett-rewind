/**
 * Temporal decay weighting for compaction summaries.
 *
 * Weights govern how much each previous compaction summary influences
 * the new summary. Higher weight = more influence. Lower weight = older
 * context that should only be retained if still relevant.
 *
 * Example: weights [1.0, 0.6, 0.3] applied to the last 3 summaries means:
 *   - Most recent summary: 100% influence (reference heavily)
 *   - Previous summary: 60% influence (retain still-relevant threads)
 *   - Oldest summary: 30% influence (background context only)
 */
/**
 * A previous compaction summary paired with its temporal weight.
 */
export interface WeightedSummary {
    /** The full compaction summary text (may include [THREAD_META] block) */
    summary: string;
    /** Temporal weight [0,1] — higher = more recent, more influential */
    weight: number;
    /** Human-readable label for use in prompts */
    label: string;
}
/**
 * Pair previous compaction summaries with their temporal decay weights.
 *
 * @param summaries - Previous summaries, most recent FIRST
 * @param weights - Weight per slot, most recent first (e.g. [1.0, 0.6, 0.3])
 * @returns Array of WeightedSummary objects, most recent first
 */
export declare function weightSummaries(summaries: string[], weights: number[]): WeightedSummary[];
import type { KeyStateEntry, KeyStateKind, ThreadMetaV2, ThreadMetaV3, ThreadSubV2 } from './schema.js';
import { type IdentityMatch, type MatchOptions } from './identity.js';
/**
 * Classification of a single sub-thread relative to recent history.
 *
 * Phase D adds two non-exclusive identity-aware classifications stacked
 * on top of the legacy core/fresh/fading taxonomy:
 *   - 'renamed'  — appears under a new label this compaction
 *   - 'merged'   — collapses multiple prior threads into one
 *
 * For the legacy classifier output (V1/V2 paths) only the original three
 * are emitted. Identity-aware paths return the richer enum.
 */
export type ThreadContinuityClass = 'core' | 'fresh' | 'fading' | 'renamed' | 'merged';
export interface ClassifiedThread {
    /** The thread's stable id (v2) or label-as-id fallback (v1) */
    id: string;
    /** Human-readable label */
    label: string;
    /** core = appears in most recent metas; fresh = just appeared; fading = was here, no longer is */
    classification: ThreadContinuityClass;
    /** Number of metas this thread (or matching variant) appears in */
    appearances: number;
    /** Status from the most recent v2 entry that contains it; undefined if v1-only */
    latestStatus?: ThreadSubV2['status'];
}
/**
 * Classify sub-threads across a window of v2 metas using exact id matching.
 *
 * @param metas - Most-recent-first array of v2 metas (length 2-N)
 * @returns Per-thread classification
 */
export declare function classifyThreadsV2(metas: ThreadMetaV2[]): ClassifiedThread[];
/**
 * Classify sub-threads via substring matching on labels (v1 fallback path).
 *
 * Match rule: two labels A and B count as the same thread iff one contains
 * the other as a substring AND the shared length is ≥ 50% of the shorter.
 * This is the fuzzy heuristic from the strategic analysis — brittle, but
 * the best we can do without `id`s.
 *
 * @param metasAsLabels - Most-recent-first array of sub-thread label arrays
 * @returns Per-thread classification (id is the canonical label from the
 *          most recent appearance)
 */
export declare function classifyThreadsV1Fallback(metasAsLabels: string[][]): ClassifiedThread[];
export interface ClassifiedKeyState {
    kind: KeyStateKind;
    value: string;
    /** Latest label seen for this value (empty if none was ever set). */
    label?: string;
    classification: ThreadContinuityClass;
    /** Number of metas this value appears in (within the window). */
    appearances: number;
}
/**
 * Classify key state across a window of v3 metas using exact (kind, value)
 * matching.
 *
 * @param metas — Most-recent-first array of v3 metas (length 2-N). Entries
 *                 without `key_state` are treated as having no key state.
 * @returns Per-value classification
 */
export declare function classifyKeyState(metas: ThreadMetaV3[]): ClassifiedKeyState[];
/**
 * Convenience: from an array of classified key state, return only the
 * entries to actively encourage carry-forward ("core" + still-relevant
 * "fresh"). Used by the steering builder when picking what to surface
 * as `previousKeyState` hints.
 */
export declare function pickContinuityKeyState(classified: ReadonlyArray<ClassifiedKeyState>): KeyStateEntry[];
export interface ClassifiedThreadWithIdentity extends ClassifiedThread {
    /** Identity match against the IMMEDIATELY previous compaction (if any). */
    identity?: IdentityMatch;
    /** When classification is 'merged', the previous IDs that folded into here. */
    mergedFrom?: string[];
    /** When classification is 'renamed', the previous label this came from. */
    renamedFrom?: string;
}
export interface IdentityClassifyOptions extends MatchOptions {
    /**
     * Identity-aware threshold for "core". Default same as classifyThreadsV2:
     * appears in ≥ ceil(N/2) compactions AND is in the most-recent.
     */
    coreThreshold?: number;
}
/**
 * Multi-tier-matched continuity classification across a window of v2 metas.
 *
 * Walks the window oldest-first, building a canonical ID timeline:
 *   - At each step, match the meta's threads against the previous step
 *     using identity.matchAllThreads.
 *   - Carry forward the canonical ID (oldest known ID for the chain).
 *   - When the matcher reports `merged`, attach mergedFrom on the canonical.
 *
 * Then collapse to a per-canonical record and apply the same core/fresh/
 * fading thresholds as classifyThreadsV2, with two extra rules:
 *   - If the most recent meta's thread renamed from an earlier label →
 *     classification = 'renamed' (instead of 'core' / 'fresh' — rename is
 *     more informative)
 *   - If the most recent meta's thread is the merge target of ≥2 previous
 *     canonicals → classification = 'merged'
 *
 * @param metas - Most-recent-first array of v2 metas.
 */
export declare function classifyThreadsWithIdentity(metas: ReadonlyArray<ThreadMetaV2>, options?: IdentityClassifyOptions): ClassifiedThreadWithIdentity[];
//# sourceMappingURL=weight.d.ts.map