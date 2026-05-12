import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLifecycleEvents, summarizeLifecycle } from '../threads/lifecycle.js';
import { matchAllThreads } from '../threads/identity.js';
const sub = (id, label, status = 'active') => ({
    id,
    label,
    status,
});
describe('detectLifecycleEvents', () => {
    test('detects created threads (no match in previous)', () => {
        const previous = [sub('a', 'A')];
        const current = [sub('a', 'A'), sub('b', 'B')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const created = events.filter((e) => e.kind === 'created');
        assert.equal(created.length, 1);
        if (created[0].kind === 'created') {
            assert.equal(created[0].thread_id, 'b');
        }
    });
    test('detects completed threads (gone from current, was active)', () => {
        const previous = [sub('a', 'A', 'active'), sub('b', 'B', 'active')];
        const current = [sub('a', 'A', 'active')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const completed = events.filter((e) => e.kind === 'completed');
        assert.equal(completed.length, 1);
        if (completed[0].kind === 'completed') {
            assert.equal(completed[0].thread_id, 'b');
        }
    });
    test('does NOT re-emit completed for threads already completed in previous', () => {
        const previous = [sub('a', 'A', 'completed')];
        const current = []; // all gone
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        assert.equal(events.filter((e) => e.kind === 'completed').length, 0);
    });
    test('detects fading→missing without re-emitting completed', () => {
        const previous = [sub('a', 'A', 'fading')];
        const current = [];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        assert.equal(events.filter((e) => e.kind === 'completed').length, 0);
    });
    test('detects renamed (lexical match with label change)', () => {
        const previous = [sub('infra-deploy', 'Deploy API to staging')];
        const current = [sub('deploy', 'Deploy API staging environment')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const renamed = events.filter((e) => e.kind === 'renamed');
        assert.equal(renamed.length, 1);
        if (renamed[0].kind === 'renamed') {
            assert.equal(renamed[0].from_id, 'infra-deploy');
            assert.equal(renamed[0].to_id, 'deploy');
            assert.equal(renamed[0].strategy, 'lexical');
        }
    });
    test('detects renamed via exact-id with changed label', () => {
        const previous = [sub('deploy-api', 'Deploy API')];
        const current = [sub('deploy-api', 'Deploy API to production')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const renamed = events.filter((e) => e.kind === 'renamed');
        assert.equal(renamed.length, 1);
    });
    test('detects status transition to blocked', () => {
        const previous = [sub('a', 'A', 'active')];
        const current = [sub('a', 'A', 'blocked')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const blocked = events.filter((e) => e.kind === 'blocked');
        assert.equal(blocked.length, 1);
    });
    test('detects status transition to completed', () => {
        const previous = [sub('a', 'A', 'active')];
        const current = [sub('a', 'A', 'completed')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const completed = events.filter((e) => e.kind === 'completed');
        assert.equal(completed.length, 1);
    });
    test('detects split (one previous matched by multiple current)', () => {
        const previous = [sub('feature-x', 'Feature X work')];
        const current = [
            sub('feature-x', 'Feature X work'), // exact-id
            sub('feature-x-2', 'Feature X work continuation'), // lexical match
        ];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const splits = events.filter((e) => e.kind === 'split');
        assert.equal(splits.length, 1);
        if (splits[0].kind === 'split') {
            assert.equal(splits[0].from_id, 'feature-x');
            assert.deepEqual(splits[0].into_ids.sort(), ['feature-x', 'feature-x-2']);
        }
    });
    test('detects merge heuristically (multiple previous fold into one current)', () => {
        const previous = [
            sub('redirect-fix', 'redirect fix'),
            sub('oauth-other', 'oauth refresh debug'),
        ];
        const current = [sub('all-oauth', 'oauth refresh debug and redirect fix')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const merged = events.filter((e) => e.kind === 'merged');
        assert.equal(merged.length, 1);
        if (merged[0].kind === 'merged') {
            assert.ok(merged[0].from_ids.length >= 2);
            assert.equal(merged[0].into_id, 'all-oauth');
        }
    });
    test('returns empty array when no changes', () => {
        const same = [sub('a', 'A', 'active')];
        const matches = matchAllThreads(same, same);
        const events = detectLifecycleEvents(same, same, matches);
        assert.equal(events.length, 0);
    });
});
describe('summarizeLifecycle', () => {
    test('counts events by kind', () => {
        const previous = [sub('a', 'A'), sub('b', 'B')];
        const current = [sub('a', 'A'), sub('c', 'C')];
        const matches = matchAllThreads(current, previous);
        const events = detectLifecycleEvents(previous, current, matches);
        const summary = summarizeLifecycle(events);
        assert.equal(summary.created, 1); // c
        assert.equal(summary.completed, 1); // b
        assert.equal(summary.renamed, 0);
    });
    test('zero counts when empty', () => {
        const summary = summarizeLifecycle([]);
        assert.equal(summary.created, 0);
        assert.equal(summary.completed, 0);
        assert.equal(summary.blocked, 0);
        assert.equal(summary.renamed, 0);
        assert.equal(summary.merged, 0);
        assert.equal(summary.split, 0);
    });
});
//# sourceMappingURL=lifecycle.test.js.map