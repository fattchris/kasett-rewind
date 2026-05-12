/**
 * Cross-session orientation (Phase E).
 *
 * Surfaces threads from OTHER sessions that the agent might want to know
 * about when reorienting in the current session. Used by the V3 steering
 * orientation builder so a fresh session can mention "the kasett deploy
 * is still active in topic-20751" even though we're not in that topic.
 */

import type { ThreadStatus } from '../threads/schema.js';
import type { GlobalThreadSummary } from './types.js';
import { readGlobalRecords } from './index-writer.js';
import { buildSnapshot, readSnapshot, refreshSnapshot } from './snapshot.js';

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

const DEFAULT_TOP = 5;
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STATUSES: ReadonlyArray<ThreadStatus> = ['active', 'blocked'];

/**
 * Compute cross-session orientation context for `currentSessionId`.
 *
 * Returns a list of canonical threads whose most recent observation was in
 * a session OTHER than the current one, sorted by recency, capped to
 * `topThreads`.
 */
export function getCrossSessionContext(
  agentRoot: string,
  currentSessionId: string,
  options: CrossSessionOptions = {},
): CrossSessionContext {
  const top = options.topThreads ?? DEFAULT_TOP;
  const statuses = new Set<ThreadStatus>(options.statuses ?? DEFAULT_STATUSES);
  const sinceMs = options.sinceMs ?? DEFAULT_LOOKBACK_MS;

  let snapshot = options.snapshot;
  if (!snapshot) {
    if (options.forceRebuild) {
      snapshot = refreshSnapshot(agentRoot, { sinceMs });
    } else {
      snapshot = readSnapshot(agentRoot) ?? buildSnapshot(agentRoot, { sinceMs });
    }
  }

  const cutoff = Date.now() - sinceMs;
  const candidates: Array<CrossSessionContext['active_other_sessions'][number]> = [];

  for (const summary of Object.values(snapshot.threads) as GlobalThreadSummary[]) {
    if (!statuses.has(summary.status)) continue;

    // Find this thread's most recent observation in a session OTHER than
    // the current one.
    const otherSessions = summary.sessions
      .filter((s) => s.session_id !== currentSessionId)
      .sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
    if (otherSessions.length === 0) continue;

    const latest = otherSessions[0];
    const latestMs = Date.parse(latest.last_seen);
    if (Number.isNaN(latestMs) || latestMs < cutoff) continue;

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
export function getCrossSessionContextFromRecords(
  agentRoot: string,
  currentSessionId: string,
  options: CrossSessionOptions = {},
): CrossSessionContext {
  const sinceMs = options.sinceMs ?? DEFAULT_LOOKBACK_MS;
  const records = readGlobalRecords(agentRoot, { sinceMs });
  const snapshot = buildSnapshot(agentRoot, { records, sinceMs });
  return getCrossSessionContext(agentRoot, currentSessionId, {
    ...options,
    snapshot,
  });
}
