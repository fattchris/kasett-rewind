/**
 * worker.ts — Background LLM call + hot-swap file rewrite logic.
 *
 * After summarize() returns the stub immediately, this module runs the FULL
 * LLM summarization in the background, then waits for the inter-turn gap
 * (OC's session write lock to be absent) and atomically rewrites the JSONL,
 * replacing the stub compaction entry with the full LLM-generated summary.
 *
 * ## Atomic rewrite pattern (matches OC's own pattern):
 *   1. Read current JSONL content
 *   2. Parse all lines, find the stub compaction entry by stubId
 *   3. Replace its summary field with the full LLM summary
 *   4. Write to `${sessionFile}.kasett-swap-tmp`
 *   5. `fs.rename(tmp, sessionFile)` — atomic on POSIX
 *   6. Release the lock
 *
 * ## Stale result handling:
 *   If ANOTHER compaction fires before this hot-swap completes, the stub
 *   entry will have been replaced or truncated by OC's own compaction
 *   machinery. In that case, the stub ID will no longer be found in the
 *   JSONL and the background result is silently discarded.
 */
export interface WorkerParams {
    /** Absolute path to the session `.jsonl` file to rewrite */
    sessionFile: string;
    /** The stub ID embedded in the compaction entry to replace */
    stubId: string;
    /** Messages passed to summarize() — forwarded to the LLM */
    messages: Array<{
        role: string;
        content: unknown;
    }>;
    /** Previous summary text for continuity blending */
    previousSummaries: string[];
    /** Steering prompt already built for this compaction */
    steeringPrompt: string;
    /** OC custom instructions (passed through to LLM) */
    customInstructions?: string;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Model identifier override */
    compactionModel?: string;
    /**
     * Maximum time (ms) to wait for the session lock to be absent before
     * attempting the swap. Default: 30_000
     */
    hotSwapTimeoutMs?: number;
    /** Logger (plugin API logger) */
    logger: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
        debug(msg: string): void;
    };
    /** The callLLMForCompaction function — injected to avoid circular deps */
    callLLM: (params: CallLLMParams) => Promise<string | undefined>;
}
export interface CallLLMParams {
    messages: Array<{
        role: string;
        content: unknown;
    }>;
    signal?: AbortSignal;
    customInstructions?: string;
    steeringPrompt: string;
    compactionModel?: string;
    logger: {
        debug(msg: string): void;
        warn(msg: string): void;
        info(msg: string): void;
    };
}
export declare function runHotSwapWorker(params: WorkerParams): Promise<void>;
//# sourceMappingURL=worker.d.ts.map