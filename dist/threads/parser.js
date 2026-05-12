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
import { validateThreadMetaV2, validateThreadMetaV3, projectV2ToV1, projectV3ToV2, } from './schema.js';
/**
 * The regex that matches the [THREAD_META]...[/THREAD_META] block.
 */
const THREAD_META_REGEX = /\[THREAD_META\]\s*\n([\s\S]*?)\n?\s*\[\/THREAD_META\]/;
/**
 * Matches a fenced JSON block: ```json\n...\n```. Captures the inner content.
 *
 * Tolerant of:
 *   - any case of "json" (`json`, `JSON`, `Json`)
 *   - leading whitespace inside the fence
 *   - trailing newline before the closing fence
 *
 * NOT tolerant of:
 *   - missing language tag (`` ``` `` with no `json`) — too many false
 *     positives in narrative summaries
 *   - tilde fences (~~~) — also valid markdown but rarely emitted by LLMs
 */
const JSON_FENCE_REGEX = /```(?:json|JSON|Json)\s*\n([\s\S]*?)\n?\s*```/;
/**
 * Parse a v1 compaction output string, extracting thread meta and clean summary.
 *
 * @param raw - Raw compaction LLM output containing both narrative and thread meta
 * @returns ParseResult with clean summary and extracted meta
 */
export function parseCompactionOutput(raw) {
    const match = raw.match(THREAD_META_REGEX);
    if (!match) {
        // No thread meta block found — return raw as summary, null meta
        return { summary: raw.trim(), meta: null };
    }
    // Extract the meta block content
    const metaBlock = match[1];
    const meta = parseMetaBlock(metaBlock);
    // Strip the entire [THREAD_META]...[/THREAD_META] block from the summary
    const summary = raw.replace(THREAD_META_REGEX, '').trim();
    return { summary, meta };
}
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
export function parseCompactionOutputV2(raw) {
    const errors = [];
    // Walk all fenced JSON blocks, keep the last one
    let lastMatch = null;
    const globalRe = new RegExp(JSON_FENCE_REGEX.source, 'g');
    let m;
    while ((m = globalRe.exec(raw)) !== null) {
        lastMatch = m;
    }
    if (!lastMatch) {
        return {
            summary: raw.trim(),
            meta: null,
            metaV1: null,
            errors: ['no fenced ```json``` block found'],
        };
    }
    const inner = lastMatch[1];
    let parsed;
    try {
        parsed = JSON.parse(inner);
    }
    catch (err) {
        return {
            summary: raw.trim(),
            meta: null,
            metaV1: null,
            errors: [`JSON parse failed: ${err.message}`],
        };
    }
    const validation = validateThreadMetaV2(parsed);
    if (!validation.ok) {
        for (const e of validation.errors)
            errors.push(e);
        return {
            summary: raw.trim(),
            meta: null,
            metaV1: null,
            errors,
        };
    }
    // Strip ONLY the matched (last) JSON fence. Use a per-match replace so we
    // don't accidentally remove an earlier example fence.
    const startIdx = lastMatch.index;
    const endIdx = lastMatch.index + lastMatch[0].length;
    const summary = (raw.slice(0, startIdx) + raw.slice(endIdx)).trim();
    return {
        summary,
        meta: validation.value,
        metaV1: projectV2ToV1(validation.value),
        errors,
    };
}
/**
 * Parse a v3 compaction output. Same fence-finding logic as v2, but the
 * inner object is validated against the v3 schema (v2 + optional
 * key_state[]). Invalid `key_state` entries are silently dropped by the
 * validator rather than failing the whole parse.
 */
export function parseCompactionOutputV3(raw) {
    const errors = [];
    let lastMatch = null;
    const globalRe = new RegExp(JSON_FENCE_REGEX.source, 'g');
    let m;
    while ((m = globalRe.exec(raw)) !== null) {
        lastMatch = m;
    }
    if (!lastMatch) {
        return {
            summary: raw.trim(),
            meta: null,
            metaV2: null,
            metaV1: null,
            errors: ['no fenced ```json``` block found'],
        };
    }
    const inner = lastMatch[1];
    let parsed;
    try {
        parsed = JSON.parse(inner);
    }
    catch (err) {
        return {
            summary: raw.trim(),
            meta: null,
            metaV2: null,
            metaV1: null,
            errors: [`JSON parse failed: ${err.message}`],
        };
    }
    const validation = validateThreadMetaV3(parsed);
    if (!validation.ok) {
        for (const e of validation.errors)
            errors.push(e);
        return {
            summary: raw.trim(),
            meta: null,
            metaV2: null,
            metaV1: null,
            errors,
        };
    }
    const startIdx = lastMatch.index;
    const endIdx = lastMatch.index + lastMatch[0].length;
    const summary = (raw.slice(0, startIdx) + raw.slice(endIdx)).trim();
    const v3 = validation.value;
    const v2 = projectV3ToV2(v3);
    return {
        summary,
        meta: v3,
        metaV2: v2,
        metaV1: projectV2ToV1(v2),
        errors,
    };
}
export function parseCompactionOutputBestEffort(raw) {
    const v3 = parseCompactionOutputV3(raw);
    if (v3.meta) {
        return {
            version: 'v3',
            summary: v3.summary,
            metaV1: v3.metaV1,
            metaV2: v3.metaV2,
            metaV3: v3.meta,
            errors: [],
        };
    }
    const v2 = parseCompactionOutputV2(raw);
    if (v2.meta) {
        return {
            version: 'v2',
            summary: v2.summary,
            metaV1: v2.metaV1,
            metaV2: v2.meta,
            metaV3: null,
            errors: [],
        };
    }
    const v1 = parseCompactionOutput(raw);
    if (v1.meta) {
        return {
            version: 'v1',
            summary: v1.summary,
            metaV1: v1.meta,
            metaV2: null,
            metaV3: null,
            errors: v3.errors,
        };
    }
    return {
        version: 'none',
        summary: raw.trim(),
        metaV1: null,
        metaV2: null,
        metaV3: null,
        errors: v3.errors,
    };
}
/**
 * Parse the inner content of a [THREAD_META] block into a ThreadMeta object.
 *
 * Expected format:
 *   main: <text>
 *   sub1: <text>
 *   sub2: <text>
 *   sub3: <text>
 */
function parseMetaBlock(block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let main = '';
    const subs = [];
    for (const line of lines) {
        const mainMatch = line.match(/^main:\s*(.+)/i);
        if (mainMatch) {
            main = mainMatch[1].trim();
            continue;
        }
        const subMatch = line.match(/^sub[123]:\s*(.+)/i);
        if (subMatch) {
            subs.push(subMatch[1].trim());
        }
    }
    // Validate: must have main + exactly 3 subs
    if (!main || subs.length !== 3) {
        return null;
    }
    return {
        main,
        sub: [subs[0], subs[1], subs[2]],
    };
}
//# sourceMappingURL=parser.js.map