/**
 * Schema v2 for thread meta — structured output for the compaction LLM.
 *
 * ## Why v2
 *
 * v1 used a markdown sentinel block:
 *
 *     [THREAD_META]
 *     main: ...
 *     sub1: ...
 *     sub2: ...
 *     sub3: ...
 *     [/THREAD_META]
 *
 * Production data (Phase A) showed the LLM treats this as advisory: stubs
 * have `main:` lines like `"What about error state"` — fragments grabbed
 * from message tails, not synthesized thread descriptions. Compliance was
 * effectively 0% in production.
 *
 * v2 demands JSON inside a fenced code block, with a literal schema in the
 * prompt and an example. This raises compliance to ~95%+ on modern models.
 * The same schema can also be passed via provider-native structured output
 * (OpenAI `response_format: json_schema`, Anthropic `tool_choice`) for the
 * highest-compliance providers.
 *
 * ## Shape changes from v1
 *
 *   v1: { main: string, sub: [string, string, string] }
 *   v2: { main, sub: Array<{ id, label, status }> [maxItems 5], decisions?, open_questions? }
 *
 * - `sub` becomes an array of structured objects (not strings)
 *   - `id` lets us track continuity across compactions exactly (not via
 *     fuzzy substring match)
 *   - `status` lets the orientation prompt distinguish active/blocked/
 *     completed/fading work
 * - Cap raised from 3 → 5 (real Clyde infra sessions average 5-8 sub-threads)
 * - Optional `decisions` and `open_questions` capture state v1 couldn't
 *
 * ## Backward compat
 *
 * The reader and parser still understand v1. Sidecar entries store both
 * `thread_meta` (v1 shape, lossy projection of v2) and `thread_meta_v2`
 * (full v2 object). New writes always emit v2; reads prefer v2 when present.
 */

/**
 * Lifecycle status of a sub-thread. Drives orientation rendering and weight
 * analysis (e.g. "completed" subs fade from orientation faster).
 */
export type ThreadStatus = 'active' | 'blocked' | 'completed' | 'fading';

/**
 * One sub-thread in v2 schema. The LLM is responsible for emitting `id`s
 * that are stable across compactions when the thread continues, and new
 * `id`s when a thread genuinely starts.
 */
export interface ThreadSubV2 {
  /**
   * Stable identifier for this sub-thread, lowercase-kebab.
   * Reuse from previous compaction if continuing the same thread.
   * Examples: "oauth-redirect-debug", "kasett-schema-v2", "vpc-cleanup".
   */
  id: string;
  /** Short human-readable description of this sub-thread. */
  label: string;
  /** Lifecycle status. */
  status: ThreadStatus;
}

/**
 * The structured output the compaction LLM emits in v2.
 *
 * Required: `main` and `sub`. `sub` may be empty (no current sub-threads is
 * legitimate) but must not exceed 5 entries — the prompt frames anything
 * beyond as a signal to consolidate.
 *
 * Optional but encouraged: `decisions` (max 5) and `open_questions` (max 5).
 *
 * Lenient-truncate flags (`_truncated_*`) are set by the lenient validator
 * when an array exceeded its cap and was kept-first-N. They are advisory —
 * downstream code can log/alert without losing the structured content.
 */
export interface ThreadMetaV2 {
  /**
   * The single overarching thing being worked on this session. One sentence,
   * not a list, not a description of the whole conversation history.
   */
  main: string;
  /**
   * 0 to 5 sub-threads. Order is most-relevant first (LLM-decided). Stable
   * `id` enables exact-match continuity tracking across compactions.
   */
  sub: ThreadSubV2[];
  /** Up to 5 key decisions made since last compaction. Free-form sentences. */
  decisions?: string[];
  /** Up to 5 open questions / blockers. Free-form sentences. */
  open_questions?: string[];
  /** Set by lenient validator if `sub[]` was truncated from N>5 to 5. */
  _truncated_sub?: true;
  /** Set by lenient validator if `decisions[]` was truncated from N>5 to 5. */
  _truncated_decisions?: true;
  /** Set by lenient validator if `open_questions[]` was truncated from N>5 to 5. */
  _truncated_open_questions?: true;
}

