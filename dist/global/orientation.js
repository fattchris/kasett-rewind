/**
 * Cross-session orientation (Phase E).
 *
 * Surfaces threads from OTHER sessions that the agent might want to know
 * about when reorienting in the current session. Used by the V3 steering
 * orientation builder so a fresh session can mention "the kasett deploy
 * is still active in topic-20751" even though we're not in that topic.
 */
import { readGlobalRecords } from './index-writer.js';
import { buildSnapshot, readSnapshot, refreshSnapshot } from './snapshot.js';
const DEFAULT_TOP = 5;
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STATUSES = ['active', 'blocked'];
/**
 * Compute cross-session orientation context for `currentSessionId`.
 *
 * Returns a list of canonical threads whose most recent observation was in
 * a session OTHER than the current one, sorted by recency, capped to
 * `topThreads`.
 */
export function getCrossSessionContext(agentRoot, currentSessionId, options = {}) {
    const top = options.topThreads ?? DEFAULT_TOP;
    const statuses = new Set(options.statuses ?? DEFAULT_STATUSES);
    const sinceMs = options.sinceMs ?? DEFAULT_LOOKBACK_MS;
    let snapshot = options.snapshot;
    if (!snapshot) {
        if (options.forceRebuild) {
            snapshot = refreshSnapshot(agentRoot, { sinceMs });
        }
        else {
            snapshot = readSnapshot(agentRoot) ?? buildSnapshot(agentRoot, { sinceMs });
        }
    }
    const cutoff = Date.now() - sinceMs;
    const candidates = [];
    for (const summary of Object.values(snapshot.threads)) {
        if (!statuses.has(summary.status))
            continue;
        // Find this thread's most recent observation in a session OTHER than
        // the current one.
        const otherSessions = summary.sessions
            .filter((s) => s.session_id !== currentSessionId)
            .sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
        if (otherSessions.length === 0)
            continue;
        const latest = otherSessions[0];
        const latestMs = Date.parse(latest.last_seen);
        if (Number.isNaN(latestMs) || latestMs < cutoff)
            continue;
        candidates.push({
            canonical_id: summary.canonical_id,
            label: summary.label,
            last_session: latest.session_id,
            last_topic_name: latest.topic_name,
            last_seen: latest.last_seen,
            status: summary.status,
        });
    }
    candidates.sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
    return { active_other_sessions: candidates.slice(0, top) };
}
/**
 * Convenience: same as `getCrossSessionContext` but reads records directly
 * (skipping the snapshot). Used when the snapshot file isn't trusted (e.g.
 * during a one-shot CLI run).
 */
export function getCrossSessionContextFromRecords(agentRoot, currentSessionId, options = {}) {
    const sinceMs = options.sinceMs ?? DEFAULT_LOOKBACK_MS;
    const records = readGlobalRecords(agentRoot, { sinceMs });
    const snapshot = buildSnapshot(agentRoot, { records, sinceMs });
    return getCrossSessionContext(agentRoot, currentSessionId, {
        ...options,
        snapshot,
    });
}
//# sourceMappingURL=orientation.js.map