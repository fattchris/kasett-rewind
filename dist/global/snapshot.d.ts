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
import { type GlobalThreadRecord, type GlobalThreadSnapshot } from './types.js';
export declare const GLOBAL_SNAPSHOT_FILENAME = ".kasett-global-threads.snapshot.json";
/**
 * Build the absolute path to the snapshot file.
 */
export declare function globalSnapshotPathFor(agentRoot: string): string;
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
export declare function buildSnapshot(agentRoot: string, options?: BuildOptions): GlobalThreadSnapshot;
/**
 * Atomically write the snapshot to disk.
 *
 * Uses a `.tmp` sibling, fsync, then rename. Readers always see a
 * consistent snapshot.
 */
export declare function writeSnapshot(agentRoot: string, snapshot: GlobalThreadSnapshot): void;
/**
 * Read the snapshot from disk, or null if absent / unreadable.
 *
 * Skips a corrupt snapshot rather than throwing — callers can rebuild
 * from the index.
 */
export declare function readSnapshot(agentRoot: string): GlobalThreadSnapshot | null;
/**
 * Convenience: rebuild + write the snapshot from the index in one call.
 * Returns the snapshot. Errors from the write step propagate via console
 * but never throw.
 */
export declare function refreshSnapshot(agentRoot: string, options?: BuildOptions): GlobalThreadSnapshot;
//# sourceMappingURL=snapshot.d.ts.map