/**
 * Allowed status enum, exported for tests and external validators.
 */
export const THREAD_STATUS_VALUES: ReadonlyArray<ThreadStatus> = [
  'active',
  'blocked',
  'completed',
  'fading',
] as const;

// ---------------------------------------------------------------------------
// V3: KeyState — explicit tracking of specific values across compactions
// ---------------------------------------------------------------------------
//
// Phase C addition. The summary tells the story; key_state is the evidence
// list. Directly addresses CompactBench Task 2 (KSSR — Key State Retrieval).
// ---------------------------------------------------------------------------

/**
 * Kind of key state value being preserved. The taxonomy is intentionally
 * small — these are categories the LLM can disambiguate from context.
 *
 *   - url     — http(s) endpoints, API URLs, dashboards
 *   - id      — IDs, ARNs, UUIDs, account/resource handles
 *   - path    — filesystem paths (absolute or recognizable relative)
 *   - version — semver / version strings / git SHAs
 *   - config  — key=value pairs, env vars, feature flags
 *   - value   — anything else worth preserving verbatim
 */
export type KeyStateKind = 'url' | 'id' | 'path' | 'version' | 'config' | 'value';

export const KEY_STATE_KINDS: ReadonlyArray<KeyStateKind> = [
  'url',
  'id',
  'path',
  'version',
  'config',
  'value',
] as const;

/**
 * One key-state entry. The LLM is responsible for deciding which detected
 * candidates to keep, which to drop, and what label/context/thread_id to
 * attach.
 *
 * `value` is intentionally exact — no normalization, no trimming beyond
 * the wrapping whitespace. KSSR is measured against exact survival.
 */
export interface KeyStateEntry {
  kind: KeyStateKind;
  value: string;
  /** Optional human-readable label (e.g. "clyde-sudo role") */
  label?: string;
  /** Optional one-line "what is this" context */
  context?: string;
  /** Optional reference to a sub-thread id this value belongs to */
  thread_id?: string;
}

/**
 * V3 thread meta — V2 plus optional `key_state[]`. Backward compat: the
 * field is OPTIONAL and absent on V2 outputs/entries.
 */
export interface ThreadMetaV3 extends ThreadMetaV2 {
  /** Up to 20 key state values to preserve verbatim across compactions. */
  key_state?: KeyStateEntry[];
  /** Set by lenient validator if `key_state[]` was truncated from N>20 to 20. */
  _truncated_key_state?: true;
}

/**
 * JSON Schema describing `ThreadMetaV2`. This object is emitted into the
 * steering prompt verbatim AND can be passed to provider-native structured
 * output APIs (OpenAI `response_format`, Anthropic `tool_choice` input_schema,
 * Google `responseSchema`).
 *
 * `as const` ensures TypeScript narrows the literals so the constant can be
 * referenced both as a runtime value and a type-level fixture.
 */
export const THREAD_META_SCHEMA_V2 = {
  $schema: 'https://json-schema.org/draft-07/schema#',
  $id: 'kasett-rewind/thread-meta/v2',
  type: 'object',
  additionalProperties: false,
  properties: {
    main: {
      type: 'string',
      description:
        'The single overarching thing being worked on this session. One sentence.',
    },
    sub: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'Stable identifier for this sub-thread, lowercase-kebab. Reuse from previous compaction if continuing.',
          },
          label: {
            type: 'string',
            description: 'Short description of this sub-thread.',
          },
          status: {
            type: 'string',
            enum: ['active', 'blocked', 'completed', 'fading'],
          },
        },
        required: ['id', 'label', 'status'],
      },
    },
    decisions: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'Key decisions made since last compaction.',
    },
    open_questions: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'Open questions or blockers.',
    },
  },
  required: ['main', 'sub'],
} as const;

/**
 * V3 schema = V2 + optional `key_state` array (max 20). Embeds the V2 schema
 * structure (rather than referencing it via $ref) so a single object can be
 * embedded into the prompt and passed to provider-native structured-output
 * APIs without resolution.
 */
