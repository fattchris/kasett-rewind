/**
 * Manages a rolling window of compaction events.
 * Useful for keeping the last N events in memory.
 */
export class CompactionWindow {
    events = [];
    windowSize;
    constructor(config) {
        this.windowSize = config.windowSize;
    }
    /** Load existing events (called on init from session JSONL) */
    load(events) {
        this.events = events.slice(-this.windowSize);
    }
    /** Get all events in the window (oldest first) */
    getAll() {
        return [...this.events];
    }
    /** Get the most recent event */
    getLatest() {
        return this.events[this.events.length - 1];
    }
    /**
     * Push a new event into the window.
     * If window is full, the oldest event is dropped.
     * Returns the dropped event (if any).
     */
    push(event) {
        let dropped;
        if (this.events.length >= this.windowSize) {
            dropped = this.events.shift();
        }
        this.events.push(event);
        return dropped;
    }
    /** Get current window size (actual, not max) */
    get size() {
        return this.events.length;
    }
    /** Serialize for storage */
    serialize() {
        return this.events.map((e) => ({ ...e }));
    }
}
//# sourceMappingURL=window.js.map