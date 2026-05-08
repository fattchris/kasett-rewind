import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrientationPrompt, buildSteeringPrompt } from '../threads/steering.js';
// ---------------------------------------------------------------------------
// buildOrientationPrompt — new multi-meta signature
// ---------------------------------------------------------------------------
describe('buildOrientationPrompt', () => {
    test('shows current thread state from the most recent meta', () => {
        const metas = [
            {
                main: 'building OAuth2 authentication',
                sub: ['GitHub OAuth integration', 'rate limiting', 'monitoring setup'],
            },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        assert.ok(result.includes('building OAuth2 authentication'));
        assert.ok(result.startsWith('You are currently working on:'));
    });
    test('includes active sub-threads in orientation', () => {
        const metas = [
            {
                main: 'main task',
                sub: ['sub A', 'sub B', 'idle'],
            },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        assert.ok(result.includes('sub A'));
        assert.ok(result.includes('sub B'));
        // idle subs should be filtered out
        assert.ok(!result.includes('idle'));
    });
    test('returns null when no metas provided', () => {
        const result = buildOrientationPrompt([]);
        assert.equal(result, null);
    });
    test('returns null when first meta has empty main', () => {
        const metas = [
            { main: '', sub: ['sub1', 'sub2', 'sub3'] },
        ];
        const result = buildOrientationPrompt(metas);
        assert.equal(result, null);
    });
    test('returns just main when all subs are idle', () => {
        const metas = [
            {
                main: 'only active thread',
                sub: ['idle', 'idle', 'idle'],
            },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        assert.ok(result.includes('only active thread'));
        assert.ok(!result.includes('Active sub-threads'));
    });
    test('shows thread trajectory from multiple metas', () => {
        const metas = [
            {
                main: 'OAuth system deployed',
                sub: ['GitHub OAuth live', 'monitoring active', 'idle'],
            },
            {
                main: 'building OAuth auth system',
                sub: ['GitHub OAuth integration', 'rate limiting', 'idle'],
            },
            {
                main: 'planning auth system',
                sub: ['design docs', 'idle', 'idle'],
            },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        // Current state (most recent)
        assert.ok(result.includes('OAuth system deployed'));
        assert.ok(result.includes('GitHub OAuth live'));
        // Trajectory section
        assert.ok(result.includes('Thread trajectory'));
        assert.ok(result.includes('-1:'));
        assert.ok(result.includes('-2:'));
        assert.ok(result.includes('building OAuth auth system'));
        assert.ok(result.includes('planning auth system'));
    });
    test('trajectory uses -N index format (most-recent-previous first)', () => {
        const metas = [
            { main: 'current work', sub: ['sub1', 'idle', 'idle'] },
            { main: 'previous work', sub: ['idle', 'idle', 'idle'] },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        assert.ok(result.includes('-1:'));
        assert.ok(result.includes('previous work'));
        // Should NOT show -2 when only one older entry
        assert.ok(!result.includes('-2:'));
    });
    test('no trajectory section with single meta', () => {
        const metas = [
            { main: 'only entry', sub: ['sub1', 'sub2', 'idle'] },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        assert.ok(!result.includes('Thread trajectory'));
        assert.ok(!result.includes('-1:'));
    });
    test('idle subs are filtered from trajectory entries too', () => {
        const metas = [
            { main: 'current', sub: ['active', 'idle', 'idle'] },
            { main: 'previous', sub: ['idle', 'idle', 'idle'] },
        ];
        const result = buildOrientationPrompt(metas);
        assert.ok(result !== null);
        // -1 entry should not list subs (all idle)
        const trajectoryLine = result.split('\n').find((l) => l.includes('-1:'));
        assert.ok(trajectoryLine);
        assert.ok(!trajectoryLine.includes('Subs:'));
    });
});
// ---------------------------------------------------------------------------
// buildSteeringPrompt — unchanged, compaction-only
// ---------------------------------------------------------------------------
describe('buildSteeringPrompt', () => {
    test('includes weighted previous summaries as context', () => {
        const weighted = [
            {
                summary: 'OAuth system was built and deployed.',
                weight: 1.0,
                label: 'Previous summary (weight 1.0 — most recent)',
            },
            {
                summary: 'Started building the auth system.',
                weight: 0.6,
                label: 'Earlier summary (weight 0.6)',
            },
        ];
        const result = buildSteeringPrompt(weighted);
        assert.ok(result.includes('Previous Compaction Summaries'));
        assert.ok(result.includes('OAuth system was built'));
        assert.ok(result.includes('Started building the auth system'));
        assert.ok(result.includes('weight 1.0'));
        assert.ok(result.includes('weight 0.6'));
    });
    test('includes THREAD_META output format instructions', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('[THREAD_META]'));
        assert.ok(result.includes('[/THREAD_META]'));
        assert.ok(result.includes('main:'));
        assert.ok(result.includes('sub1:'));
        assert.ok(result.includes('sub2:'));
        assert.ok(result.includes('sub3:'));
    });
    test('explains weight semantics in the prompt', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('Thread-Aware Compaction Instructions'));
    });
    test('explains weight semantics when summaries are present', () => {
        const weighted = [
            { summary: 'Recent work.', weight: 1.0, label: 'Previous summary (weight 1.0 — most recent)' },
        ];
        const result = buildSteeringPrompt(weighted);
        assert.ok(result.includes('1.0 = most recent'));
    });
    test('works with empty weighted summaries — still produces valid output', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('Thread-Aware Compaction Instructions'));
        assert.ok(result.includes('[THREAD_META]'));
        // No "Previous Compaction Summaries" section without summaries
        assert.ok(!result.includes('Previous Compaction Summaries'));
    });
    test('includes rules about 1 main + 3 subs', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('1 main + 3 subs') || result.includes('Exactly 1 main'));
    });
    test('explains threads are orientation, not task tracker', () => {
        const result = buildSteeringPrompt([]);
        assert.ok(result.includes('orientation') || result.includes('NOT a task tracker'));
    });
});
//# sourceMappingURL=steering.test.js.map