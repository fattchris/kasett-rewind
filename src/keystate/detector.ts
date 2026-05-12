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

import type { KeyStateEntry, KeyStateKind } from '../threads/schema.js';

export interface ConversationTurn {
  role: string;
  content: unknown;
}

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------
//
// Each pattern is `g`-flagged so we can iterate matches with `matchAll`.
// Patterns are tuned to typical agent conversation (markdown, code blocks,
// quoted strings) so we strip trailing punctuation in post.
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

// AWS ARN: arn:aws:<service>:<region>:<account>:<resource>
const ARN_RE = /arn:aws[a-z0-9-]*:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[A-Za-z0-9_./*-]+/g;

// AWS resource IDs: i-*, vpc-*, subnet-*, sg-*, ami-*, fs-*, fsmt-*, eip-*,
// rt-*, igw-*, nat-*, eni-*, acl-*, dopt-*, snap-*, vol-*, etc.
const AWS_RESOURCE_RE = /\b(?:i|vpc|subnet|sg|ami|fs|fsmt|eip|rt|igw|nat|eni|acl|dopt|snap|vol|tgw|pcx|vpce)-[a-f0-9]{8,17}\b/g;

// Standard 8-4-4-4-12 UUID. Case-insensitive.
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

// Git commit SHA: 7-40 lowercase hex. Anchored on word boundaries.
const GIT_SHA_RE = /\b[a-f0-9]{7,40}\b/g;

// Absolute path: starts with /, contains at least 2 slashes total, length >= 5.
// Drops trailing punctuation common in prose.
const PATH_RE = /(?:^|[^A-Za-z0-9_])(\/[A-Za-z0-9_./\-]+\/[A-Za-z0-9_.\-]+)/g;

// Semver-ish: 1.2 / 1.2.3 / v1.2.3 / 1.2.3-rc.1 / 1.2.3+build5 / 1.2.3-beta1
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?\b/g;

// Env-style config: KEY=value where KEY is upper-snake (>=2 chars).
// Captures the entire token. Stops at whitespace.
const CONFIG_RE = /\b[A-Z][A-Z0-9_]{1,}=[^\s'"`]+/g;

// Known model identifiers / providers (kept small — we'd rather miss novel
// model names than catch every word).
const MODEL_RE = /\b(?:claude-(?:opus|sonnet|haiku)-[0-9]+(?:-[0-9]+)?(?:-[0-9]{6,8})?|gpt-[0-9]+(?:\.[0-9]+)?(?:-(?:o|preview|turbo|mini))?|o[1-4](?:-(?:mini|preview))?|gemini-[0-9]+\.[0-9]+(?:-(?:flash|pro|preview))?(?:-[a-z0-9]+)?|kimi-k[0-9]+(?:\.[0-9]+)?(?:-[a-z0-9]+)?|deepseek-(?:chat|coder|v[0-9]+)|llama-[0-9]+(?:b)?|mistral-(?:small|medium|large|nemo)|qwen-?[0-9]+(?:b)?)\b/gi;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect candidate key-state values in a conversation history.
 *
 * Operates on the concatenated text of all message contents. Deduplicates by
 * (kind, value) pair — the same path mentioned five times produces one entry.
 *
 * Returns entries in detection priority order (most specific first). Caller
 * may further trim to a budget.
 */
export function detectCandidateKeyState(
  messages: ConversationTurn[],
): KeyStateEntry[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const corpus = flattenMessages(messages);
  return detectInString(corpus);
}

/**
 * Run detection against a raw string (used by tests and the kssr measurer).
 */
export function detectInString(corpus: string): KeyStateEntry[] {
  if (!corpus) return [];
  const seen = new Map<string, KeyStateEntry>();

  const add = (kind: KeyStateKind, raw: string): void => {
    const value = stripTrailingPunct(raw);
    if (!value) return;
    const key = `${kind}\x00${value}`;
    if (!seen.has(key)) seen.set(key, { kind, value });
  };

  // Track which character ranges are already "claimed" by a higher-priority
  // match so we don't double-classify (e.g. UUID also matches GIT_SHA hex).
  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && end > s);
  const claim = (start: number, end: number): void => {
    claimed.push([start, end]);
  };

  // Order: URL > ARN > AWS resource > UUID > path > config > version >
  //        model > git-sha (last because it's most permissive).

  for (const m of corpus.matchAll(URL_RE)) {
    if (m.index === undefined) continue;
    const v = stripTrailingPunct(m[0]);
    if (!v) continue;
    add('url', v);
    claim(m.index, m.index + v.length);
  }

  for (const m of corpus.matchAll(ARN_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add('id', m[0]);
    claim(m.index, m.index + m[0].length);
  }

  for (const m of corpus.matchAll(AWS_RESOURCE_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add('id', m[0]);
    claim(m.index, m.index + m[0].length);
  }

  for (const m of corpus.matchAll(UUID_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add('id', m[0]);
    claim(m.index, m.index + m[0].length);
  }

  // Paths: regex starts with a non-word char, work with the capture group
  for (const m of corpus.matchAll(PATH_RE)) {
    if (m.index === undefined) continue;
    const captured = m[1];
    if (!captured) continue;
    const offset = m.index + (m[0].length - captured.length);
    if (overlaps(offset, offset + captured.length)) continue;
    if (captured.length < 5) continue;
    if ((captured.match(/\//g) || []).length < 2) continue;
    const v = stripTrailingPunct(captured);
    if (!v) continue;
    add('path', v);
    claim(offset, offset + v.length);
  }

  for (const m of corpus.matchAll(CONFIG_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add('config', m[0]);
    claim(m.index, m.index + m[0].length);
  }

  for (const m of corpus.matchAll(VERSION_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    // Filter: a bare "1.0" or "3.14" is too noisy; require `v` prefix,
    // third dot-component, or a -suffix.
    const tok = m[0];
    const hasV = tok.startsWith('v') || tok.startsWith('V');
    const dotCount = (tok.match(/\./g) || []).length;
    const hasSuffix = /[-+]/.test(tok);
    if (!hasV && dotCount < 2 && !hasSuffix) continue;
    add('version', tok);
    claim(m.index, m.index + tok.length);
  }

  for (const m of corpus.matchAll(MODEL_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add('version', m[0]);
    claim(m.index, m.index + m[0].length);
  }

  for (const m of corpus.matchAll(GIT_SHA_RE)) {
    if (m.index === undefined) continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const tok = m[0];
    if (/^\d+$/.test(tok)) continue;       // pure digits: timestamp, not SHA
    if (!/[0-9]/.test(tok)) continue;      // pure letters: noise
    add('id', tok);
    claim(m.index, m.index + tok.length);
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten conversation messages into a single newline-joined string for
 * regex scanning. Handles common content shapes (string, {text}, arrays,
 * misc objects via JSON.stringify).
 */
export function flattenMessages(messages: ConversationTurn[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (!m) continue;
    parts.push(stringifyContent(m.content));
  }
  return parts.join('\n');
}

function stringifyContent(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') {
    return String(content);
  }
  if (Array.isArray(content)) {
    return content.map(stringifyContent).join('\n');
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    try {
      return JSON.stringify(obj);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Strip trailing punctuation that's almost always part of the surrounding
 * prose, not the value: `. , ; : ! ? ) ] > } ' " backtick`. Keeps `/`.
 */
function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:!?)\]>}'"`]+$/, '');
}
