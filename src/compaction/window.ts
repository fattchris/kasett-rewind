import type { CompactionEvent, KasettConfig } from '../types.js';

/**
 * Manages a rolling window of compaction events.
 * Useful for keeping the last N events in memory.
 */
export class CompactionWindow {
  private events: CompactionEvent[] = [];
  private readonly windowSize: number;

  constructor(config: Pick<KasettConfig['compaction'], 'windowSize'>) {
    this.windowSize = config.windowSize;
  }

  /** Load existing events (called on init from session JSONL) */
  load(events: CompactionEvent[]): void {
    this.events = events.slice(-this.windowSize);
  }

  /** Get all events in the window (oldest first) */
  getAll(): CompactionEvent[] {
    return [...this.events];
  }

  /** Get the most recent event */
  getLatest(): CompactionEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /**
   * Push a new event into the window.
   * If window is full, the oldest event is dropped.
   * Returns the dropped event (if any).
   */
  push(event: CompactionEvent): CompactionEvent | undefined {
    let dropped: CompactionEvent | undefined;

    if (this.events.length >= this.windowSize) {
      dropped = this.events.shift();
    }

    this.events.push(event);
    return dropped;
  }

  /** Get current window size (actual, not max) */
  get size(): number {
    return this.events.length;
  }

  /** Serialize for storage */
  serialize(): CompactionEvent[] {
    return this.events.map((e) => ({ ...e }));
  }
}
