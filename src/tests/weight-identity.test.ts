import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyThreadsWithIdentity } from '../threads/weight.js';
import type { ThreadMetaV2 } from '../threads/schema.js';

const meta = (...subs: Array<{ id: string; label: string; status?: 'active' | 'blocked' | 'completed' | 'fading' }>): ThreadMetaV2 => ({
  main: 'm',
  sub: subs.map((s) => ({ id: s.id, label: s.label, status: s.status ?? 'active' })),
});

describe('classifyThreadsWithIdentity', () => {
  test('returns empty array when no metas', () => {
    assert.deepEqual(classifyThreadsWithIdentity([]), []);
  });

  test('exact-id continuity classifies as core', () => {
    const m = [
      meta({ id: 'a', label: 'A' }),
      meta({ id: 'a', label: 'A' }),
      meta({ id: 'a', label: 'A' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    assert.equal(result.length, 1);
    assert.equal(result[0].classification, 'core');
    assert.equal(result[0].appearances, 3);
  });

  test('lexical match across compactions: rename detected', () => {
    // Most recent first: label changed but Jaccard catches it
    const m: ThreadMetaV2[] = [
      meta({ id: 'deploy', label: 'Deploy API staging' }),
      meta({ id: 'infra-deploy', label: 'Deploy API to staging' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    // We expect ONE canonical thread (matched), classified as 'renamed'
    assert.equal(result.length, 1);
    const r = result[0];
    assert.equal(r.classification, 'renamed');
    assert.ok(r.renamedFrom, 'should record renamedFrom');
  });

  test('genuinely new thread → fresh', () => {
    const m: ThreadMetaV2[] = [
      meta({ id: 'new-work', label: 'New unrelated work' }),
      meta({ id: 'old-work', label: 'Older different stuff' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    const fresh = result.find((r) => r.id === 'new-work');
    assert.equal(fresh?.classification, 'fresh');
  });

  test('thread fades out (in old slot, not in new)', () => {
    const m: ThreadMetaV2[] = [
      meta({ id: 'newer', label: 'Different' }),
      meta({ id: 'older', label: 'Older' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    const fading = result.find((r) => r.id === 'older');
    assert.equal(fading?.classification, 'fading');
  });

  test('merged classification when multiple previous fold into one current', () => {
    const m: ThreadMetaV2[] = [
      meta({ id: 'all-oauth', label: 'oauth refresh debug and redirect fix' }),
      meta(
        { id: 'redirect-fix', label: 'redirect fix' },
        { id: 'oauth-other', label: 'oauth refresh debug' },
      ),
    ];
    const result = classifyThreadsWithIdentity(m);
    const merged = result.find((r) => r.classification === 'merged');
    assert.ok(merged, 'expected a merged thread');
    assert.ok((merged?.mergedFrom?.length ?? 0) >= 1);
  });

  test('latestStatus reflects newest slot', () => {
    const m: ThreadMetaV2[] = [
      meta({ id: 'a', label: 'A', status: 'completed' }),
      meta({ id: 'a', label: 'A', status: 'active' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    assert.equal(result[0].latestStatus, 'completed');
  });

  test('id-stable threads preserve continuity even with status drift', () => {
    const m: ThreadMetaV2[] = [
      meta({ id: 'x', label: 'X', status: 'blocked' }),
      meta({ id: 'x', label: 'X', status: 'active' }),
      meta({ id: 'x', label: 'X', status: 'active' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    assert.equal(result[0].classification, 'core');
    assert.equal(result[0].appearances, 3);
  });

  test('canonical id anchors on oldest occurrence', () => {
    // Same thread, label drifts each compaction; identity tier catches it.
    const m: ThreadMetaV2[] = [
      meta({ id: 'd3', label: 'Deploy api staging environment now' }),
      meta({ id: 'd2', label: 'Deploy api staging environment' }),
      meta({ id: 'd1', label: 'Deploy api staging' }),
    ];
    const result = classifyThreadsWithIdentity(m);
    // Should collapse into one canonical thread with multiple appearances
    assert.equal(result.length, 1);
    assert.ok(result[0].appearances >= 2, `expected ≥2 appearances, got ${result[0].appearances}`);
    // canonical id is the OLDEST
    assert.equal(result[0].id, 'd1');
  });
});
