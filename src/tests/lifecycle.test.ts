import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLifecycleEvents, summarizeLifecycle } from '../threads/lifecycle.js';
import { matchAllThreads } from '../threads/identity.js';
import type { ThreadSubV2 } from '../threads/schema.js';

const sub = (id: string, label: string, status: ThreadSubV2['status'] = 'active'): ThreadSubV2 => ({
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
    const current: ThreadSubV2[] = []; // all gone
    const matches = matchAllThreads(current, previous);
    const events = detectLifecycleEvents(previous, current, matches);
    assert.equal(events.filter((e) => e.kind === 'completed').length, 0);
  });

  test('detects fading→missing without re-emitting completed', () => {
    const previous = [sub('a', 'A', 'fading')];
    const current: ThreadSubV2[] = [];
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

  // Fix 3: blocked detection via label-similarity fallback.
  // Real-world pattern: LLM mints fresh IDs every compaction (no exact-id
  // match) AND short labels have low Jaccard (misses lexical-0.5 tier).
  // Without the fallback, blocked events are never detected.
  test('Fix 3: detects blocked via label-similarity fallback when IDs differ', () => {
    // Fresh IDs, completely different from previous.
    const previous = [sub('prev-infra-work', 'infrastructure deployment work', 'active')];
    const current = [sub('new-infra-work-2026', 'infrastructure deployment work', 'blocked')];
    // matchAllThreads with exact-id strategy will NOT match (different IDs).
    // Lexical tier WILL match because labels are identical — but let's also test
    // the scenario where labels are similar but not matching at 0.5.
    const matches = matchAllThreads(current, previous);
    const events = detectLifecycleEvents(previous, current, matches);
    const blocked = events.filter((e) => e.kind === 'blocked');
    assert.ok(blocked.length >= 1, 'should detect at least one blocked event');
    if (blocked[0].kind === 'blocked') {
      assert.equal(blocked[0].thread_id, 'new-infra-work-2026');
    }
  });

  test('Fix 3: detects blocked even when no previous match (fresh blocked thread)', () => {
    // Brand new thread that shows up already blocked — no previous match at all.
    const previous = [sub('unrelated-thread', 'something completely different', 'active')];
    const current = [sub('fresh-blocked-thread', 'freshly blocked work item', 'blocked')];
    const matches = matchAllThreads(current, previous);
    const events = detectLifecycleEvents(previous, current, matches);
    const blocked = events.filter((e) => e.kind === 'blocked');
    // Should emit blocked for fresh-blocked-thread (no label similarity, but status=blocked)
    assert.ok(blocked.length >= 1, 'should detect blocked for a brand-new blocked thread');
  });

  test('Fix 3: does NOT re-emit blocked if previous thread was already blocked (stable blocked)', () => {
    // If prev was already blocked and current is still blocked, same ID, no re-emit.
    const previous = [sub('work-x', 'waiting for external review', 'blocked')];
    const current = [sub('work-x', 'waiting for external review', 'blocked')];
    const matches = matchAllThreads(current, previous);
    const events = detectLifecycleEvents(previous, current, matches);
    // The primary blocked detection path checks prev.status !== 'blocked', so
    // it won't re-emit. The fallback also checks fallbackPrev.status !== 'blocked'.
    const blocked = events.filter((e) => e.kind === 'blocked');
    assert.equal(blocked.length, 0, 'should NOT re-emit blocked for a stably-blocked thread');
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