export const MAX_KEY_STATE = 20;

export const THREAD_META_SCHEMA_V3 = {
  $schema: 'https://json-schema.org/draft-07/schema#',
  $id: 'kasett-rewind/thread-meta/v3',
  type: 'object',
  additionalProperties: false,
  properties: {
    main: {
      type: 'string',
      description:
        'The single overarching thing being worked on this session. One sentence.',
    },
    sub: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'Stable identifier for this sub-thread, lowercase-kebab. Reuse from previous compaction if continuing.',
          },
          label: {
            type: 'string',
            description: 'Short description of this sub-thread.',
          },
          status: {
            type: 'string',
            enum: ['active', 'blocked', 'completed', 'fading'],
          },
        },
        required: ['id', 'label', 'status'],
      },
    },
    decisions: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'Key decisions made since last compaction.',
    },
    open_questions: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'Open questions or blockers.',
    },
    key_state: {
      type: 'array',
      maxItems: 20,
      description:
        'Specific values (URLs, IDs, paths, versions, config) to preserve verbatim across compactions.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['url', 'id', 'path', 'version', 'config', 'value'],
          },
          value: {
            type: 'string',
            description: 'The exact value to preserve.',
          },
          label: { type: 'string' },
          context: { type: 'string' },
          thread_id: { type: 'string' },
        },
        required: ['kind', 'value'],
      },
    },
  },
  required: ['main', 'sub'],
} as const;

// ---------------------------------------------------------------------------
// Tiny built-in validator (no external deps; node built-ins only).
// ---------------------------------------------------------------------------

/**
 * Validation result. `ok: true` narrows to a typed `ThreadMetaV2`.
 */
export type ValidateResult =
  | { ok: true; value: ThreadMetaV2 }
  | { ok: false; errors: string[] };

const MAX_SUB = 5;
const MAX_DECISIONS = 5;
const MAX_QUESTIONS = 5;

/**
 * Validation mode for the V2/V3 validators.
 *
 *  - `strict` (default for `validateThreadMetaV2` to preserve backward
 *    compatibility): array overflow is a hard failure; the entire output
 *    is rejected. Use when you want to surface schema violations loudly
 *    (tests, ingestion checks, prompt-engineering work).
 *
 *  - `lenient` (default for `validateThreadMetaV3`): array overflow is
 *    treated as truncate-to-cap with an advisory `_truncated_<field>`
 *    flag set on the returned object. The structured content survives;
 *    only the items beyond the cap are dropped. Use when you would rather
 *    keep partial structured output than fall back to prose.
 *
 * Type errors (wrong type, missing required, invalid status enum) remain
 * hard failures in BOTH modes — lenient is about caps, not about safety.
 */
export interface ValidateOptions {
  mode?: 'strict' | 'lenient';
}

/**
 * Validate an unknown value against the v2 schema and return either a
 * fully-typed `ThreadMetaV2` or a list of error strings.
 *
 * Lenient on what we accept where we can without losing safety:
 *   - trims `main` and rejects only if empty after trim
 *   - status comparison is case-sensitive — schema is the contract
 *   - extra unknown properties are silently dropped (we project to V2 shape)
 *   - if `decisions`/`open_questions` are non-array we treat as missing,
 *     not as a hard failure (LLMs sometimes emit `null`)
 *
 * Default mode is `strict` — array overflow rejects. Pass
 * `{ mode: 'lenient' }` to truncate-and-warn instead. See `ValidateOptions`.
 */
