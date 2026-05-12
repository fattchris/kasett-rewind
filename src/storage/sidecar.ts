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

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';

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
  /** Parsed thread meta — main thread + 3 subs */
  thread_meta?: {
    main: string;
    sub: [string, string, string];
  };
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
export function sidecarPathFor(sessionFile: string): string {
  return `${sessionFile}.kasett-meta.jsonl`;
}

/**
 * Append one entry to the session's sidecar. Creates the file (and parent
 * directory if needed) on first write.
 *
 * Uses `appendFileSync` with `O_APPEND` semantics for atomicity. Throws on
 * any I/O error so callers can decide how to handle the failure (the kasett
 * hot-swap worker logs and continues; tests assert the throw).
 */
export function writeSidecarEntry(sessionFile: string, entry: SidecarEntry): string {
  const sidecar = sidecarPathFor(sessionFile);
  const parentDir = dirname(sidecar);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(sidecar, line, { flag: 'a', encoding: 'utf-8' });
  return sidecar;
}

/**
 * Read all entries from a session's sidecar, oldest first.
 *
 * Returns an empty array if the sidecar doesn't exist (new session, never
 * compacted). Skips malformed lines silently — partial corruption shouldn't
 * lose the well-formed history.
 */
export function readSidecar(sessionFile: string): SidecarEntry[] {
  const sidecar = sidecarPathFor(sessionFile);
  if (!existsSync(sidecar)) return [];

  let raw: string;
  try {
    raw = readFileSync(sidecar, 'utf-8');
  } catch {
    return [];
  }

  const entries: SidecarEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SidecarEntry;
      // Light shape validation — we want to be lenient on read
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.summary_rich === 'string' &&
        typeof parsed.compaction_id === 'string'
      ) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines; don't crash on partial corruption
    }
  }
  return entries;
}

/**
 * Find the sidecar entry matching a particular compaction_id (or stub_id).
 *
 * Returns undefined if no entry matches.
 */
export function findEntryForCompaction(
  sessionFile: string,
  compactionId: string,
): SidecarEntry | undefined {
  const entries = readSidecar(sessionFile);
  return entries.find(
    (e) => e.compaction_id === compactionId || e.stub_id === compactionId,
  );
}

/**
 * Returns true if the sidecar file exists and is non-empty.
 * Cheap stat-only check — does not parse the file.
 */
export function sidecarExists(sessionFile: string): boolean {
  const sidecar = sidecarPathFor(sessionFile);
  if (!existsSync(sidecar)) return false;
  try {
    return statSync(sidecar).size > 0;
  } catch {
    return false;
  }
}
