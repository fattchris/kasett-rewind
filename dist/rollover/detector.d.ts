/**
 * rollover/detector.ts — Decide whether a session triggers the cold-start branch.
 *
 * Gates (all must be true for Tier 3 to fire):
 *   1. coldStart.enabled === true
 *   2. Current session is "cold": has 0 compaction summaries AND
 *      ≤ minTurns user/assistant turns
 *   3. A sibling session JSONL exists for the same topic
 *   4. Sibling mtime is within maxIdleHours of now
 *   5. Sibling has ≥ minTurns turns to actually summarize
 *   6. No prior `.rollover.failed.json` marker (don't retry storms)
 *   7. No active or consumed rollover sidecar already in place
 *
 * Pure function — no side effects, no file mutations. Returns a verdict
 * object that the caller wires into `before_prompt_build`.
 */
import type { KasettColdStartConfig } from '../types.js';
export type RolloverVerdict = {
    fire: false;
    reason: string;
} | {
    fire: true;
    siblingFile: string;
    siblingMtimeMs: number;
    siblingTurnCount: number;
    currentTurnCount: number;
};
export interface RolloverDetectorParams {
    /** Plugin config */
    config: KasettColdStartConfig;
    /** Absolute path to the CURRENT session JSONL (may not exist yet) */
    currentSessionFile: string;
    /** Topic ID from the sessionKey (extracted by the caller) */
    topicId: string;
    /**
     * The sibling-finder. Same one already in index.ts. Passed in to keep
     * this module free of cycle imports.
     */
    findSibling: (sessionsDir: string, currentFilename: string, topicId: string) => Promise<string | null>;
}
export declare function detectRolloverOpportunity(params: RolloverDetectorParams): Promise<RolloverVerdict>;
//# sourceMappingURL=detector.d.ts.map