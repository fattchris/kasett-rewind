/**
 * Phase G — Window-aggregated continuity hints.
 *
 * Tests `aggregateContinuityHints` (the pure helper extracted from
 * `buildCompactionContext`) to verify that previousSubIds, coreSubIds,
 * and previousKeyState are aggregated across the FULL window of previous
 * summaries — not just the most recent one.
 *
 * Also verifies that when the aggregated hints are passed to
 * `buildSteeringPrompt`, the resulting prompt highlights "core" sub-thread
 * IDs that have appeared in 2+ previous compactions.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateContinuityHints } from '../index.js';
import { buildSteeringPrompt } from '../threads/steering.js';
import { weightSummaries } from '../threads/weight.js';
function fakeSummary(shape) {
    const meta = {
        main: shape.main,
        sub: shape.subs.map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status ?? 'active',
        })),
        decisions: [],
        open_questions: [],
        key_state: shape.keyState ?? [],
    };
    return [
        `Narrative: ${shape.main}.`,
        '',
        '```json',
        JSON.stringify(meta, null, 2),
        '```',
    ].join('\n');
}
// ---------------------------------------------------------------------------
describe('aggregateContinuityHints — empty / single-summary cases', () => {
    test('empty input returns empty object', () => {
        const out = aggregateContinuityHints([]);
        assert.deepEqual(out, {});
    });
    test('single summary: previousSubIds preserved, no coreSubIds', () => {
        const s = fakeSummary({
            main: 'OAuth migration',
            subs: [
                { id: 'oauth-flow', label: 'OAuth flow' },
                { id: 'rate-limit', label: 'Rate limiting' },
            ],
            keyState: [{ kind: 'url', value: 'https://example.com' }],
        });
        const out = aggregateContinuityHints([s]);
        assert.deepEqual(out.previousSubIds, ['oauth-flow', 'rate-limit']);
        assert.equal(out.coreSubIds, undefined, 'no IDs recur in a single-summary window');
        assert.equal(out.previousKeyState?.length, 1);
        assert.equal(out.previousKeyState?.[0].value, 'https://example.com');
    });
    test('summary without parsable thread meta yields no hints', () => {
        const out = aggregateContinuityHints(['just a plain narrative with no JSON block']);
        assert.equal(out.previousSubIds, undefined);
        assert.equal(out.coreSubIds, undefined);
        assert.equal(out.previousKeyState, undefined);
    });
});
describe('aggregateContinuityHints — window aggregation (multi-summary)', () => {
    test('IDs appearing in multiple summaries are aggregated and ordered by frequency', () => {
        // Most-recent-first: window of 3 summaries.
        const s0 = fakeSummary({
            main: 'C3 — current',
            subs: [
                { id: 'oauth-flow', label: 'OAuth flow' },
                { id: 'monitoring', label: 'Monitoring' },
            ],
        });
        const s1 = fakeSummary({
            main: 'C2 — middle',
            subs: [
                { id: 'oauth-flow', label: 'OAuth flow' },
                { id: 'rate-limit', label: 'Rate limiting' },
            ],
        });
        const s2 = fakeSummary({
            main: 'C1 — earliest',
            subs: [
                { id: 'oauth-flow', label: 'OAuth setup' },
                { id: 'rate-limit', label: 'Rate limiting' },
                { id: 'cred-storage', label: 'Credential storage' },
            ],
        });
        const out = aggregateContinuityHints([s0, s1, s2]);
        // All distinct IDs surface
        assert.ok(out.previousSubIds);
        const ids = new Set(out.previousSubIds);
        assert.ok(ids.has('oauth-flow'));
        assert.ok(ids.has('rate-limit'));
        assert.ok(ids.has('monitoring'));
        assert.ok(ids.has('cred-storage'));
        assert.equal(ids.size, 4);
        // Sorted by frequency descending: oauth-flow=3, rate-limit=2, others=1.
        // The first slot must be the highest-frequency ID.
        assert.equal(out.previousSubIds[0], 'oauth-flow');
        // rate-limit (freq=2) must come before monitoring/cred-storage (freq=1).
        const rateIdx = out.previousSubIds.indexOf('rate-limit');
        const monIdx = out.previousSubIds.indexOf('monitoring');
        const credIdx = out.previousSubIds.indexOf('cred-storage');
        assert.ok(rateIdx < monIdx, 'rate-limit (freq=2) should outrank monitoring (freq=1)');
        assert.ok(rateIdx < credIdx, 'rate-limit (freq=2) should outrank cred-storage (freq=1)');
        // coreSubIds: only IDs with freq >= 2.
        assert.deepEqual(new Set(out.coreSubIds), new Set(['oauth-flow', 'rate-limit']));
        // Order is also frequency-descending.
        assert.equal(out.coreSubIds[0], 'oauth-flow');
    });
    test('key_state values are deduped across the window', () => {
        const s0 = fakeSummary({
            main: 'C2',
            subs: [{ id: 't', label: 'T' }],
            keyState: [
                { kind: 'url', value: 'https://app.example.com', label: 'app url' },
                { kind: 'id', value: 'arn:aws:kms:::key/abc' },
            ],
        });
        const s1 = fakeSummary({
            main: 'C1',
            subs: [{ id: 't', label: 'T' }],
            keyState: [
                { kind: 'url', value: 'https://app.example.com', label: 'staging url' }, // same kind+value
                { kind: 'path', value: 's3://bucket/key' },
            ],
        });
        const out = aggregateContinuityHints([s0, s1]);
        assert.ok(out.previousKeyState);
        // 3 distinct (kind, value) pairs after dedup.
        assert.equal(out.previousKeyState.length, 3);
        const values = out.previousKeyState.map((k) => k.value);
        assert.ok(values.includes('https://app.example.com'));
        assert.ok(values.includes('arn:aws:kms:::key/abc'));
        assert.ok(values.includes('s3://bucket/key'));
        // The id kind should be present
        assert.ok(out.previousKeyState.some((k) => k.kind === 'id' && k.value === 'arn:aws:kms:::key/abc'));
        // The de-duped url entry should be the most-recent one (s0's "app url"),
        // since s0 is most-recent-first and first-seen wins.
        const urlEntry = out.previousKeyState.find((k) => k.kind === 'url');
        assert.equal(urlEntry?.label, 'app url');
    });
    test('summary with empty thread meta is gracefully skipped', () => {
        const s0 = fakeSummary({
            main: 'C2',
            subs: [{ id: 'a', label: 'A' }],
        });
        const out = aggregateContinuityHints([s0, '   ', '']);
        assert.deepEqual(out.previousSubIds, ['a']);
        assert.equal(out.coreSubIds, undefined);
    });
});
describe('buildSteeringPrompt — surfaces aggregated hints', () => {
    test('coreSubIds appears in the steering prompt as a strong-preserve hint', () => {
        const weighted = weightSummaries(['most recent', 'middle', 'oldest'], [1.0, 0.6, 0.3]);
        const prompt = buildSteeringPrompt(weighted, {
            structuredOutput: 'json',
            previousSubIds: ['oauth-flow', 'rate-limit', 'monitoring'],
            coreSubIds: ['oauth-flow', 'rate-limit'],
        });
        assert.ok(prompt.includes('Previous sub-thread IDs'));
        assert.ok(prompt.includes('CORE sub-thread IDs'));
        assert.ok(prompt.includes('"oauth-flow"'));
        assert.ok(prompt.includes('"rate-limit"'));
        // The "appeared in MULTIPLE previous compactions" phrase signals the
        // strong-preserve guidance.
        assert.ok(prompt.includes('appeared in MULTIPLE previous compactions'), 'prompt should label core IDs as durable threads');
    });
    test('without coreSubIds, the prompt still lists previousSubIds without core callout', () => {
        const weighted = weightSummaries(['s'], [1.0]);
        const prompt = buildSteeringPrompt(weighted, {
            structuredOutput: 'json',
            previousSubIds: ['only-once'],
        });
        assert.ok(prompt.includes('"only-once"'));
        assert.ok(!prompt.includes('CORE sub-thread IDs'));
    });
});
//# sourceMappingURL=index-window-aggregation.test.js.map