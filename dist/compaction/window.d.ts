import type { CompactionEvent, KasettConfig } from '../types.js';
/**
 * Manages a rolling window of compaction events.
 * Useful for keeping the last N events in memory.
 */
export declare class CompactionWindow {
    private events;
    private readonly windowSize;
    constructor(config: Pick<KasettConfig['compaction'], 'windowSize'>);
    /** Load existing events (called on init from session JSONL) */
    load(events: CompactionEvent[]): void;
    /** Get all events in the window (oldest first) */
    getAll(): CompactionEvent[];
    /** Get the most recent event */
    getLatest(): CompactionEvent | undefined;
    /**
     * Push a new event into the window.
     * If window is full, the oldest event is dropped.
     * Returns the dropped event (if any).
     */
    push(event: CompactionEvent): CompactionEvent | undefined;
    /** Get current window size (actual, not max) */
    get size(): number;
    /** Serialize for storage */
    serialize(): CompactionEvent[];
}
//# sourceMappingURL=window.d.ts.map