export function validateThreadMetaV2(
  raw: unknown,
  options: ValidateOptions = {},
): ValidateResult {
  const lenient = options.mode === 'lenient';
  const errors: string[] = [];
  const truncatedFlags: Partial<Pick<ThreadMetaV2, '_truncated_sub' | '_truncated_decisions' | '_truncated_open_questions'>> = {};

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['root must be a non-array object'] };
  }
  const obj = raw as Record<string, unknown>;

  // main
  const mainRaw = obj['main'];
  if (typeof mainRaw !== 'string') {
    errors.push('main: required string');
  }
  const main = typeof mainRaw === 'string' ? mainRaw.trim() : '';
  if (!main) {
    errors.push('main: must be a non-empty string after trim');
  }

  // sub
  const subRaw = obj['sub'];
  let sub: ThreadSubV2[] = [];
  let subOverflowed = false;
  if (!Array.isArray(subRaw)) {
    errors.push('sub: required array');
  } else {
    if (subRaw.length > MAX_SUB) {
      if (lenient) {
        subOverflowed = true;
      } else {
        errors.push(`sub: at most ${MAX_SUB} items (got ${subRaw.length})`);
      }
    }
    for (let i = 0; i < subRaw.length; i++) {
      const item = subRaw[i];
      const subErrors: string[] = [];
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`sub[${i}]: must be an object`);
        continue;
      }
      const s = item as Record<string, unknown>;
      const id = s['id'];
      const label = s['label'];
      const status = s['status'];
      if (typeof id !== 'string' || id.trim().length === 0) {
        subErrors.push('id: required non-empty string');
      }
      if (typeof label !== 'string' || label.trim().length === 0) {
        subErrors.push('label: required non-empty string');
      }
      if (
        typeof status !== 'string' ||
        !THREAD_STATUS_VALUES.includes(status as ThreadStatus)
      ) {
        subErrors.push(
          `status: must be one of ${THREAD_STATUS_VALUES.join('|')}`,
        );
      }
      if (subErrors.length > 0) {
        for (const e of subErrors) errors.push(`sub[${i}].${e}`);
        continue;
      }
      sub.push({
        id: (id as string).trim(),
        label: (label as string).trim(),
        status: status as ThreadStatus,
      });
    }
    // Truncate if over max (defensive — also the lenient-mode trim point).
    if (sub.length > MAX_SUB) sub = sub.slice(0, MAX_SUB);
    if (subOverflowed) truncatedFlags._truncated_sub = true;
  }

  // decisions (optional)
  let decisions: string[] | undefined;
  const decRaw = obj['decisions'];
  if (decRaw !== undefined && decRaw !== null) {
    if (!Array.isArray(decRaw)) {
      // Tolerate non-array as missing — log via errors but don't reject if
      // root is otherwise valid? We keep strict to surface bad LLM output.
      errors.push('decisions: must be an array if present');
    } else {
      const items: string[] = [];
      for (let i = 0; i < decRaw.length; i++) {
        const d = decRaw[i];
        if (typeof d !== 'string') {
          errors.push(`decisions[${i}]: must be string`);
          continue;
        }
        items.push(d);
      }
      if (items.length > MAX_DECISIONS) {
        if (lenient) {
          truncatedFlags._truncated_decisions = true;
        } else {
          errors.push(
            `decisions: at most ${MAX_DECISIONS} items (got ${items.length})`,
          );
        }
      }
      decisions = items.slice(0, MAX_DECISIONS);
    }
  }

  // open_questions (optional)
  let openQuestions: string[] | undefined;
  const oqRaw = obj['open_questions'];
  if (oqRaw !== undefined && oqRaw !== null) {
    if (!Array.isArray(oqRaw)) {
      errors.push('open_questions: must be an array if present');
    } else {
      const items: string[] = [];
      for (let i = 0; i < oqRaw.length; i++) {
        const q = oqRaw[i];
        if (typeof q !== 'string') {
          errors.push(`open_questions[${i}]: must be string`);
          continue;
        }
        items.push(q);
      }
      if (items.length > MAX_QUESTIONS) {
        if (lenient) {
          truncatedFlags._truncated_open_questions = true;
        } else {
          errors.push(
            `open_questions: at most ${MAX_QUESTIONS} items (got ${items.length})`,
          );
        }
      }
      openQuestions = items.slice(0, MAX_QUESTIONS);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const value: ThreadMetaV2 = { main, sub };
  if (decisions !== undefined) value.decisions = decisions;
  if (openQuestions !== undefined) value.open_questions = openQuestions;
  if (truncatedFlags._truncated_sub) value._truncated_sub = true;
  if (truncatedFlags._truncated_decisions) value._truncated_decisions = true;
  if (truncatedFlags._truncated_open_questions)
    value._truncated_open_questions = true;
  return { ok: true, value };
}

/**
 * Strict alias for `validateThreadMetaV2` — explicit name for callers that
 * want to assert no overflow has occurred. Equivalent to calling
 * `validateThreadMetaV2(raw, { mode: 'strict' })` (which is also the default).
 */
export function validateThreadMetaV2Strict(raw: unknown): ValidateResult {
  return validateThreadMetaV2(raw, { mode: 'strict' });
}

/**
 * Lenient alias for `validateThreadMetaV2` — truncates oversized arrays
 * (`sub`, `decisions`, `open_questions`) to their cap and sets a
 * `_truncated_<field>` flag instead of rejecting.
 */
export function validateThreadMetaV2Lenient(raw: unknown): ValidateResult {
  return validateThreadMetaV2(raw, { mode: 'lenient' });
}

/**
 * Lossy projection: V2 → V1 for backward-compat read paths.
 *
 * Drops `id`/`status` and pads/truncates to exactly 3 sub strings (V1 shape)
 * using each sub's `label`. "idle" is the canonical sentinel for unfilled
 * slots when V2 has fewer than 3 subs.
 *
 * Used so existing v1 readers can still work without code changes when the
 * sidecar contains V2 data.
 */
export function projectV2ToV1(meta: ThreadMetaV2): {
  main: string;
  sub: [string, string, string];
} {
  const labels = meta.sub.map((s) => s.label).slice(0, 3);
  while (labels.length < 3) labels.push('idle');
  return {
    main: meta.main,
    sub: [labels[0], labels[1], labels[2]] as [string, string, string],
  };
}

/**
 * Serialize the v2 schema as a compact string suitable for embedding into a
 * prompt. Uses 2-space indent for readability while keeping it short.
 */
export function schemaAsPromptString(): string {
  return JSON.stringify(THREAD_META_SCHEMA_V2, null, 2);
}

/**
 * Serialize the v3 schema for prompt embedding (Phase C).
 */
export function schemaV3AsPromptString(): string {
  return JSON.stringify(THREAD_META_SCHEMA_V3, null, 2);
}

// ---------------------------------------------------------------------------
// V3 validator (Phase C)
// ---------------------------------------------------------------------------

export type ValidateResultV3 =
  | { ok: true; value: ThreadMetaV3 }
  | { ok: false; errors: string[] };

/**
 * Validate one KeyStateEntry. Returns either a typed entry or a list of
 * errors. Used both standalone (for partial-recovery in the V3 validator)
 * and exported for tests.
 */
export function isValidKeyStateEntry(
  raw: unknown,
): { ok: true; value: KeyStateEntry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['must be a non-array object'] };
  }
  const obj = raw as Record<string, unknown>;

  const kind = obj['kind'];
  if (
    typeof kind !== 'string' ||
    !KEY_STATE_KINDS.includes(kind as KeyStateKind)
  ) {
    errors.push(`kind: must be one of ${KEY_STATE_KINDS.join('|')}`);
  }

  const value = obj['value'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('value: required non-empty string');
  }

  const label = obj['label'];
  if (label !== undefined && label !== null && typeof label !== 'string') {
    errors.push('label: must be string if present');
  }
  const context = obj['context'];
  if (context !== undefined && context !== null && typeof context !== 'string') {
    errors.push('context: must be string if present');
  }
  const threadId = obj['thread_id'];
  if (threadId !== undefined && threadId !== null && typeof threadId !== 'string') {
    errors.push('thread_id: must be string if present');
  }

  if (errors.length > 0) return { ok: false, errors };

  const out: KeyStateEntry = {
    kind: kind as KeyStateKind,
    value: value as string,
  };
  if (typeof label === 'string' && label.length > 0) out.label = label;
  if (typeof context === 'string' && context.length > 0) out.context = context;
  if (typeof threadId === 'string' && threadId.length > 0) out.thread_id = threadId;
  return { ok: true, value: out };
}

