/**
 * detector.ts — Heuristic key-state value detection (Phase C).
 *
 * Scans pre-compaction conversation messages for candidate values worth
 * preserving across compactions. Output feeds the steering prompt as a
 * "values that appeared; preserve the still-relevant ones" hint to the LLM.
 *
 * THIS IS ADVISORY — the LLM decides what to actually keep. The detector
 * uses pure regex (no NLP libs, no external deps) and intentionally errs
 * toward higher recall than precision: false positives cost a few prompt
 * tokens; missed values cost continuity.
 *
 * ## Detected kinds
 *
 *   - url     — http(s) URLs
 *   - id      — UUIDs, AWS resource IDs, AWS ARNs, git SHAs (>=7 hex)
 *   - path    — absolute filesystem paths (>=2 slashes, >=5 chars)
 *   - version — semver-ish strings + small allow-list of known model ids
 *   - config  — KEY=value env style (uppercased key)
 *   - value   — not auto-detected; reserved for the LLM to mint manually
 *
 * Order of detection matters: more specific patterns run first so we don't
 * misclassify (e.g. an AWS ARN should be `id` not `value`).
 *
 * Returned entries have NO label/context/thread_id — those are the LLM's
 * job. The detector only fills `kind` and `value`.
 */
import type { KeyStateEntry } from '../threads/schema.js';
export interface ConversationTurn {
    role: string;
    content: unknown;
}
/**
 * Detect candidate key-state values in a conversation history.
 *
 * Operates on the concatenated text of all message contents. Deduplicates by
 * (kind, value) pair — the same path mentioned five times produces one entry.
 *
 * Returns entries in detection priority order (most specific first). Caller
 * may further trim to a budget.
 */
export declare function detectCandidateKeyState(messages: ConversationTurn[]): KeyStateEntry[];
/**
 * Run detection against a raw string (used by tests and the kssr measurer).
 */
export declare function detectInString(corpus: string): KeyStateEntry[];
/**
 * Flatten conversation messages into a single newline-joined string for
 * regex scanning. Handles common content shapes (string, {text}, arrays,
 * misc objects via JSON.stringify).
 */
export declare function flattenMessages(messages: ConversationTurn[]): string;
//# sourceMappingURL=detector.d.ts.map