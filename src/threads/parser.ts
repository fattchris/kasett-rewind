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
import {
  validateThreadMetaV2,
  projectV2ToV1,
  type ThreadMetaV2,
} from './schema.js';

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
export function parseCompactionOutput(raw: string): ParseResult {
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
export function parseCompactionOutputV2(raw: string): ParseResultV2 {
  const errors: string[] = [];

  // Walk all fenced JSON blocks, keep the last one
  let lastMatch: RegExpExecArray | null = null;
  const globalRe = new RegExp(JSON_FENCE_REGEX.source, 'g');
  let m: RegExpExecArray | null;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch (err) {
    return {
      summary: raw.trim(),
      meta: null,
      metaV1: null,
      errors: [`JSON parse failed: ${(err as Error).message}`],
    };
  }

  const validation = validateThreadMetaV2(parsed);
  if (!validation.ok) {
    for (const e of validation.errors) errors.push(e);
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
 * Best-effort parser: try v2 first, fall back to v1.
 *
 * Returns:
 *   - `version`: which schema produced the result, or 'none' if neither did
 *   - `summary`: clean narrative with the meta block stripped
 *   - `metaV1`: v1-shaped meta (always populated when version != 'none', via
 *     projection if v2 succeeded)
 *   - `metaV2`: v2-shaped meta (only when version === 'v2')
 *   - `errors`: v2 validator output when v2 failed (helpful for diag)
 */
export interface BestEffortParseResult {
  version: 'v1' | 'v2' | 'none';
  summary: string;
  metaV1: ThreadMeta | null;
  metaV2: ThreadMetaV2 | null;
  errors: string[];
}

export function parseCompactionOutputBestEffort(
  raw: string,
): BestEffortParseResult {
  const v2 = parseCompactionOutputV2(raw);
  if (v2.meta) {
    return {
      version: 'v2',
      summary: v2.summary,
      metaV1: v2.metaV1,
      metaV2: v2.meta,
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
      errors: v2.errors,
    };
  }
  return {
    version: 'none',
    summary: raw.trim(),
    metaV1: null,
    metaV2: null,
    errors: v2.errors,
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
function parseMetaBlock(block: string): ThreadMeta | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

  let main = '';
  const subs: string[] = [];

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
    sub: [subs[0], subs[1], subs[2]] as [string, string, string],
  };
}