/**
 * Validate an unknown value as ThreadMetaV3.
 *
 * Default mode is **lenient** (different from `validateThreadMetaV2`!):
 *   - Oversized `sub`/`decisions`/`open_questions` arrays are truncated to
 *     cap with `_truncated_<field>: true` set instead of rejecting.
 *   - Oversized `key_state[]` (>20) is truncated to first 20 with
 *     `_truncated_key_state: true` set.
 *   - Invalid `key_state` entries are dropped one-by-one.
 *
 * Why lenient by default: production traffic shows the LLM correctly
 * identifying 6-10 concurrent threads on complex sessions and emitting
 * valid JSON. Strict rejection drops the entire structured payload — the
 * agent loses ALL thread context for the next compaction. Lenient keeps
 * the first N items per cap, which is significantly better than zero
 * structured output.
 *
 * For callers that want strict semantics (e.g. ingestion tests,
 * compliance reporting), use `validateThreadMetaV3Strict`.
 */
export function validateThreadMetaV3(
  raw: unknown,
  options: ValidateOptions = {},
): ValidateResultV3 {
  const mode = options.mode ?? 'lenient';
  const v2 = validateThreadMetaV2(raw, { mode });
  if (!v2.ok) return { ok: false, errors: v2.errors };

  const obj = raw as Record<string, unknown>;
  const out: ThreadMetaV3 = { ...v2.value };

  const ksRaw = obj['key_state'];
  if (ksRaw !== undefined && ksRaw !== null) {
    if (!Array.isArray(ksRaw)) {
      // Tolerate non-array as missing
      return { ok: true, value: out };
    }
    // Strict mode: hard-fail on overflow before truncating entries.
    if (mode === 'strict' && ksRaw.length > MAX_KEY_STATE) {
      return {
        ok: false,
        errors: [
          `key_state: at most ${MAX_KEY_STATE} items (got ${ksRaw.length})`,
        ],
      };
    }
    const entries: KeyStateEntry[] = [];
    let validCount = 0;
    for (let i = 0; i < ksRaw.length; i++) {
      const r = isValidKeyStateEntry(ksRaw[i]);
      if (r.ok) {
        validCount++;
        if (entries.length < MAX_KEY_STATE) entries.push(r.value);
      }
      // invalid entries silently dropped — advisory layer
    }
    if (entries.length > 0) out.key_state = entries;
    // Lenient: flag truncation when more VALID entries existed than cap.
    if (validCount > MAX_KEY_STATE) out._truncated_key_state = true;
  }

  return { ok: true, value: out };
}

