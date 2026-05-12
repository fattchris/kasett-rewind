/**
 * Parser for compaction LLM output.
 *
 * Two parsers, one for each schema version:
 *
 *   - parseCompactionOutput   (v1) — extracts a `[THREAD_META]…[/THREAD_META]`
 *                                    markdown sentinel block and the surrounding
 *                                    narrative. Kept for backward compat with
 *                                    legacy stored summaries.
 *
 *   - parseCompactionOutputV2 (v2) — extracts a fenced ```json``` block and
 *                                    parses it through the v2 schema validator.
 *                                    Returns both the typed v2 object AND a
 *                                    lossy v1 projection so existing readers
 *                                    keep working.
 *
 * The worker tries v2 first; if it fails, it falls back to v1. In the
 * sidecar both `thread_meta` (v1 shape) and `thread_meta_v2` (v2 object)
 * are stored when v2 succeeds, so readers can pick whichever they prefer.
 */
import type { ThreadMeta } from '../types.js';
import { type ThreadMetaV2, type ThreadMetaV3 } from './schema.js';
/**
 * Result of parsing a v1 compaction output.
 */
export interface ParseResult {
    /** The narrative summary with thread meta block removed */
    summary: string;
    /** The extracted thread meta, or null if not found/invalid */
    meta: ThreadMeta | null;
}
/**
 * Result of parsing a v2 compaction output.
 *
 * `summary` strips both the JSON block AND any surrounding fences/whitespace
 * so the stored summary stays clean prose. `meta` is the typed v2 object.
 * `metaV1` is a lossy projection for legacy readers.
 *
 * `errors` carries validator messages when `meta` is null — useful for the
 * fallback path to log WHY the v2 attempt failed.
 */
export interface ParseResultV2 {
    summary: string;
    meta: ThreadMetaV2 | null;
    metaV1: ThreadMeta | null;
    errors: string[];
}
/**
 * Parse a v1 compaction output string, extracting thread meta and clean summary.
 *
 * @param raw - Raw compaction LLM output containing both narrative and thread meta
 * @returns ParseResult with clean summary and extracted meta
 */
export declare function parseCompactionOutput(raw: string): ParseResult;
/**
 * Parse a v2 compaction output string.
 *
 * Algorithm:
 *   1. Find the LAST ```json``` fence in the output (LLMs occasionally show
 *      the schema example inline before emitting their own block).
 *   2. JSON.parse the inner content; if parse fails, return errors.
 *   3. Validate against v2 schema; if invalid, return errors.
 *   4. Strip the JSON block from the narrative for clean storage.
 *
 * Picking the LAST fence is the right call for our prompt structure: the
 * prompt itself includes a schema example (also fenced), and some LLMs echo
 * the example before producing their own. Last-fence grabs the real answer.
 */
export declare function parseCompactionOutputV2(raw: string): ParseResultV2;
/**
 * Result of parsing a v3 compaction output.
 *
 * Identical strategy to v2 (last fenced JSON block, JSON.parse, validate),
 * but uses the v3 validator which tolerates an optional `key_state[]`. V3
 * outputs that omit key_state are functionally identical to V2 outputs.
 */
export interface ParseResultV3 {
    summary: string;
    meta: ThreadMetaV3 | null;
    metaV2: ThreadMetaV2 | null;
    metaV1: ThreadMeta | null;
    errors: string[];
}
/**
 * Parse a v3 compaction output. Same fence-finding logic as v2, but the
 * inner object is validated against the v3 schema (v2 + optional
 * key_state[]). Invalid `key_state` entries are silently dropped by the
 * validator rather than failing the whole parse.
 */
export declare function parseCompactionOutputV3(raw: string): ParseResultV3;
/**
 * Best-effort parser: try v3 (which subsumes v2), fall back to v2, then v1.
 *
 * Returns:
 *   - `version`: which schema produced the result, or 'none' if none did
 *   - `summary`: clean narrative with the meta block stripped
 *   - `metaV1`: v1-shaped meta (always populated when version != 'none', via
 *     projection if v2/v3 succeeded)
 *   - `metaV2`: v2-shaped meta (when version is 'v2' or 'v3')
 *   - `metaV3`: v3-shaped meta (only when version === 'v3')
 *   - `errors`: parser/validator output when v3 failed (helpful for diag)
 */
export interface BestEffortParseResult {
    version: 'v1' | 'v2' | 'v3' | 'none';
    summary: string;
    metaV1: ThreadMeta | null;
    metaV2: ThreadMetaV2 | null;
    metaV3: ThreadMetaV3 | null;
    errors: string[];
}
export declare function parseCompactionOutputBestEffort(raw: string): BestEffortParseResult;
//# sourceMappingURL=parser.d.ts.map