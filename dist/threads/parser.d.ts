/**
 * Parser for [THREAD_META]...[/THREAD_META] blocks in compaction output.
 *
 * Extracts the thread meta, parses it into a ThreadMeta object,
 * and strips it from the summary so the stored summary is clean narrative.
 */
import type { ThreadMeta } from '../types.js';
/**
 * Result of parsing a compaction output.
 */
export interface ParseResult {
    /** The narrative summary with thread meta block removed */
    summary: string;
    /** The extracted thread meta, or null if not found/invalid */
    meta: ThreadMeta | null;
}
/**
 * Parse a compaction output string, extracting thread meta and clean summary.
 *
 * @param raw - Raw compaction LLM output containing both narrative and thread meta
 * @returns ParseResult with clean summary and extracted meta
 */
export declare function parseCompactionOutput(raw: string): ParseResult;
//# sourceMappingURL=parser.d.ts.map