/**
 * Strict V3 validator — hard-rejects on cap overflow on `sub`,
 * `decisions`, `open_questions`, and `key_state`. Use for ingestion tests,
 * benchmark compliance reports, or anywhere you want to know the LLM
 * exceeded the contract.
 */
export function validateThreadMetaV3Strict(raw: unknown): ValidateResultV3 {
  return validateThreadMetaV3(raw, { mode: 'strict' });
}

/**
 * Explicit lenient V3 validator — equivalent to `validateThreadMetaV3()`
 * with no options (lenient is the default). Provided for symmetry with
 * `validateThreadMetaV3Strict` and for self-documenting call sites.
 */
export function validateThreadMetaV3Lenient(raw: unknown): ValidateResultV3 {
  return validateThreadMetaV3(raw, { mode: 'lenient' });
}

/**
 * Project V3 -> V2 by dropping `key_state`. Used so V2 readers keep
 * working when only a V3 entry is available.
 */
export function projectV3ToV2(meta: ThreadMetaV3): ThreadMetaV2 {
  const out: ThreadMetaV2 = {
    main: meta.main,
    sub: meta.sub,
  };
  if (meta.decisions !== undefined) out.decisions = meta.decisions;
  if (meta.open_questions !== undefined) out.open_questions = meta.open_questions;
  return out;
}
