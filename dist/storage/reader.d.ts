import type { CompactionEvent, ThreadMeta } from '../types.js';
/**
 * Error class for kasett-rewind operations.
 */
export declare class KasettError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Reads session JSONL files (and the kasett sidecar) and extracts compaction
 * events with thread meta. Uses streaming for memory efficiency on large
 * session files.
 *
 * ## Storage layout
 *
 * As of Phase B1 (2026-05-12), kasett stores rich compaction summaries in a
 * sidecar file alongside the OC session JSONL:
 *
 *     <session>.jsonl                    ← OC stub stays here
 *     <session>.jsonl.kasett-meta.jsonl  ← rich kasett meta lives here
 *
 * Reads prefer the sidecar. Legacy sessions that have rich `[THREAD_META]`
 * inline in the OC JSONL `summary` field still work via fallback scanning.
 *
 * ## JSONL field path
 *
 * Real OC compaction events store the summary at TOP-LEVEL `summary`, not
 * `data.summary` (Phase A audit, 2026-05-12). The reader supports both:
 * top-level first, falling back to `data.summary` for legacy fixtures.
 */
export declare class SessionReader {
    /**
     * Read all compaction events from a session JSONL file.
     * Returns events in chronological order (oldest first).
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @returns Array of CompactionEvent objects
     * @throws KasettError if file cannot be read
     */
    readCompactionEvents(filePath: string): Promise<CompactionEvent[]>;
    /**
     * Read the last N compaction events that have thread meta.
     *
     * Sidecar-first: if a sidecar exists, prefer its entries (most-recent-last)
     * and fall back to JSONL-derived events for older slots.
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @param count - Maximum number of events to return
     * @returns The last N CompactionEvent objects with thread meta (oldest first)
     */
    readLastNWithMeta(filePath: string, count: number): Promise<CompactionEvent[]>;
    /**
     * Read the most recent thread meta from the session.
     * Sidecar-first; falls back to JSONL.
     */
    readLatestMeta(filePath: string): Promise<ThreadMeta | null>;
    /**
     * Read the most recent compaction summary string.
     * Sidecar-first; if a rich summary is in the sidecar, return that. Otherwise
     * fall back to the most recent OC JSONL summary (which may be a stub).
     */
    readLatestSummary(filePath: string): Promise<string | null>;
    /**
     * Read the last N compaction summary strings, oldest first.
     *
     * Sidecar-first per slot: for each compaction position we prefer the
     * sidecar's rich summary over the JSONL stub.
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @param count - Maximum number of summaries to return
     * @returns The last N summary strings, oldest first
     */
    readLastNSummaries(filePath: string, count: number): Promise<string[]>;
    /**
     * Parse a single JSONL line into a CompactionEvent.
     * Returns undefined if the line is not a valid compaction event.
     *
     * Supports both real OC layout (top-level `summary`) and legacy fixtures
     * (`data.summary`). Real production data uses the top-level layout.
     */
    private parseLine;
}
//# sourceMappingURL=reader.d.ts.map