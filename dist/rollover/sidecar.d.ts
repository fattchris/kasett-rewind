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
export declare function rolloverPathFor(sessionFile: string): string;
export declare function rolloverConsumedPathFor(sessionFile: string): string;
export declare function rolloverFailedPathFor(sessionFile: string): string;
export declare function rolloverStubInjectedPathFor(sessionFile: string): string;
/**
 * Record that the stub has been injected to a turn. Prevents re-injection
 * of the stub on subsequent turns if the user fires multiple turns before
 * the background worker has replaced the stub with a rich entry.
 */
export declare function markStubInjected(sessionFile: string): Promise<void>;
export declare function stubAlreadyInjected(sessionFile: string): boolean;
/**
 * Write the rollover sidecar atomically. Overwrites any existing sidecar.
 */
export declare function writeRolloverSidecar(sessionFile: string, entry: RolloverSidecarEntry): Promise<void>;
/**
 * Read the rollover sidecar if it exists. Returns null if missing or corrupt.
 */
export declare function readRolloverSidecar(sessionFile: string): Promise<RolloverSidecarEntry | null>;
/**
 * Mark the rollover sidecar as consumed by renaming it.
 * Idempotent: if the sidecar is already missing or consumed, this is a no-op.
 */
export declare function consumeRolloverSidecar(sessionFile: string): Promise<boolean>;
/**
 * Mark the rollover sidecar as permanently failed (worker crashed). Prevents
 * retry storms on every turn.
 */
export declare function markRolloverFailed(sessionFile: string, reason: string): Promise<void>;
/**
 * Has the cold-start branch already failed for this session? If so, skip
 * the retry path until a human (or a future heal step) clears the marker.
 */
export declare function rolloverHasFailed(sessionFile: string): boolean;
/**
 * Has the rollover already been consumed for this session? If so, skip
 * re-injection on subsequent turns.
 */
export declare function rolloverWasConsumed(sessionFile: string): boolean;
/**
 * Is there an active (not-yet-consumed) rollover sidecar for this session?
 */
export declare function rolloverPending(sessionFile: string): boolean;
/** mtime of an existing rollover sidecar, or null if missing. */
export declare function rolloverMtimeMs(sessionFile: string): Promise<number | null>;
//# sourceMappingURL=sidecar.d.ts.map