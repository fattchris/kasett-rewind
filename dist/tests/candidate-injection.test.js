/**
 * Fix 1 — Candidate injection into key_state generation prompt.
 *
 * Verifies:
 *   1. Detector candidates are rendered into the steering prompt.
 *   2. The instruction language is directive ("MUST include"), not advisory.
 *   3. The cap is 50 (not 30 or unlimited).
 *   4. The count of candidates sent is shown in the section heading.
 *   5. Values that were already shown in the old advisory section are still shown.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSteeringPrompt } from '../threads/steering.js';
describe('Fix 1 — candidate key_state injection into prompt', () => {
    test('uses directive language ("MUST include") not advisory language', () => {
        const candidates = [
            { kind: 'url', value: 'https://example.com/api' },
            { kind: 'id', value: 'arn:aws:iam::123:role/my-role', label: 'my role' },
        ];
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.match(out, /MUST include facts from this list/, 'prompt must use directive "MUST include" language');
    });
    test('does NOT use "HINTS, not commands" advisory language', () => {
        const candidates = [
            { kind: 'path', value: '/home/node/.openclaw/workspace' },
        ];
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.equal(out.includes('HINTS, not commands'), false, 'prompt must not use advisory "HINTS, not commands" language');
    });
    test('renders all candidates when ≤ 50', () => {
        const candidates = Array.from({ length: 40 }, (_, i) => ({
            kind: 'value',
            value: `item-${i}`,
        }));
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        for (let i = 0; i < 40; i++) {
            assert.ok(out.includes(`item-${i}`), `item-${i} should appear in prompt`);
        }
    });
    test('caps candidate display at 50 entries', () => {
        const candidates = Array.from({ length: 80 }, (_, i) => ({
            kind: 'value',
            value: `v${i}`,
        }));
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.ok(out.includes('v0'), 'first candidate should appear');
        assert.ok(out.includes('v49'), 'candidate at index 49 should appear');
        assert.equal(out.includes('v50'), false, 'candidate at index 50 should NOT appear (cap is 50)');
        assert.equal(out.includes('v79'), false, 'candidate at index 79 should NOT appear (cap is 50)');
    });
    test('section heading includes candidate count', () => {
        const candidates = Array.from({ length: 15 }, (_, i) => ({
            kind: 'id',
            value: `id-${i}`,
        }));
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.match(out, /15 candidates/, 'section heading should include the candidate count');
    });
    test('candidate values are present in the prompt output', () => {
        const candidates = [
            { kind: 'url', value: 'https://staging.moltaicorp.com/callback' },
            { kind: 'path', value: '/home/node/.openclaw/workspace/repos/kasett-rewind' },
            { kind: 'version', value: 'v1.2.3-rc.1', label: 'test build' },
        ];
        const out = buildSteeringPrompt([], { candidateKeyState: candidates });
        assert.ok(out.includes('https://staging.moltaicorp.com/callback'), 'URL should appear');
        assert.ok(out.includes('/home/node/.openclaw/workspace/repos/kasett-rewind'), 'path should appear');
        assert.ok(out.includes('v1.2.3-rc.1'), 'version should appear');
        assert.ok(out.includes('[test build]'), 'label should appear');
    });
    test('empty candidates list produces no candidate section', () => {
        const out = buildSteeringPrompt([], { candidateKeyState: [] });
        assert.equal(out.includes('MUST include facts from this list'), false);
        assert.equal(out.includes('candidates'), false);
    });
});
//# sourceMappingURL=candidate-injection.test.js.map