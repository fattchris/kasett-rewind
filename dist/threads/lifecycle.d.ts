/**
 * Lifecycle event detection (Phase D).
 *
 * Given the matcher output (current → previous matches) and the two thread
 * sets, derive a list of LifecycleEvents that describe how threads evolved
 * between compaction N-1 and N:
 *
 *   - created   — present in `current` but no match in `previous`
 *   - completed — present in `previous`, missing from `current`, status
 *                 was active/blocked → assumed completed (we can't
 *                 distinguish from "abandoned" without more context)
 *   - blocked   — status transitioned to blocked
 *   - renamed   — matched but label changed (matcher.evolved=true)
 *   - merged    — multiple `previous` threads matched onto one `current`
 *   - split     — one `previous` thread matched by multiple `current`
 *                 (rare; happens when the matcher's lexical/semantic tier
 *                 picks the same predecessor for two new threads)
 *
 * ## Advisory only
 *
 * These are hints for the steering prompt and the daily report. We do NOT
 * fail flow when classification is uncertain — we omit the event. The
 * downstream consumers (steering.ts, daily-compaction-review.sh) treat
 * absence as "no signal" rather than "no change".
 *
 * ## Edge cases
 *
 *   - A thread with `status: 'completed'` in `previous` that's gone in
 *     `current` is NOT re-emitted as a `completed` event (it already was).
 *   - A thread with `status: 'fading'` going missing is treated as gone,
 *     not as a fresh `completed` event.
 *   - When the matcher reports `matched_to` for multiple `current` threads
 *     pointing at the SAME previous, that's a split. When multiple
 *     previous match into one current, that's a merge.
 */
import type { ThreadSubV2 } from './schema.js';
import type { IdentityMatch } from './identity.js';
export type LifecycleEvent = {
    kind: 'created';
    thread_id: string;
    label: string;
} | {
    kind: 'completed';
    thread_id: string;
    label: string;
} | {
    kind: 'blocked';
    thread_id: string;
    label: string;
} | {
    kind: 'renamed';
    from_id: string;
    to_id: string;
    from_label: string;
    to_label: string;
    strategy: IdentityMatch['strategy'];
    confidence: number;
} | {
    kind: 'merged';
    from_ids: string[];
    into_id: string;
} | {
    kind: 'split';
    from_id: string;
    into_ids: string[];
};
/**
 * Detect lifecycle events between two compactions.
 *
 * @param previous — sub-threads from compaction N-1 (most recent before)
 * @param current  — sub-threads from compaction N
 * @param matches  — Map keyed by current.id → IdentityMatch (from
 *                   identity.matchAllThreads)
 */
export declare function detectLifecycleEvents(previous: ReadonlyArray<ThreadSubV2>, current: ReadonlyArray<ThreadSubV2>, matches: ReadonlyMap<string, IdentityMatch>): LifecycleEvent[];
/**
 * Tally lifecycle events into per-kind counts. Used by the identity report
 * and the daily review.
 */
export declare function summarizeLifecycle(events: ReadonlyArray<LifecycleEvent>): Record<LifecycleEvent['kind'], number>;
//# sourceMappingURL=lifecycle.d.ts.map