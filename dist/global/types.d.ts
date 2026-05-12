/**
 * Cross-session thread index types (Phase E).
 *
 * The global index tracks sub-thread observations across all sessions for
 * an agent. A thread observed in topic-A on Monday and in DM on Tuesday
 * gets a single canonical_id so reorientation works across session
 * boundaries.
 *
 * ## Files
 *
 *   ~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.jsonl
 *     Append-only log. One GlobalThreadRecord per line. Atomic via O_APPEND.
 *
 *   ~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.snapshot.json
 *     Derived snapshot. Atomically replaced (write-tmp + rename).
 *
 * ## Schema versioning
 *
 * `schema_version` distinguishes the SOURCE compaction's parser version
 * (v1/v2/v3). The global index itself is currently a single shape; if we
 * ever break it, add a top-level `record_version` field with absence
 * meaning v1, and have readers branch on it.
 */
import type { ThreadStatus } from '../threads/schema.js';
/**
 * One observation of a sub-thread in a particular session.
 *
 * Append-only — once written, never modified. Multiple records for the
 * same canonical_id across compactions and sessions form the thread's
 * cross-session history.
 */
export interface GlobalThreadRecord {
    /** ISO-8601 timestamp (UTC) of when this observation was recorded. */
    ts: string;
    /** Agent identifier — e.g. "main", "alpha", "beta". */
    agent_id: string;
    /** Basename of the session JSONL file (without `.jsonl` suffix). */
    session_id: string;
    /** Optional human-readable session/topic name (e.g. "topic-20751" or "kasett-dm"). */
    topic_name?: string;
    /**
     * The thread's id in THIS observation. May be the LLM-supplied stable id
     * or a matcher-resolved id from within-session continuity.
     */
    thread_id: string;
    /**
     * Cross-session canonical identifier. Resolved at write time by the
     * cross-session matcher. When this is the first observation of a thread
     * across all sessions, canonical_id === thread_id.
     *
     * Optional (absent in records written before canonical resolution was
     * available). Readers should fall back to `thread_id` when missing.
     */
    canonical_id?: string;
    /** Sub-thread label (most recent observation for this thread). */
    label: string;
    /** Lifecycle status from the v2/v3 schema. */
    status: ThreadStatus;
    /** Source compaction's schema version. */
    schema_version: 'v1' | 'v2' | 'v3';
    /**
     * True when this record represents the MAIN thread of its compaction
     * (the v2 `main` field, lifted into the cross-session index as a
     * synthetic sub-thread). False/undefined for ordinary sub-threads.
     */
    is_main?: boolean;
    /**
     * First observation timestamp for the canonical thread across all
     * sessions, when known at write time. Useful for "how long has this
     * been alive" queries without rewalking the entire index.
     */
    ts_first_seen?: string;
}
/**
 * Per-canonical-thread aggregate built from records.
 */
export interface GlobalThreadSummary {
    canonical_id: string;
    /** Most recent label observed for this thread. */
    label: string;
    /** Most recent status observed for this thread. */
    status: ThreadStatus;
    /** Sessions this thread has touched. */
    sessions: Array<{
        session_id: string;
        topic_name?: string;
        /** First observation in this session. */
        first_seen: string;
        /** Most recent observation in this session. */
        last_seen: string;
        /** Label most recently used in this session (may differ from canonical label). */
        label_used: string;
        /** Number of compactions in this session that referenced this thread. */
        compaction_count: number;
    }>;
    /** Every observed thread_id that resolved to this canonical_id. */
    aliases: string[];
    /** Total number of records (all sessions, all compactions). */
    total_observations: number;
    /** Most recent compaction timestamp across all sessions. */
    last_compaction: string;
}
/**
 * The full global snapshot — an atomic projection of the index file at
 * a point in time. Rebuilt periodically (or lazily on read).
 */
export interface GlobalThreadSnapshot {
    /** ISO-8601 timestamp the snapshot was built. */
    ts: string;
    /** Map keyed by canonical_id. */
    threads: Record<string, GlobalThreadSummary>;
}
/**
 * Lightweight runtime validator — returns true when the value matches the
 * GlobalThreadRecord shape. We're lenient on read (skip bad lines without
 * crashing) but strict here for write-time defense.
 */
export declare function isValidGlobalThreadRecord(value: unknown): value is GlobalThreadRecord;
/**
 * Validator for GlobalThreadSnapshot. Used by readSnapshot to defend against
 * a corrupt or partial snapshot file.
 */
export declare function isValidGlobalThreadSnapshot(value: unknown): value is GlobalThreadSnapshot;
//# sourceMappingURL=types.d.ts.map