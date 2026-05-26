/**
 * rollover/stub.ts — Cheap synchronous stub for the cold-start path.
 *
 * Called on the first `before_prompt_build` of a brand-new session when the
 * detector says Tier 3 should fire. Produces a small `[ROLLOVER_CONTEXT]`
 * block with the last user + last assistant turn from the sibling. No LLM
 * call. Returns in milliseconds.
 *
 * Format (visible to the agent on first turn):
 *
 *     [ROLLOVER_CONTEXT — stub]
 *     The prior session for this topic ended ~Xh ago.
 *     Last user turn:
 *       "..."
 *     Last assistant turn:
 *       "..."
 *     A richer summary is being generated in the background and will be
 *     available from the next turn onward.
 *     [/ROLLOVER_CONTEXT]
 */
import type { RolloverSidecarEntry } from './sidecar.js';
export interface StubBuildParams {
    /** All sibling turns, oldest first. The stub uses the tail. */
    siblingTurns: Array<{
        role: string;
        content: unknown;
    }>;
    /** Absolute path to the sibling session file (recorded in sidecar) */
    siblingFile: string;
    /** Sibling file mtime (epoch ms) */
    siblingMtimeMs: number;
    /** Maximum chars per quoted turn in the stub. Default: 400. */
    maxChars?: number;
}
export declare function buildRolloverStub(params: StubBuildParams): RolloverSidecarEntry;
//# sourceMappingURL=stub.d.ts.map