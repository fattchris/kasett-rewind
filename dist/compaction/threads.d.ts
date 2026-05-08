import type { CompactionSummary, ThreadSnapshot } from '../types.js';
/**
 * Thread tracker — ensures threads evolve gradually across compactions
 * and never silently disappear.
 */
export declare class ThreadTracker {
    /**
     * Parse a structured compaction output (from the LLM) into a ThreadSnapshot.
     * Expects markdown format matching the compaction prompt template.
     */
    static parse(rawSummary: string): ThreadSnapshot;
    /**
     * Validate that thread evolution rules are respected:
     * - Every thread from previous compaction appears in current (active or history)
     * - No thread silently disappears
     * Returns list of violations (empty = valid).
     */
    static validate(current: ThreadSnapshot, previous: ThreadSnapshot | undefined): string[];
    /**
     * Merge thread history from previous compaction into current snapshot.
     * Threads that were active in previous but not in current get added to history.
     */
    static mergeHistory(current: ThreadSnapshot, previous: CompactionSummary | undefined): ThreadSnapshot;
}
//# sourceMappingURL=threads.d.ts.map