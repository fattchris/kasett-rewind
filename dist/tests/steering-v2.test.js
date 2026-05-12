import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSteeringPrompt, buildOrientationPromptV2, } from '../threads/steering.js';
describe('buildSteeringPrompt — v2/json mode (default)', () => {
    test('default mode is JSON (no [THREAD_META] sentinel)', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(!result.includes('[THREAD_META]'));
        assert.ok(!result.includes('[/THREAD_META]'));
    });
    test('includes the v3 JSON schema in the prompt (Phase C upgrade)', () => {
        // Phase C: the steering builder now embeds the V3 schema, which is V2
        // plus optional `key_state[]`. V2 is a subset of V3.
        const result = buildSteeringPrompt([]);
        // Schema metadata — V3 is now the embedded schema
        assert.ok(result.includes('"$id": "kasett-rewind/thread-meta/v3"'));
        // Required fields (still main + sub)
        assert.ok(result.includes('"required": [') && result.includes('"main"'));
        // Status enum
        assert.ok(result.includes('"active"'));
        assert.ok(result.includes('"blocked"'));
        assert.ok(result.includes('"completed"'));
        assert.ok(result.includes('"fading"'));
        // Phase C: key_state field is present in the schema
        assert.ok(result.includes('"key_state"'));
    });
    test('asks for narrative + fenced ```json``` block', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('```json'));
        assert.ok(result.includes('fenced JSON block'));
        assert.ok(result.match(/non-negotiable/i));
    });
    test('includes a worked example response', () => {
        const result = buildSteeringPrompt([]);
        // The example narrative line
        assert.ok(result.includes('OAuth redirect debugging on staging EKS cluster'));
        // The example sub-thread id
        assert.ok(result.includes('github-app-redirect-uri'));
    });
    test('JSON.parse-able instructions when extracted from fence in prompt', () => {
        const result = buildSteeringPrompt([]);
        // Find the example object's fence (the one with the worked example, NOT
        // the schema fence). Both are valid JSON; we just verify the last fence
        // parses cleanly.
        const fences = [...result.matchAll(/```json\n([\s\S]*?)\n```/g)];
        assert.ok(fences.length >= 2, 'expected at least 2 json fences (schema + example)');
        for (const f of fences) {
            // Each fence must be JSON.parse-able
            JSON.parse(f[1]);
        }
    });
    test('threads previousSubIds into prompt when supplied', () => {
        const result = buildSteeringPrompt([], {
            previousSubIds: ['oauth-redirect-debug', 'cdk-prod-rollout'],
        });
        assert.ok(result.includes('oauth-redirect-debug'));
        assert.ok(result.includes('cdk-prod-rollout'));
        assert.ok(result.match(/REUSE/));
    });
    test('omits previousSubIds section when not supplied', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(!result.includes('REUSE when threads continue'));
    });
    test('still includes weighted previous summaries section', () => {
        const result = buildSteeringPrompt([
            { summary: 'Old work.', weight: 1.0, label: 'Previous summary (weight 1.0)' },
        ]);
        assert.ok(result.includes('Previous Compaction Summaries'));
        assert.ok(result.includes('Old work.'));
    });
    test("'tool' mode produces same prompt as 'json' (call site adds API flag)", () => {
        const json = buildSteeringPrompt([], { structuredOutput: 'json' });
        const tool = buildSteeringPrompt([], { structuredOutput: 'tool' });
        assert.equal(json, tool);
    });
    test("'markdown' mode falls back to v1 instructions", () => {
        const result = buildSteeringPrompt([], { structuredOutput: 'markdown' });
        assert.ok(result.includes('[THREAD_META]'));
        assert.ok(!result.includes('```json'));
    });
});
describe('buildOrientationPromptV2', () => {
    test('returns null when no metas', () => {
        assert.equal(buildOrientationPromptV2([]), null);
    });
    test('renders v2 status decorations', () => {
        const v2 = {
            main: 'main task',
            sub: [
                { id: 'a', label: 'active task', status: 'active' },
                { id: 'b', label: 'blocked task', status: 'blocked' },
                { id: 'c', label: 'finished task', status: 'completed' },
            ],
        };
        const result = buildOrientationPromptV2([{ v2 }]);
        assert.ok(result);
        assert.ok(result.includes('main task'));
        assert.ok(result.includes('active task'));
        assert.ok(result.includes('blocked task (blocked)'));
        assert.ok(result.includes('Recently completed: finished task'));
    });
    test('renders decisions when present', () => {
        const v2 = {
            main: 'work',
            sub: [],
            decisions: ['Decision A', 'Decision B'],
        };
        const result = buildOrientationPromptV2([{ v2 }]);
        assert.ok(result);
        assert.ok(result.includes('Recent decisions:'));
        assert.ok(result.includes('Decision A'));
        assert.ok(result.includes('Decision B'));
    });
    test('renders open_questions when present', () => {
        const v2 = {
            main: 'work',
            sub: [],
            open_questions: ['Q1?', 'Q2?'],
        };
        const result = buildOrientationPromptV2([{ v2 }]);
        assert.ok(result);
        assert.ok(result.includes('Open questions:'));
        assert.ok(result.includes('Q1?'));
    });
    test('falls back to v1 rendering when only v1 present', () => {
        const v1 = {
            main: 'legacy work',
            sub: ['legacy a', 'legacy b', 'idle'],
        };
        const result = buildOrientationPromptV2([{ v1 }]);
        assert.ok(result);
        assert.ok(result.includes('legacy work'));
        assert.ok(result.includes('legacy a'));
        assert.ok(result.includes('legacy b'));
    });
    test('mixed timeline: v2 most-recent, v1 older', () => {
        const v2Current = {
            main: 'current work',
            sub: [{ id: 'a', label: 'sub a', status: 'active' }],
        };
        const v1Older = {
            main: 'older work',
            sub: ['old1', 'idle', 'idle'],
        };
        const result = buildOrientationPromptV2([{ v2: v2Current }, { v1: v1Older }]);
        assert.ok(result);
        assert.ok(result.includes('current work'));
        assert.ok(result.includes('Thread trajectory'));
        assert.ok(result.includes('older work'));
        assert.ok(result.includes('old1'));
    });
    test('trajectory line for v2 includes status letter shorthand', () => {
        const v2Current = {
            main: 'current',
            sub: [{ id: 'x', label: 'x-label', status: 'active' }],
        };
        const v2Older = {
            main: 'older',
            sub: [{ id: 'y', label: 'y-label', status: 'completed' }],
        };
        const result = buildOrientationPromptV2([{ v2: v2Current }, { v2: v2Older }]);
        assert.ok(result);
        // Status letter [c] for completed in trajectory
        const trajectoryLine = result.split('\n').find((l) => l.includes('-1:'));
        assert.ok(trajectoryLine);
        assert.ok(trajectoryLine.includes('y-label[c]'));
    });
});
//# sourceMappingURL=steering-v2.test.js.map