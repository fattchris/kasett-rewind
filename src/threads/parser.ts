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
  validateThreadMetaV3,
  projectV2ToV1,
  projectV3ToV2,
  type ThreadMetaV2,
  type ThreadMetaV3,
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
 * Open-only fence: matches `` ```json `` with NO closing fence. Used by the
 * truncation-repair path (Phase F) when the LLM hits its max_tokens limit
 * mid-JSON — the closing `` ``` `` fence is gone but the structured content
 * before it is still valuable.
 *
 * Captures everything after the opening fence to end of input.
 */
const JSON_OPEN_FENCE_REGEX = /```(?:json|JSON|Json)\s*\n([\s\S]*)$/;

/**
 * Repair a truncated JSON string by:
 *  - terminating any open string literal
 *  - balancing open arrays, objects with appropriate closers
 *  - dropping a trailing comma if the last token was the start of a new value
 *
 * This is best-effort — callers must still JSON.parse the result and handle
 * failure. Phase F: introduced because Sonnet 4.5 truncated mid-JSON at max
 * tokens and the strict parser dropped 14k chars of structured output.
 */
export function repairTruncatedJson(text: string): {
  repaired: string;
  repairsMade: string[];
} {
  const repairsMade: string[] = [];
  if (!text) return { repaired: text, repairsMade };

  // Walk the input tracking JSON state. We track:
  //   - whether we're inside a string literal
  //   - whether the previous char was an unescaped backslash
  //   - the stack of currently-open structural tokens ('{' or '[')
  //
  // We do NOT validate structure (e.g. matching ':' between keys and
  // values). That's the parser's job once we've patched the truncation.
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let stringQuoteIdx = -1;
  let escape = false;
  let lastNonWsIdx = -1;
  let lastNonWsChar = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringQuoteIdx = i;
      lastNonWsIdx = i;
      lastNonWsChar = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      lastNonWsIdx = i;
      lastNonWsChar = ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      const want = ch === '}' ? '{' : '[';
      if (stack.length > 0 && stack[stack.length - 1] === want) {
        stack.pop();
      }
      lastNonWsIdx = i;
      lastNonWsChar = ch;
      continue;
    }
    if (/\s/.test(ch)) continue;
    lastNonWsIdx = i;
    lastNonWsChar = ch;
  }

  let out = text;

  // Step 1: close an unterminated string literal.
  if (inString) {
    out = out + '"';
    repairsMade.push(
      `closed_unterminated_string(@${stringQuoteIdx},len=${out.length - text.length})`,
    );
  }

  // Step 2: drop dangling syntax that would break parse. Iterate because
  // dropping one orphan can expose another. We handle:
  //   - trailing comma
  //   - trailing colon (orphan key after `:`)
  //   - trailing closed-string-quote that's an orphan key (no `:` yet)
  for (let pass = 0; pass < 8; pass++) {
    let probe = out.length - 1;
    while (probe >= 0 && /\s/.test(out[probe]!)) probe--;
    if (probe < 0) break;
    const tail = out[probe];
    let dropped = false;

    if (tail === ',') {
      out = out.slice(0, probe) + out.slice(probe + 1);
      if (!repairsMade.includes('dropped_trailing_comma')) {
        repairsMade.push('dropped_trailing_comma');
      }
      dropped = true;
    } else if (tail === ':') {
      // Drop the orphan key entirely — walk back to the start of the
      // preceding string and trim it.
      const newOut = dropOrphanKeyEndingAt(out, probe);
      if (newOut !== null && newOut !== out) {
        out = newOut;
        if (!repairsMade.includes('dropped_orphan_key')) {
          repairsMade.push('dropped_orphan_key');
        }
        dropped = true;
      }
    } else if (tail === '"') {
      // We just closed a string. Was it a key (no `:` follows)? Look at
      // what comes BEFORE its opening quote: a `,` or `{` means it's
      // sitting in key position. If so, this is an orphan key without
      // its value — drop it.
      // Walk back to its opening quote.
      let k = probe - 1;
      while (k >= 0) {
        if (out[k] === '"' && out[k - 1] !== '\\') break;
        k--;
      }
      if (k > 0) {
        let pre = k - 1;
        while (pre >= 0 && /\s/.test(out[pre]!)) pre--;
        if (pre >= 0 && (out[pre] === ',' || out[pre] === '{')) {
          // Definitely an orphan key. Drop it (and the leading comma if
          // the predecessor was a comma).
          if (out[pre] === ',') {
            out = out.slice(0, pre);
            if (!repairsMade.includes('dropped_orphan_key_with_leading_comma')) {
              repairsMade.push('dropped_orphan_key_with_leading_comma');
            }
          } else {
            // Predecessor is `{`. Drop just the orphan key string;
            // keep the `{` in place.
            out = out.slice(0, k);
            if (!repairsMade.includes('dropped_orphan_key')) {
              repairsMade.push('dropped_orphan_key');
            }
          }
          dropped = true;
        }
      }
    }

    if (!dropped) break;
  }

  // Step 3: close any open structural tokens, innermost first. Re-walk the
  // potentially-edited `out` to recompute stack state because Step 2 may
  // have removed open structure (unlikely) or trailing content.
  const stack2 = recomputeStructuralStack(out);
  while (stack2.length > 0) {
    const open = stack2.pop()!;
    out += open === '{' ? '}' : ']';
  }
  if (out.length !== text.length + (inString ? 1 : 0)) {
    if (!repairsMade.includes('balanced_brackets')) {
      repairsMade.push('balanced_brackets');
    }
  }

  // Suppress lint hints: keep variables in case future telemetry needs them.
  void lastNonWsIdx;
  void lastNonWsChar;
  void stack;

  return { repaired: out, repairsMade };
}

/**
 * Walk forward over `text` and return the stack of unclosed structural
 * tokens (`{` or `[`). Used after editing operations to recompute the open
 * structure depth.
 */
function recomputeStructuralStack(text: string): Array<'{' | '['> {
  const stack: Array<'{' | '['> = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const want = ch === '}' ? '{' : '[';
      if (stack.length > 0 && stack[stack.length - 1] === want) stack.pop();
    }
  }
  return stack;
}

/** Helper for Step 2: given a colon at `colonIdx`, drop the preceding key. */
function dropOrphanKeyEndingAt(out: string, colonIdx: number): string | null {
  let j = colonIdx - 1;
  while (j >= 0 && /\s/.test(out[j]!)) j--;
  if (j < 0 || out[j] !== '"') return null;
  let k = j - 1;
  while (k >= 0) {
    if (out[k] === '"' && out[k - 1] !== '\\') break;
    k--;
  }
  if (k < 0) return null;
  let m = k - 1;
  while (m >= 0 && /\s/.test(out[m]!)) m--;
  if (m >= 0 && out[m] === ',') {
    return out.slice(0, m);
  }
  return out.slice(0, k);
}

/**
 * Best-effort field extraction from a partial JSON object using regex.
 * Used as the LAST fallback when both raw parse and bracket-balanced repair
 * fail. Looks for top-level `"main"`, `"sub"`, `"key_state"`, `"decisions"`,
 * `"open_questions"` keys and tries to grab their values up to a delimiter.
 *
 * Returns `null` if it can't even find a `main` field (the only required one).
 * The caller should mark these as partial.
 */
function lenientFieldExtract(
  inner: string,
): { partial: Record<string, unknown> } | null {
  const out: Record<string, unknown> = {};
  // Top-level main: "..."
  const mainMatch = /"main"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(inner);
  if (mainMatch) {
    try {
      out['main'] = JSON.parse('"' + mainMatch[1] + '"');
    } catch {
      out['main'] = mainMatch[1];
    }
  }
  // Try to recover an array field by repairing it as a standalone JSON value.
  function tryArrayField(name: string): unknown[] | null {
    const re = new RegExp(`"${name}"\\s*:\\s*\\[`);
    const m = re.exec(inner);
    if (!m) return null;
    const startIdx = m.index + m[0].length - 1; // points at '['
    // Walk forward, balancing brackets with string awareness.
    const stack: string[] = ['['];
    let i = startIdx + 1;
    let inStr = false;
    let esc = false;
    let endIdx = -1;
    for (; i < inner.length; i++) {
      const ch = inner[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '[' || ch === '{') stack.push(ch);
      else if (ch === ']' || ch === '}') {
        stack.pop();
        if (stack.length === 0) {
          endIdx = i;
          break;
        }
      }
    }
    let segment: string;
    if (endIdx >= 0) {
      segment = inner.slice(startIdx, endIdx + 1);
    } else {
      // Truncated mid-array — take what we have and repair it.
      segment = inner.slice(startIdx);
      const rep = repairTruncatedJson(segment);
      segment = rep.repaired;
    }
    try {
      const arr = JSON.parse(segment);
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }
  for (const field of ['sub', 'key_state', 'decisions', 'open_questions']) {
    const v = tryArrayField(field);
    if (v !== null) out[field] = v;
  }
  if (!out['main']) return null;
  return { partial: out };
}

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
 *
 * Phase F: now also tolerates **truncated** JSON output (LLM hit max_tokens
 * mid-block, no closing fence). Falls through to:
 *   1. closed-fence parse (the original strict path)
 *   2. open-fence + raw parse  — in case the LLM emitted bare JSON without
 *      bothering to close the fence even though the JSON itself is whole
 *   3. open-fence + bracket-balancing repair  — closes unterminated string,
 *      drops trailing comma, balances brackets, then JSON.parse
 *   4. open-fence + lenient field-by-field regex extraction (last resort)
 *
 * In repair paths the result carries `_partial: true` on the meta object so
 * downstream consumers can flag the entry for review. Validation runs in
 * "lenient" mode after a repair: if the repaired object lacks required v3
 * fields the validator failures are surfaced via `errors`.
 */
export function parseCompactionOutputV3(raw: string): ParseResultV3 {
  const errors: string[] = [];

  // ---- 1. Closed-fence path (strict; original behaviour) ----
  let lastMatch: RegExpExecArray | null = null;
  const globalRe = new RegExp(JSON_FENCE_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(raw)) !== null) {
    lastMatch = m;
  }

  if (lastMatch) {
    const inner = lastMatch[1];
    try {
      const parsed: unknown = JSON.parse(inner);
      const validation = validateThreadMetaV3(parsed);
      if (validation.ok) {
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
      for (const e of validation.errors) errors.push(`closed-fence:${e}`);
    } catch (err) {
      errors.push(`closed-fence JSON parse failed: ${(err as Error).message}`);
    }
  }

  // ---- 2-4. Open-fence (truncated) repair path ----
  const openMatch = JSON_OPEN_FENCE_REGEX.exec(raw);
  if (!openMatch) {
    if (!lastMatch) {
      return {
        summary: raw.trim(),
        meta: null,
        metaV2: null,
        metaV1: null,
        errors: ['no fenced ```json``` block found'],
      };
    }
    return {
      summary: raw.trim(),
      meta: null,
      metaV2: null,
      metaV1: null,
      errors,
    };
  }

  // If we already had a closed fence, don't bother with the open-fence path —
  // the closed parse already failed validation, and re-running the same
  // content via repair won't help.
  if (lastMatch) {
    return {
      summary: raw.trim(),
      meta: null,
      metaV2: null,
      metaV1: null,
      errors,
    };
  }

  let truncatedInner = openMatch[1];
  // Strip a trailing closing fence if it somehow snuck in (sanity).
  truncatedInner = truncatedInner.replace(/\n?\s*```\s*$/, '');

  // ---- 2. Try parsing the open-fence content as-is ----
  let parsedFromOpen: unknown | undefined;
  try {
    parsedFromOpen = JSON.parse(truncatedInner);
  } catch {
    /* fall through to repair */
  }

  if (parsedFromOpen !== undefined) {
    const validation = validateThreadMetaV3(parsedFromOpen);
    if (validation.ok) {
      const summary = raw.slice(0, openMatch.index).trim();
      const v3 = { ...validation.value, _partial: false } as ThreadMetaV3 & {
        _partial?: boolean;
      };
      const v2 = projectV3ToV2(v3);
      return {
        summary,
        meta: v3,
        metaV2: v2,
        metaV1: projectV2ToV1(v2),
        errors: [...errors, 'recovered:open-fence-no-repair'],
      };
    }
    for (const e of validation.errors) errors.push(`open-fence:${e}`);
  }

  // ---- 3. Bracket-balancing repair ----
  const repaired = repairTruncatedJson(truncatedInner);
  let parsedRepaired: unknown | undefined;
  try {
    parsedRepaired = JSON.parse(repaired.repaired);
  } catch (err) {
    errors.push(`repair JSON parse failed: ${(err as Error).message}`);
  }

  if (parsedRepaired !== undefined) {
    const validation = validateThreadMetaV3(parsedRepaired);
    if (validation.ok) {
      const summary = raw.slice(0, openMatch.index).trim();
      const v3 = { ...validation.value, _partial: true } as ThreadMetaV3 & {
        _partial?: boolean;
      };
      const v2 = projectV3ToV2(v3);
      return {
        summary,
        meta: v3,
        metaV2: v2,
        metaV1: projectV2ToV1(v2),
        errors: [
          ...errors,
          `recovered:repair[${repaired.repairsMade.join(',') || 'none'}]`,
        ],
      };
    }
    for (const e of validation.errors) errors.push(`repair-validate:${e}`);
  }

  // ---- 4. Lenient field extraction (last resort) ----
  const lenient = lenientFieldExtract(truncatedInner);
  if (lenient) {
    // Build a minimal V3-shaped object from the lenient extract, filling
    // gaps with conservative defaults so the validator is happy. Filter out
    // sub items missing id/label/status (validator would otherwise reject
    // the whole object).
    const subRaw = Array.isArray(lenient.partial['sub'])
      ? (lenient.partial['sub'] as unknown[])
      : [];
    const subFiltered = subRaw.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return false;
      const s = item as Record<string, unknown>;
      return (
        typeof s['id'] === 'string' &&
        typeof s['label'] === 'string' &&
        typeof s['status'] === 'string'
      );
    });
    // Filter key_state to only well-formed entries
    const ksRaw = Array.isArray(lenient.partial['key_state'])
      ? (lenient.partial['key_state'] as unknown[])
      : [];
    const ksFiltered = ksRaw.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return false;
      const s = item as Record<string, unknown>;
      return (
        typeof s['kind'] === 'string' &&
        typeof s['value'] === 'string' &&
        typeof s['label'] === 'string'
      );
    });
    const decRaw = Array.isArray(lenient.partial['decisions'])
      ? (lenient.partial['decisions'] as unknown[]).filter(
          (s) => typeof s === 'string',
        )
      : [];
    const oqRaw = Array.isArray(lenient.partial['open_questions'])
      ? (lenient.partial['open_questions'] as unknown[]).filter(
          (s) => typeof s === 'string',
        )
      : [];
    const candidate: Record<string, unknown> = {
      main: lenient.partial['main'] ?? '',
      sub: subFiltered,
      decisions: decRaw,
      open_questions: oqRaw,
    };
    if (ksFiltered.length > 0) {
      candidate['key_state'] = ksFiltered;
    }
    const validation = validateThreadMetaV3(candidate);
    if (validation.ok) {
      const summary = raw.slice(0, openMatch.index).trim();
      const v3 = { ...validation.value, _partial: true } as ThreadMetaV3 & {
        _partial?: boolean;
      };
      const v2 = projectV3ToV2(v3);
      return {
        summary,
        meta: v3,
        metaV2: v2,
        metaV1: projectV2ToV1(v2),
        errors: [
          ...errors,
          `recovered:lenient-extract(sub=${subFiltered.length},ks=${ksFiltered.length})`,
        ],
      };
    }
    for (const e of validation.errors) errors.push(`lenient:${e}`);
  }

  return {
    summary: raw.trim(),
    meta: null,
    metaV2: null,
    metaV1: null,
    errors,
  };
}

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

export function parseCompactionOutputBestEffort(
  raw: string,
): BestEffortParseResult {
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
