/**
 * sidecar.ts — Append-only sidecar store for kasett's rich compaction meta.
 *
 * ## Why a sidecar
 *
 * OC owns the session JSONL and holds an exclusive write lock on it whenever
 * the user is active. The previous hot-swap design tried to rewrite that JSONL
 * after the LLM produced a rich summary; in production, the lock never cleared
 * within the 30s wait window for active sessions, so 0% of stubs were ever
 * replaced (Phase A finding, 2026-05-12).
 *
 * The sidecar lives next to the session file and is written by kasett ONLY:
 *
 *     /…/sessions/<session>.jsonl              ← OC's territory
 *     /…/sessions/<session>.jsonl.kasett-meta.jsonl  ← kasett's territory
 *
 * One JSON object per line. Append-only — we never rewrite the file. POSIX
 * `O_APPEND` makes single appends atomic against concurrent writers, and we
 * have no concurrent writers in any case.
 *
 * ## Read order
 *
 * The session reader (storage/reader.ts) reads sidecar entries first. Legacy
 * sessions that have rich meta inline in the OC JSONL `summary` field still
 * work via fallback scanning of the JSONL.
 */
import type { KeyStateEntry, ThreadMetaV2, ThreadMetaV3 } from '../threads/schema.js';
import type { LifecycleEvent } from '../threads/lifecycle.js';
/**
 * Schema for one sidecar entry. Stable v1 schema. Additive changes only.
 *
 * Versioning strategy: when we need to break, add a `v` field to new entries
 * and have the reader switch on it. Today there's no `v` field — readers
 * treat absence as v1.
 */
export interface SidecarEntry {
    /** ISO-8601 timestamp (UTC) of when the entry was written */
    ts: string;
    /** Basename of the session file without the `.jsonl` suffix (for cross-reference) */
    session_id: string;
    /**
     * Stable identifier for this compaction event.
     * In practice: the stub UUID generated at compaction start.
     * For migrated/legacy entries: SHA-1 hash of the stub summary text.
     */
    compaction_id: string;
    /**
     * The kasett stub UUID, when known. For migrated entries this may be the
     * same as compaction_id; for legacy non-stub-tagged entries this is omitted.
     */
    stub_id?: string;
    /** Full LLM-produced compaction summary (the "rich" content the JSONL never received) */
    summary_rich: string;
    /** Parsed v1 thread meta — main thread + 3 subs. Always populated when the
     * worker successfully parsed the LLM output, either directly (v1 mode) or
     * via projection (v2 mode). Kept for backward compat with v1 readers. */
    thread_meta?: {
        main: string;
        sub: [string, string, string];
    };
    /**
     * Parsed v2 thread meta — full structured object with sub-thread `id`,
     * `status`, decisions, and open_questions. Only set when the LLM output
     * conformed to the v2 JSON schema. New writes after Phase B2 always
     * attempt v2 first; absence of this field signals a v1 fallback or a
     * legacy entry written before B2.
     */
    thread_meta_v2?: ThreadMetaV2;
    /**
     * Parsed v3 thread meta — v2 + optional `key_state[]`. Only set when the
     * LLM output conformed to the v3 JSON schema (Phase C+). Absence of this
     * field signals a v2 entry (no key_state) or a v1 fallback.
     */
    thread_meta_v3?: ThreadMetaV3;
    /**
     * Detected candidate key state from the pre-compaction conversation. Stored
     * for KSSR (Key State Survival Rate) measurement: KSSR = preserved /
     * detected. The LLM-emitted `thread_meta_v3.key_state` is the "preserved"
     * set; this is the "detected" set the LLM was asked to consider.
     */
    key_state_candidates?: KeyStateEntry[];
    /**
     * Schema version that produced this entry. Defaults to v1 when absent for
     * backward compat. Phase B2 added v2; Phase C added v3.
     */
    schema_version?: 'v1' | 'v2' | 'v3';
    /**
     * Lifecycle events detected between this compaction and the one before it
     * (Phase D). Computed at write time using the previous compaction's
     * thread_meta_v2/v3. Advisory only — used by the steering prompt and the
     * daily review report. Backward compat: optional field; older entries
     * never carried it.
     */
    lifecycle_events?: LifecycleEvent[];
    /** Model identifier used for the LLM call (for debugging / drift analysis) */
    model?: string;
    /** Character count of summary_rich (denormalized for cheap scanning) */
    summary_chars?: number;
    /** Optional free-form debug fields. Never read by production code. */
    debug?: Record<string, unknown>;
}
/**
 * Resolve the sidecar path for a given session JSONL path.
 *
 * Convention: append `.kasett-meta.jsonl` to the full session filename.
 * This makes it trivial to discover sidecars (`*.kasett-meta.jsonl`) and
 * ensures unambiguous association with the source file.
 */
export declare function sidecarPathFor(sessionFile: string): string;
/**
 * Append one entry to the session's sidecar. Creates the file (and parent
 * directory if needed) on first write.
 *
 * Uses `appendFileSync` with `O_APPEND` semantics for atomicity. Throws on
 * any I/O error so callers can decide how to handle the failure (the kasett
 * hot-swap worker logs and continues; tests assert the throw).
 */
export declare function writeSidecarEntry(sessionFile: string, entry: SidecarEntry): string;
/**
 * Read all entries from a session's sidecar, oldest first.
 *
 * Returns an empty array if the sidecar doesn't exist (new session, never
 * compacted). Skips malformed lines silently — partial corruption shouldn't
 * lose the well-formed history.
 */
export declare function readSidecar(sessionFile: string): SidecarEntry[];
/**
 * Find the sidecar entry matching a particular compaction_id (or stub_id).
 *
 * Returns undefined if no entry matches.
 */
export declare function findEntryForCompaction(sessionFile: string, compactionId: string): SidecarEntry | undefined;
/**
 * Returns true if the sidecar file exists and is non-empty.
 * Cheap stat-only check — does not parse the file.
 */
export declare function sidecarExists(sessionFile: string): boolean;
/**
 * Resolve a session-key OR a session-file path to the actual session JSONL
 * path on disk. (Phase F bug fix.)
 *
 * Background: OC's compaction hook gives kasett the session-key
 * (`agent:main:telegram:group:-1003723465246:topic:12388`) but the worker
 * historically used it as a filesystem path — producing a sidecar at
 * `<session-key>.jsonl.kasett-meta.jsonl` instead of next to the real
 * `<uuid>-topic-N.jsonl` file. Daily review and the global index then
 * couldn't find the sidecar.
 *
 * Resolution order:
 *   1. If `sessionKeyOrPath` is already an absolute path that ends in
 *      `.jsonl` and exists — return it as-is.
 *   2. If it looks like a session-key (no path separator, no `.jsonl`),
 *      look it up in `<agentRoot>/sessions/sessions.json` and use the
 *      `sessionFile` field if present.
 *   3. As a fallback, scan `<agentRoot>/sessions/` for files matching
 *      `*-topic-<topicId>.jsonl` (where topicId is parsed from the key)
 *      and pick the most recently modified one.
 *   4. Return null if none of the strategies resolve.
 *
 * `agentRoot` is the per-agent directory (e.g. `~/.openclaw/agents/main`),
 * NOT the parent stateDir. Caller is responsible for joining stateDir +
 * 'agents/' + agentId.
 */
export declare function resolveSessionFilePath(agentRoot: string, sessionKeyOrPath: string): string | null;
//# sourceMappingURL=sidecar.d.ts.map