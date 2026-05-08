/**
 * stub.ts — Generates the hot-swap stub compaction summary.
 *
 * The stub is returned immediately from summarize() with zero LLM calls.
 * It contains a unique marker ([KASETT_STUB::<id>]) so the background
 * worker can find and replace it in the JSONL once the full LLM summary
 * is ready.
 *
 * Thread meta in the stub is extracted from the PREVIOUS compaction's
 * [THREAD_META] block (supplied via previousSummary), or derived from a
 * lightweight heuristic over the last few messages if no prior summary exists.
 */
/**
 * A generated stub result.
 */
export interface StubResult {
    /** The full stub string to return from summarize() */
    stub: string;
    /** Unique ID embedded in the stub for later hot-swap identification */
    stubId: string;
}
/**
 * Generate a stub compaction summary.
 *
 * @param previousSummary - Previous compaction summary from OC params (may be undefined)
 * @param messages - The conversation messages being compacted (for fallback heuristic)
 * @returns StubResult with the stub string and its unique ID
 */
export declare function generateStub(previousSummary: string | undefined, messages: Array<{
    role: string;
    content: unknown;
}>): StubResult;
//# sourceMappingURL=stub.d.ts.map