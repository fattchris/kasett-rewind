/**
 * rollover/sidecar.ts — Read/write/consume the cold-start rollover sidecar.
 *
 * The rollover sidecar is a single-entry JSON file that holds the orientation
 * payload generated for a brand-new session that inherited nothing from its
 * prior sibling. It is read once by `before_prompt_build` and then renamed to
 * `.consumed` so subsequent turns don't re-inject the same context.
 *
 * Path: `<sessionFile>.rollover.json`
 * Consumed path: `<sessionFile>.rollover.consumed.json`
 *
 * Atomicity:
 *   - Writes: temp file + atomic rename (POSIX rename is atomic on same fs).
 *   - Reads: best-effort; corrupt or missing → returns null.
 *   - Consume: atomic rename `.rollover.json` → `.rollover.consumed.json`.
 *
 * No locks. Only the rollover worker writes the file; only
 * `before_prompt_build` consumes it. Concurrent agents on the SAME sessionKey
 * are not a thing in OC — one session, one writer.
 */

import { writeFile, rename, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ThreadMeta } from '../types.js';

export interface RolloverSidecarEntry {
  /** Schema version for forward-compat */
  schemaVersion: 1;
  /** The sibling session file the rollover was sourced from */
  sourceSessionFile: string;
  /** mtime of the sibling at sidecar creation (epoch ms) */
  sourceSessionMtimeMs: number;
  /** When this sidecar was written (epoch ms) */
  generatedAtMs: number;
  /** How many turns from the sibling were summarized */
  turnsConsumed: number;
  /** Parsed THREAD_META v1, if extractable from the summary */
  threadMeta: ThreadMeta | null;
  /** Full markdown summary (rich) */
  summary: string;
  /**
   * True if this entry is a synchronous stub (no LLM call yet). The full
   * version will overwrite this file once the background worker finishes.
   */
  stub: boolean;
  /** Optional reason string when stub=true */
  stubReason?: string;
}

const ROLLOVER_SUFFIX = '.rollover.json';
const CONSUMED_SUFFIX = '.rollover.consumed.json';
const FAILED_SUFFIX = '.rollover.failed.json';
const STUB_INJECTED_SUFFIX = '.rollover.stub-injected';

export function rolloverPathFor(sessionFile: string): string {
  return `${sessionFile}${ROLLOVER_SUFFIX}`;
}

export function rolloverConsumedPathFor(sessionFile: string): string {
  return `${sessionFile}${CONSUMED_SUFFIX}`;
}

export function rolloverFailedPathFor(sessionFile: string): string {
  return `${sessionFile}${FAILED_SUFFIX}`;
}

export function rolloverStubInjectedPathFor(sessionFile: string): string {
  return `${sessionFile}${STUB_INJECTED_SUFFIX}`;
}

/**
 * Record that the stub has been injected to a turn. Prevents re-injection
 * of the stub on subsequent turns if the user fires multiple turns before
 * the background worker has replaced the stub with a rich entry.
 */
export async function markStubInjected(sessionFile: string): Promise<void> {
  await writeFile(
    rolloverStubInjectedPathFor(sessionFile),
    String(Date.now()),
    { encoding: 'utf-8', mode: 0o600 },
  );
}

export function stubAlreadyInjected(sessionFile: string): boolean {
  return existsSync(rolloverStubInjectedPathFor(sessionFile));
}

/**
 * Write the rollover sidecar atomically. Overwrites any existing sidecar.
 */
export async function writeRolloverSidecar(
  sessionFile: string,
  entry: RolloverSidecarEntry,
): Promise<void> {
  const finalPath = rolloverPathFor(sessionFile);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(entry, null, 2);
  await writeFile(tmpPath, body, { encoding: 'utf-8', mode: 0o600 });
  await rename(tmpPath, finalPath);
}

/**
 * Read the rollover sidecar if it exists. Returns null if missing or corrupt.
 */
export async function readRolloverSidecar(
  sessionFile: string,
): Promise<RolloverSidecarEntry | null> {
  const path = rolloverPathFor(sessionFile);
  if (!existsSync(path)) return null;
  try {
    const body = await readFile(path, { encoding: 'utf-8' });
    const parsed = JSON.parse(body);
    if (!isValidEntry(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Mark the rollover sidecar as consumed by renaming it.
 * Idempotent: if the sidecar is already missing or consumed, this is a no-op.
 */
export async function consumeRolloverSidecar(sessionFile: string): Promise<boolean> {
  const path = rolloverPathFor(sessionFile);
  const consumedPath = rolloverConsumedPathFor(sessionFile);
  if (!existsSync(path)) return false;
  try {
    await rename(path, consumedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark the rollover sidecar as permanently failed (worker crashed). Prevents
 * retry storms on every turn.
 */
export async function markRolloverFailed(
  sessionFile: string,
  reason: string,
): Promise<void> {
  const failedPath = rolloverFailedPathFor(sessionFile);
  const body = JSON.stringify(
    { schemaVersion: 1, reason, failedAtMs: Date.now() },
    null,
    2,
  );
  await writeFile(failedPath, body, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Has the cold-start branch already failed for this session? If so, skip
 * the retry path until a human (or a future heal step) clears the marker.
 */
export function rolloverHasFailed(sessionFile: string): boolean {
  return existsSync(rolloverFailedPathFor(sessionFile));
}

/**
 * Has the rollover already been consumed for this session? If so, skip
 * re-injection on subsequent turns.
 */
export function rolloverWasConsumed(sessionFile: string): boolean {
  return existsSync(rolloverConsumedPathFor(sessionFile));
}

/**
 * Is there an active (not-yet-consumed) rollover sidecar for this session?
 */
export function rolloverPending(sessionFile: string): boolean {
  return existsSync(rolloverPathFor(sessionFile));
}

/** mtime of an existing rollover sidecar, or null if missing. */
export async function rolloverMtimeMs(sessionFile: string): Promise<number | null> {
  const path = rolloverPathFor(sessionFile);
  try {
    const s = await stat(path);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

function isValidEntry(obj: unknown): obj is RolloverSidecarEntry {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.schemaVersion === 1 &&
    typeof o.sourceSessionFile === 'string' &&
    typeof o.sourceSessionMtimeMs === 'number' &&
    typeof o.generatedAtMs === 'number' &&
    typeof o.turnsConsumed === 'number' &&
    typeof o.summary === 'string' &&
    typeof o.stub === 'boolean'
  );
}
