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
// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------
const VALID_STATUS = new Set([
    'active',
    'blocked',
    'completed',
    'fading',
]);
const VALID_SCHEMA = new Set(['v1', 'v2', 'v3']);
/**
 * Lightweight runtime validator — returns true when the value matches the
 * GlobalThreadRecord shape. We're lenient on read (skip bad lines without
 * crashing) but strict here for write-time defense.
 */
export function isValidGlobalThreadRecord(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    if (typeof r.ts !== 'string' || !r.ts)
        return false;
    if (typeof r.agent_id !== 'string' || !r.agent_id)
        return false;
    if (typeof r.session_id !== 'string' || !r.session_id)
        return false;
    if (typeof r.thread_id !== 'string' || !r.thread_id)
        return false;
    if (typeof r.label !== 'string')
        return false;
    if (typeof r.status !== 'string' || !VALID_STATUS.has(r.status))
        return false;
    if (typeof r.schema_version !== 'string' ||
        !VALID_SCHEMA.has(r.schema_version))
        return false;
    if (r.topic_name !== undefined && typeof r.topic_name !== 'string')
        return false;
    if (r.canonical_id !== undefined && typeof r.canonical_id !== 'string')
        return false;
    if (r.is_main !== undefined && typeof r.is_main !== 'boolean')
        return false;
    if (r.ts_first_seen !== undefined && typeof r.ts_first_seen !== 'string')
        return false;
    return true;
}
/**
 * Validator for GlobalThreadSnapshot. Used by readSnapshot to defend against
 * a corrupt or partial snapshot file.
 */
export function isValidGlobalThreadSnapshot(value) {
    if (!value || typeof value !== 'object')
        return false;
    const s = value;
    if (typeof s.ts !== 'string' || !s.ts)
        return false;
    if (!s.threads || typeof s.threads !== 'object')
        return false;
    // Don't deep-validate every thread summary here — the snapshot is
    // rebuildable from the index. If a single summary is malformed we'd
    // rather skip it than reject the whole snapshot.
    return true;
}
//# sourceMappingURL=types.js.map