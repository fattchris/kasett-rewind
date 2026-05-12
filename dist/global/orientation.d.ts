/**
 * Cross-session orientation (Phase E).
 *
 * Surfaces threads from OTHER sessions that the agent might want to know
 * about when reorienting in the current session. Used by the V3 steering
 * orientation builder so a fresh session can mention "the kasett deploy
 * is still active in topic-20751" even though we're not in that topic.
 */
import type { ThreadStatus } from '../threads/schema.js';
import { buildSnapshot } from './snapshot.js';
export interface CrossSessionContext {
    active_other_sessions: Array<{
        canonical_id: string;
        label: string;
        last_session: string;
        last_topic_name?: string;
        last_seen: string;
        status: ThreadStatus;
    }>;
}
export interface CrossSessionOptions {
    /** Maximum number of threads to return. Default 5. */
    topThreads?: number;
    /**
     * Include only threads with these statuses. Default ['active', 'blocked'].
     */
    statuses?: ReadonlyArray<ThreadStatus>;
    /**
     * Look back this many ms when reading records. Default 7 days. Threads
     * that haven't been touched in a week are noisy in orientation.
     */
    sinceMs?: number;
    /**
     * If true, rebuild the snapshot fresh rather than relying on a cached
     * file. Defaults to false — the worker refreshes the snapshot when it
     * appends, so reads are typically cheap.
     */
    forceRebuild?: boolean;
    /**
     * Pre-loaded snapshot. Overrides the file-system read. Used by tests and
     * by callers that already built the snapshot in this process.
     */
    snapshot?: ReturnType<typeof buildSnapshot>;
}
/**
 * Compute cross-session orientation context for `currentSessionId`.
 *
 * Returns a list of canonical threads whose most recent observation was in
 * a session OTHER than the current one, sorted by recency, capped to
 * `topThreads`.
 */
export declare function getCrossSessionContext(agentRoot: string, currentSessionId: string, options?: CrossSessionOptions): CrossSessionContext;
/**
 * Convenience: same as `getCrossSessionContext` but reads records directly
 * (skipping the snapshot). Used when the snapshot file isn't trusted (e.g.
 * during a one-shot CLI run).
 */
export declare function getCrossSessionContextFromRecords(agentRoot: string, currentSessionId: string, options?: CrossSessionOptions): CrossSessionContext;
//# sourceMappingURL=orientation.d.ts.map