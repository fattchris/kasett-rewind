/**
 * Cross-session snapshot builder (Phase E).
 *
 * Reads the append-only global index and produces a per-canonical-thread
 * aggregate (`GlobalThreadSnapshot`). Stored alongside the index file as
 * `.kasett-global-threads.snapshot.json` and atomically replaced on update.
 *
 * ## Idempotent
 *
 * The snapshot is purely a projection of the index. It can be deleted and
 * rebuilt at any time — there is no state in the snapshot that isn't also
 * in the index.
 *
 * ## Atomicity
 *
 * Writes to `<path>.tmp`, fsync, then `rename` over the live file. POSIX
 * `rename` is atomic — readers see either the old snapshot or the new,
 * never a torn write.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  isValidGlobalThreadSnapshot,
  type GlobalThreadRecord,
  type GlobalThreadSnapshot,
  type GlobalThreadSummary,
} from './types.js';
import {
  GLOBAL_INDEX_FILENAME,
  globalIndexPathFor,
  readGlobalRecords,
} from './index-writer.js';
import { findCanonicalThread } from './matcher.js';

export const GLOBAL_SNAPSHOT_FILENAME = '.kasett-global-threads.snapshot.json';

/**
 * Build the absolute path to the snapshot file.
 */
export function globalSnapshotPathFor(agentRoot: string): string {
  // Mirror the index-writer's "is this a sessions dir?" detection.
  const idxPath = globalIndexPathFor(agentRoot);
  return idxPath.replace(/[^/]+$/, GLOBAL_SNAPSHOT_FILENAME);
}

export interface BuildOptions {
  /** Only include records with `ts >= now - sinceMs`. */
  sinceMs?: number;
  /**
   * Pre-loaded records. When supplied, the file system is not read.
   * Useful for tests and for callers that already have the records in
   * memory.
   */
  records?: ReadonlyArray<GlobalThreadRecord>;
}

/**
 * Build a snapshot from the index. Records are grouped by canonical_id;
 * within each group the most recent observation wins for `label` and
 * `status` and `last_compaction`.
 *
 * Per-session subgroups track the per-session contribution (first/last
 * seen in that session, label used, compaction count). This is what makes
 * the "Claudia deploy was active in topic-X 2 days ago" rendering possible.
 *
 * Records that arrive without a `canonical_id` get one assigned at build
 * time using the cross-session matcher — consistent with what the worker
 * does at write time, but defensive in case migration left holes.
 */
export function buildSnapshot(
  agentRoot: string,
  options: BuildOptions = {},
): GlobalThreadSnapshot {
  const records =
    options.records ?? readGlobalRecords(agentRoot, { sinceMs: options.sinceMs });

  // Process oldest-first so canonical_id resolution mirrors the worker's
  // append-time behavior.
  const sorted = [...records].sort((a, b) =>
    (a.ts || '').localeCompare(b.ts || ''),
  );

  const threads = new Map<string, GlobalThreadSummary>();
  // Index of resolved canonicals for matcher seeding — mirrors the index
  // we'd use at write time, but built from the records we've already seen.
  const seenForMatcher: GlobalThreadRecord[] = [];

  for (const r of sorted) {
    let canonical = r.canonical_id;
    if (!canonical) {
      // Re-resolve at projection time (defensive; the worker should have
      // assigned this at write time).
      const m = findCanonicalThread(
        { thread_id: r.thread_id, label: r.label },
        seenForMatcher,
      );
      canonical = m.canonical_id ?? r.thread_id;
    }

    let summary = threads.get(canonical);
    if (!summary) {
      summary = {
        canonical_id: canonical,
        label: r.label,
        status: r.status,
        sessions: [],
        aliases: [],
        total_observations: 0,
        last_compaction: r.ts,
      };
      threads.set(canonical, summary);
    }

    // Most-recent-wins for label/status. We process oldest-first so the
    // last write for any field is the most recent observation.
    summary.label = r.label;
    summary.status = r.status;
    summary.last_compaction = r.ts;
    summary.total_observations += 1;
    if (!summary.aliases.includes(r.thread_id)) {
      summary.aliases.push(r.thread_id);
    }

    // Per-session contribution.
    let sessionEntry = summary.sessions.find(
      (s) => s.session_id === r.session_id,
    );
    if (!sessionEntry) {
      sessionEntry = {
        session_id: r.session_id,
        topic_name: r.topic_name,
        first_seen: r.ts,
        last_seen: r.ts,
        label_used: r.label,
        compaction_count: 1,
      };
      summary.sessions.push(sessionEntry);
    } else {
      sessionEntry.last_seen = r.ts;
      sessionEntry.label_used = r.label;
      sessionEntry.compaction_count += 1;
      if (r.topic_name && !sessionEntry.topic_name) {
        sessionEntry.topic_name = r.topic_name;
      }
    }

    // Carry the canonical decision forward by mirroring it into the
    // record we hand to the matcher's seed list. This way subsequent
    // records that want exact-id continuity can find the canonical.
    seenForMatcher.push({ ...r, canonical_id: canonical });
  }

  return {
    ts: new Date().toISOString(),
    threads: Object.fromEntries(threads),
  };
}

/**
 * Atomically write the snapshot to disk.
 *
 * Uses a `.tmp` sibling, fsync, then rename. Readers always see a
 * consistent snapshot.
 */
export function writeSnapshot(
  agentRoot: string,
  snapshot: GlobalThreadSnapshot,
): void {
  const path = globalSnapshotPathFor(agentRoot);
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  const tmp = path + '.tmp';
  // Use openSync + writeSync + fsyncSync + closeSync so we can fsync the
  // tmp file before renaming. writeFileSync alone does not fsync.
  const data = JSON.stringify(snapshot);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    try {
      fsyncSync(fd);
    } catch {
      // Best-effort fsync; some filesystems report ENOSYS. Continue with rename.
    }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Read the snapshot from disk, or null if absent / unreadable.
 *
 * Skips a corrupt snapshot rather than throwing — callers can rebuild
 * from the index.
 */
export function readSnapshot(agentRoot: string): GlobalThreadSnapshot | null {
  const path = globalSnapshotPathFor(agentRoot);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (isValidGlobalThreadSnapshot(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Convenience: rebuild + write the snapshot from the index in one call.
 * Returns the snapshot. Errors from the write step propagate via console
 * but never throw.
 */
export function refreshSnapshot(
  agentRoot: string,
  options: BuildOptions = {},
): GlobalThreadSnapshot {
  const snapshot = buildSnapshot(agentRoot, options);
  try {
    writeSnapshot(agentRoot, snapshot);
  } catch {
    // Snapshot is rebuildable; refusing to throw here keeps the worker
    // pipeline tolerant of disk-full / permission errors.
  }
  return snapshot;
}

// Suppress unused-variable warning for join (kept for future relative-path
// resolution).
void join;
// Suppress unused-variable for writeFileSync (kept for tests that call it
// directly via this module's exports).
void writeFileSync;
