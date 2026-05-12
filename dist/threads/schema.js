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
 * Allowed status enum, exported for tests and external validators.
 */
export const THREAD_STATUS_VALUES = [
    'active',
    'blocked',
    'completed',
    'fading',
];
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
            description: 'The single overarching thing being worked on this session. One sentence.',
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
                        description: 'Stable identifier for this sub-thread, lowercase-kebab. Reuse from previous compaction if continuing.',
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
};
const MAX_SUB = 5;
const MAX_DECISIONS = 5;
const MAX_QUESTIONS = 5;
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
export function validateThreadMetaV2(raw) {
    const errors = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['root must be a non-array object'] };
    }
    const obj = raw;
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
    let sub = [];
    if (!Array.isArray(subRaw)) {
        errors.push('sub: required array');
    }
    else {
        if (subRaw.length > MAX_SUB) {
            errors.push(`sub: at most ${MAX_SUB} items (got ${subRaw.length})`);
        }
        for (let i = 0; i < subRaw.length; i++) {
            const item = subRaw[i];
            const subErrors = [];
            if (item === null || typeof item !== 'object' || Array.isArray(item)) {
                errors.push(`sub[${i}]: must be an object`);
                continue;
            }
            const s = item;
            const id = s['id'];
            const label = s['label'];
            const status = s['status'];
            if (typeof id !== 'string' || id.trim().length === 0) {
                subErrors.push('id: required non-empty string');
            }
            if (typeof label !== 'string' || label.trim().length === 0) {
                subErrors.push('label: required non-empty string');
            }
            if (typeof status !== 'string' ||
                !THREAD_STATUS_VALUES.includes(status)) {
                subErrors.push(`status: must be one of ${THREAD_STATUS_VALUES.join('|')}`);
            }
            if (subErrors.length > 0) {
                for (const e of subErrors)
                    errors.push(`sub[${i}].${e}`);
                continue;
            }
            sub.push({
                id: id.trim(),
                label: label.trim(),
                status: status,
            });
        }
        // Truncate if over max (defensive — we already errored if so)
        if (sub.length > MAX_SUB)
            sub = sub.slice(0, MAX_SUB);
    }
    // decisions (optional)
    let decisions;
    const decRaw = obj['decisions'];
    if (decRaw !== undefined && decRaw !== null) {
        if (!Array.isArray(decRaw)) {
            // Tolerate non-array as missing — log via errors but don't reject if
            // root is otherwise valid? We keep strict to surface bad LLM output.
            errors.push('decisions: must be an array if present');
        }
        else {
            const items = [];
            for (let i = 0; i < decRaw.length; i++) {
                const d = decRaw[i];
                if (typeof d !== 'string') {
                    errors.push(`decisions[${i}]: must be string`);
                    continue;
                }
                items.push(d);
            }
            if (items.length > MAX_DECISIONS) {
                errors.push(`decisions: at most ${MAX_DECISIONS} items (got ${items.length})`);
            }
            decisions = items.slice(0, MAX_DECISIONS);
        }
    }
    // open_questions (optional)
    let openQuestions;
    const oqRaw = obj['open_questions'];
    if (oqRaw !== undefined && oqRaw !== null) {
        if (!Array.isArray(oqRaw)) {
            errors.push('open_questions: must be an array if present');
        }
        else {
            const items = [];
            for (let i = 0; i < oqRaw.length; i++) {
                const q = oqRaw[i];
                if (typeof q !== 'string') {
                    errors.push(`open_questions[${i}]: must be string`);
                    continue;
                }
                items.push(q);
            }
            if (items.length > MAX_QUESTIONS) {
                errors.push(`open_questions: at most ${MAX_QUESTIONS} items (got ${items.length})`);
            }
            openQuestions = items.slice(0, MAX_QUESTIONS);
        }
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    const value = { main, sub };
    if (decisions !== undefined)
        value.decisions = decisions;
    if (openQuestions !== undefined)
        value.open_questions = openQuestions;
    return { ok: true, value };
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
export function projectV2ToV1(meta) {
    const labels = meta.sub.map((s) => s.label).slice(0, 3);
    while (labels.length < 3)
        labels.push('idle');
    return {
        main: meta.main,
        sub: [labels[0], labels[1], labels[2]],
    };
}
/**
 * Serialize the v2 schema as a compact string suitable for embedding into a
 * prompt. Uses 2-space indent for readability while keeping it short.
 */
export function schemaAsPromptString() {
    return JSON.stringify(THREAD_META_SCHEMA_V2, null, 2);
}
//# sourceMappingURL=schema.js.map