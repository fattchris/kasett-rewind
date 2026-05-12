import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThreadsV2,
  classifyThreadsV1Fallback,
} from '../threads/weight.js';
import type { ThreadMetaV2 } from '../threads/schema.js';

describe('classifyThreadsV2 — id-based continuity', () => {
  test('returns empty array when no metas', () => {
    assert.deepEqual(classifyThreadsV2([]), []);
  });

  test('classifies a thread present in all three slots as core', () => {
    const m: ThreadMetaV2[] = [
      { main: 'm', sub: [{ id: 'core-a', label: 'A', status: 'active' }] },
      { main: 'm', sub: [{ id: 'core-a', label: 'A', status: 'active' }] },
      { main: 'm', sub: [{ id: 'core-a', label: 'A', status: 'active' }] },
    ];
    const result = classifyThreadsV2(m);
    assert.equal(result.length, 1);
    assert.equal(result[0].classification, 'core');
    assert.equal(result[0].appearances, 3);
  });

  test('classifies a thread that just appeared as fresh', () => {
    const m: ThreadMetaV2[] = [
      { main: 'm', sub: [{ id: 'fresh-a', label: 'A', status: 'active' }] },
      { main: 'm', sub: [{ id: 'old-a', label: 'OldA', status: 'active' }] },
    ];
    const result = classifyThreadsV2(m);
    const fresh = result.find((r) => r.id === 'fresh-a');
    const old = result.find((r) => r.id === 'old-a');
    assert.equal(fresh?.classification, 'fresh');
    assert.equal(old?.classification, 'fading');
  });

  test('thread present in older slots but not most recent is fading', () => {
    const m: ThreadMetaV2[] = [
      { main: 'm', sub: [{ id: 'newer', label: 'N', status: 'active' }] },
      { main: 'm', sub: [{ id: 'older', label: 'O', status: 'active' }] },
      { main: 'm', sub: [{ id: 'older', label: 'O', status: 'active' }] },
    ];
    const result = classifyThreadsV2(m);
    const older = result.find((r) => r.id === 'older');
    assert.equal(older?.classification, 'fading');
  });

  test('preserves status from most-recent appearance', () => {
    const m: ThreadMetaV2[] = [
      { main: 'm', sub: [{ id: 'a', label: 'A', status: 'completed' }] },
      { main: 'm', sub: [{ id: 'a', label: 'A', status: 'active' }] },
    ];
    const result = classifyThreadsV2(m);
    assert.equal(result[0].latestStatus, 'completed');
  });

  test('id continuity survives label drift (the whole point)', () => {
    // Same id, different label across compactions — they still match
    const m: ThreadMetaV2[] = [
      {
        main: 'm',
        sub: [{ id: 'oauth-debug', label: 'OAuth callback fix', status: 'completed' }],
      },
      {
        main: 'm',
        sub: [{ id: 'oauth-debug', label: 'Login redirect issue', status: 'active' }],
      },
      {
        main: 'm',
        sub: [{ id: 'oauth-debug', label: 'OAuth investigation', status: 'active' }],
      },
    ];
    const result = classifyThreadsV2(m);
    assert.equal(result.length, 1);
    assert.equal(result[0].classification, 'core');
    assert.equal(result[0].appearances, 3);
    // Label is from the FIRST appearance walking most-recent-first
    assert.equal(result[0].label, 'OAuth callback fix');
  });
});

describe('classifyThreadsV1Fallback — substring matching', () => {
  test('returns empty array when no metas', () => {
    assert.deepEqual(classifyThreadsV1Fallback([]), []);
  });

  test('substring match folds shorter-into-longer rewordings', () => {
    // Walking most-recent-first: longer canonical "OAuth integration debugging"
    // contains shorter "OAuth integration" — they fold. "OAuth integration
    // setup" does NOT share a substring relationship with the canonical
    // (neither contains the other), so it's a separate thread. This
    // documents the v1 limitation that motivated v2 ids.
    const m = [
      ['OAuth integration debugging'],
      ['OAuth integration'],
      ['OAuth integration debugging'],
    ];
    const result = classifyThreadsV1Fallback(m);
    assert.equal(result.length, 1);
    assert.equal(result[0].appearances, 3);
    assert.equal(result[0].classification, 'core');
  });

  test('non-overlapping labels are separate threads', () => {
    const m = [['totally different'], ['nothing alike']];
    const result = classifyThreadsV1Fallback(m);
    assert.equal(result.length, 2);
  });

  test('idle slots are skipped', () => {
    const m = [['idle', 'real thread'], ['idle']];
    const result = classifyThreadsV1Fallback(m);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'real thread');
  });

  test('failure mode of v1: synonym substitution misses (documents the limit)', () => {
    // "OAuth redirect debugging" vs "Login redirect issue" — share "redirect"
    // but each is short relative to the shared substring; threshold says no match
    const m = [['OAuth redirect debugging'], ['Login redirect issue']];
    const result = classifyThreadsV1Fallback(m);
    // The shared substring "redirect" is not >=50% of either. They split.
    assert.equal(result.length, 2);
  });
});
