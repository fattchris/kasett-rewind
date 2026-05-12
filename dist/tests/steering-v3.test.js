import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSteeringPrompt, buildOrientationPromptV3, } from '../threads/steering.js';
describe('buildSteeringPrompt — V3 schema embedding', () => {
    test('embeds the V3 schema (with key_state) by default', () => {
        const out = buildSteeringPrompt([], { structuredOutput: 'json' });
        assert.match(out, /Thread Meta JSON Schema \(v3\)/);
        assert.match(out, /"key_state"/);
    });
    test('includes detected candidates section when provided', () => {
        const candidates = [
            { kind: 'url', value: 'https://example.com' },
            { kind: 'id', value: 'arn:aws:iam::123:role/x', label: 'sudo' },
        ];
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.match(out, /Detected candidate values/);
        assert.match(out, /url=https:\/\/example\.com/);
        assert.match(out, /id=arn:aws:iam::123:role\/x \[sudo\]/);
    });
    test('includes previous compaction key_state for carry-forward', () => {
        const prev = [
            { kind: 'path', value: '/home/x', label: 'home dir' },
        ];
        const out = buildSteeringPrompt([], { previousKeyState: prev });
        assert.match(out, /Previous compaction's `key_state`/);
        assert.match(out, /path=\/home\/x/);
    });
    test('does NOT include candidate / previous sections when empty', () => {
        const out = buildSteeringPrompt([], {
            candidateKeyState: [],
            previousKeyState: [],
        });
        assert.equal(out.includes('Detected candidate values'), false);
        assert.equal(out.includes("Previous compaction's `key_state`"), false);
    });
    test('caps candidate display at 30 entries', () => {
        const candidates = Array.from({ length: 50 }, (_, i) => ({
            kind: 'value',
            value: `v${i}`,
        }));
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.match(out, /v0/);
        assert.match(out, /v29/);
        assert.equal(out.includes('v30'), false);
    });
    test('field guidance mentions key_state with field semantics', () => {
        const out = buildSteeringPrompt([]);
        assert.match(out, /`key_state`/);
        assert.match(out, /URLs, IDs/);
        assert.match(out, /verbatim/);
    });
    test('example response shows V3 with key_state', () => {
        const out = buildSteeringPrompt([]);
        // The example object should include key_state entries
        assert.match(out, /"key_state"/);
        assert.match(out, /clyde-sudo role ARN/);
    });
    test('markdown mode does NOT include V3 schema', () => {
        const out = buildSteeringPrompt([], { structuredOutput: 'markdown' });
        assert.equal(out.includes('Thread Meta JSON Schema'), false);
        assert.match(out, /\[THREAD_META\]/);
    });
});
describe('buildOrientationPromptV3', () => {
    test('appends "Recent values" when V3 has key_state', () => {
        const v3 = {
            main: 'oauth debugging',
            sub: [{ id: 'a', label: 'A', status: 'active' }],
            key_state: [
                { kind: 'url', value: 'https://x.com', label: 'staging callback' },
                { kind: 'path', value: '/repo/path' },
            ],
        };
        const out = buildOrientationPromptV3([{ v3 }]);
        assert.ok(out);
        assert.match(out, /Recent values/);
        assert.match(out, /staging callback: https:\/\/x\.com/);
        assert.match(out, /\/repo\/path/);
    });
    test('omits "Recent values" when no key_state', () => {
        const v3 = {
            main: 'work',
            sub: [{ id: 'a', label: 'A', status: 'active' }],
        };
        const out = buildOrientationPromptV3([{ v3 }]);
        assert.ok(out);
        assert.equal(out.includes('Recent values'), false);
    });
    test('falls back to V2 builder when only V2 present', () => {
        const v2 = {
            main: 'v2 work',
            sub: [{ id: 's', label: 'S', status: 'active' }],
        };
        const out = buildOrientationPromptV3([{ v2 }]);
        assert.ok(out);
        assert.match(out, /v2 work/);
        assert.equal(out.includes('Recent values'), false);
    });
    test('returns null on empty input', () => {
        assert.equal(buildOrientationPromptV3([]), null);
    });
});
//# sourceMappingURL=steering-v3.test.js.map