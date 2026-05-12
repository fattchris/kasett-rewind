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
}
/**
 * Allowed status enum, exported for tests and external validators.
 */
export declare const THREAD_STATUS_VALUES: ReadonlyArray<ThreadStatus>;
/**
 * JSON Schema describing `ThreadMetaV2`. This object is emitted into the
 * steering prompt verbatim AND can be passed to provider-native structured
 * output APIs (OpenAI `response_format`, Anthropic `tool_choice` input_schema,
 * Google `responseSchema`).
 *
 * `as const` ensures TypeScript narrows the literals so the constant can be
 * referenced both as a runtime value and a type-level fixture.
 */
export declare const THREAD_META_SCHEMA_V2: {
    readonly $schema: "https://json-schema.org/draft-07/schema#";
    readonly $id: "kasett-rewind/thread-meta/v2";
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly main: {
            readonly type: "string";
            readonly description: "The single overarching thing being worked on this session. One sentence.";
        };
        readonly sub: {
            readonly type: "array";
            readonly minItems: 0;
            readonly maxItems: 5;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly description: "Stable identifier for this sub-thread, lowercase-kebab. Reuse from previous compaction if continuing.";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "Short description of this sub-thread.";
                    };
                    readonly status: {
                        readonly type: "string";
                        readonly enum: readonly ["active", "blocked", "completed", "fading"];
                    };
                };
                readonly required: readonly ["id", "label", "status"];
            };
        };
        readonly decisions: {
            readonly type: "array";
            readonly maxItems: 5;
            readonly items: {
                readonly type: "string";
            };
            readonly description: "Key decisions made since last compaction.";
        };
        readonly open_questions: {
            readonly type: "array";
            readonly maxItems: 5;
            readonly items: {
                readonly type: "string";
            };
            readonly description: "Open questions or blockers.";
        };
    };
    readonly required: readonly ["main", "sub"];
};
/**
 * Validation result. `ok: true` narrows to a typed `ThreadMetaV2`.
 */
export type ValidateResult = {
    ok: true;
    value: ThreadMetaV2;
} | {
    ok: false;
    errors: string[];
};
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
 */
export declare function validateThreadMetaV2(raw: unknown): ValidateResult;
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
export declare function projectV2ToV1(meta: ThreadMetaV2): {
    main: string;
    sub: [string, string, string];
};
/**
 * Serialize the v2 schema as a compact string suitable for embedding into a
 * prompt. Uses 2-space indent for readability while keeping it short.
 */
export declare function schemaAsPromptString(): string;
//# sourceMappingURL=schema.d.ts.map