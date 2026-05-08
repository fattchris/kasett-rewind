import type { CompactionEvent, ThreadMeta } from '../types.js';
/**
 * Error class for kasett-rewind operations.
 */
export declare class KasettError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Reads session JSONL files and extracts compaction events with kaspiett thread meta.
 * Uses streaming for memory efficiency on large session files.
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
     * Read the last N compaction events that have kaspiett thread meta.
     * Falls back to events without kaspiett if fewer than N have it.
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @param count - Maximum number of events to return
     * @returns The last N CompactionEvent objects with kaspiett (oldest first)
     */
    readLastNWithMeta(filePath: string, count: number): Promise<CompactionEvent[]>;
    /**
     * Read the most recent thread meta from the session JSONL.
     * Returns null if no compaction with kaspiett meta exists.
     */
    readLatestMeta(filePath: string): Promise<ThreadMeta | null>;
    /**
     * Read the most recent compaction summary string from the session JSONL.
     * Returns the raw summary text (which may include a [THREAD_META] block)
     * from the most recent compaction event, regardless of whether it has kaspiett.
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @returns The most recent summary string, or null if no compaction events exist
     */
    readLatestSummary(filePath: string): Promise<string | null>;
    /**
     * Read the last N compaction summary strings from the session JSONL.
     * Returns raw summary texts (which may include [THREAD_META] blocks),
     * in chronological order (oldest first), regardless of kaspiett presence.
     *
     * @param filePath - Absolute path to the session .jsonl file
     * @param count - Maximum number of summaries to return
     * @returns The last N summary strings, oldest first
     */
    readLastNSummaries(filePath: string, count: number): Promise<string[]>;
    /**
     * Parse a single JSONL line into a CompactionEvent.
     * Returns undefined if the line is not a valid compaction event.
     */
    private parseLine;
}
//# sourceMappingURL=reader.d.ts.map