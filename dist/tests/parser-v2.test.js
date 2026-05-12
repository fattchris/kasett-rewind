import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompactionOutputV2, parseCompactionOutputBestEffort, } from '../threads/parser.js';
const VALID_V2_JSON = JSON.stringify({
    main: 'OAuth redirect debugging',
    sub: [
        { id: 'github-app-uri', label: 'Update redirect URI', status: 'completed' },
        { id: 'cdk-prod', label: 'Mirror in prod', status: 'blocked' },
    ],
    decisions: ['Pin to ALB DNS'],
});
describe('parseCompactionOutputV2 — happy path', () => {
    test('extracts a fenced ```json block', () => {
        const raw = `Narrative summary of the work done.

\`\`\`json
${VALID_V2_JSON}
\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'OAuth redirect debugging');
        assert.equal(result.meta.sub.length, 2);
        assert.equal(result.meta.sub[0].id, 'github-app-uri');
    });
    test('strips the JSON block from summary', () => {
        const raw = `Narrative line one.\nNarrative line two.\n\n\`\`\`json\n${VALID_V2_JSON}\n\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.equal(result.summary, 'Narrative line one.\nNarrative line two.');
        assert.ok(!result.summary.includes('```'));
    });
    test('produces v1 projection alongside v2', () => {
        const raw = `Summary.\n\n\`\`\`json\n${VALID_V2_JSON}\n\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.ok(result.metaV1);
        assert.equal(result.metaV1.main, 'OAuth redirect debugging');
        assert.equal(result.metaV1.sub[0], 'Update redirect URI');
        assert.equal(result.metaV1.sub[1], 'Mirror in prod');
        assert.equal(result.metaV1.sub[2], 'idle');
    });
    test('accepts case variations in fence language tag', () => {
        const upper = `Summary.\n\n\`\`\`JSON\n${VALID_V2_JSON}\n\`\`\``;
        const mixed = `Summary.\n\n\`\`\`Json\n${VALID_V2_JSON}\n\`\`\``;
        assert.ok(parseCompactionOutputV2(upper).meta);
        assert.ok(parseCompactionOutputV2(mixed).meta);
    });
    test('picks the LAST fence when multiple are present', () => {
        // Simulate the LLM echoing the schema example before its real output
        const earlierExample = JSON.stringify({
            main: 'EXAMPLE main',
            sub: [{ id: 'ex', label: 'ex', status: 'active' }],
        });
        const raw = `Summary intro.

Here is an example of the schema:

\`\`\`json
${earlierExample}
\`\`\`

And here is the real output:

\`\`\`json
${VALID_V2_JSON}
\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'OAuth redirect debugging');
        // Only the last block was stripped; the example block stays in narrative
        assert.ok(result.summary.includes('EXAMPLE main'));
    });
});
describe('parseCompactionOutputV2 — failure paths', () => {
    test('returns null meta when no fenced JSON exists', () => {
        const raw = 'Just a narrative summary, no JSON.';
        const result = parseCompactionOutputV2(raw);
        assert.equal(result.meta, null);
        assert.equal(result.metaV1, null);
        assert.ok(result.errors[0]?.includes('no fenced'));
        assert.equal(result.summary, raw);
    });
    test('returns errors when JSON is malformed', () => {
        const raw = `Summary.\n\n\`\`\`json\n{ "main": "x", "sub": [ }\n\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.equal(result.meta, null);
        assert.ok(result.errors[0]?.includes('JSON parse failed'));
    });
    test('returns errors when JSON parses but fails schema validation', () => {
        const bad = JSON.stringify({ main: 'x', sub: [{ id: 'a', label: 'b' }] }); // missing status
        const raw = `Summary.\n\n\`\`\`json\n${bad}\n\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.equal(result.meta, null);
        assert.ok(result.errors.length > 0);
        assert.ok(result.errors.some((e) => e.includes('status')));
    });
    test('handles empty sub array (valid)', () => {
        const valid = JSON.stringify({ main: 'just main', sub: [] });
        const raw = `Summary.\n\n\`\`\`json\n${valid}\n\`\`\``;
        const result = parseCompactionOutputV2(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.sub.length, 0);
    });
});
describe('parseCompactionOutputBestEffort', () => {
    test('reports v3 when v2-shaped JSON succeeds (V3 is a superset)', () => {
        // Phase C: V3 = V2 + optional key_state. A V2-shaped object validates
        // as V3, so the best-effort parser correctly reports the higher version.
        const raw = `Summary.\n\n\`\`\`json\n${VALID_V2_JSON}\n\`\`\``;
        const result = parseCompactionOutputBestEffort(raw);
        assert.equal(result.version, 'v3');
        assert.ok(result.metaV2);
        assert.ok(result.metaV1); // also populated via projection
    });
    test('reports v1 when only v1 succeeds', () => {
        const raw = `Summary text.

[THREAD_META]
main: legacy markdown thread
sub1: alpha
sub2: beta
sub3: gamma
[/THREAD_META]`;
        const result = parseCompactionOutputBestEffort(raw);
        assert.equal(result.version, 'v1');
        assert.equal(result.metaV2, null);
        assert.ok(result.metaV1);
        assert.equal(result.metaV1.main, 'legacy markdown thread');
    });
    test('reports none when neither succeeds', () => {
        const raw = 'Plain prose, no structured output anywhere.';
        const result = parseCompactionOutputBestEffort(raw);
        assert.equal(result.version, 'none');
        assert.equal(result.metaV1, null);
        assert.equal(result.metaV2, null);
        assert.ok(result.errors.length > 0);
    });
    test('prefers v3 when both structured JSON and v1 sentinel are present', () => {
        // Phase C: V3 (which subsumes V2) wins over V1 markdown sentinel.
        const raw = `Summary.

[THREAD_META]
main: legacy main
sub1: legacy 1
sub2: legacy 2
sub3: legacy 3
[/THREAD_META]

\`\`\`json
${VALID_V2_JSON}
\`\`\``;
        const result = parseCompactionOutputBestEffort(raw);
        assert.equal(result.version, 'v3');
        assert.equal(result.metaV2.main, 'OAuth redirect debugging');
    });
});
//# sourceMappingURL=parser-v2.test.js.map