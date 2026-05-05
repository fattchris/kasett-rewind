import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeThreads } from '../threads/weight.js';
import type { ThreadMeta } from '../types.js';

describe('analyzeThreads', () => {
  test('returns empty analysis for no metas', () => {
    const result = analyzeThreads([], [1.0, 0.6, 0.3]);
    assert.deepEqual(result.core, []);
    assert.deepEqual(result.fresh, []);
    assert.deepEqual(result.fading, []);
  });

  test('classifies all threads as fresh when only one compaction exists', () => {
    const metas: ThreadMeta[] = [
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'database migration', 'redirect URLs'],
      },
    ];

    const result = analyzeThreads(metas, [1.0]);

    // With only 1 compaction, nothing can be "core" (needs 2+ appearances)
    assert.deepEqual(result.core, []);
    // All should be fresh (only in most recent)
    assert.equal(result.fresh.length, 4); // main + 3 subs
    assert.deepEqual(result.fading, []);
  });

  test('identifies core threads across multiple compactions', () => {
    const metas: ThreadMeta[] = [
      // Most recent (index 0)
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'rate limiting', 'monitoring'],
      },
      // Previous (index 1)
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'database migration', 'redirect URLs'],
      },
    ];

    const result = analyzeThreads(metas, [1.0, 0.6]);

    // "building auth system" and "OAuth setup" appear in both = core
    assert.ok(result.core.includes('building auth system'));
    assert.ok(result.core.includes('OAuth setup'));

    // "rate limiting" and "monitoring" only in most recent = fresh
    assert.ok(result.fresh.includes('rate limiting'));
    assert.ok(result.fresh.includes('monitoring'));

    // "database migration" and "redirect URLs" only in older = fading
    assert.ok(result.fading.includes('database migration'));
    assert.ok(result.fading.includes('redirect URLs'));
  });

  test('identifies fading threads correctly', () => {
    const metas: ThreadMeta[] = [
      // Most recent
      {
        main: 'deploying to production',
        sub: ['health checks', 'load balancer', 'DNS config'],
      },
      // Older
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'rate limiting', 'testing'],
      },
    ];

    const result = analyzeThreads(metas, [1.0, 0.6]);

    // Everything from older compaction that's not in recent = fading
    assert.ok(result.fading.includes('building auth system'));
    assert.ok(result.fading.includes('OAuth setup'));
    assert.ok(result.fading.includes('rate limiting'));
    assert.ok(result.fading.includes('testing'));
  });

  test('uses fuzzy matching for similar thread names', () => {
    const metas: ThreadMeta[] = [
      {
        main: 'building OAuth2 authentication',
        sub: ['setting up providers', 'rate limiting config', 'monitoring setup'],
      },
      {
        main: 'building OAuth2 auth system',
        sub: ['setting up OAuth providers', 'database work', 'testing'],
      },
    ];

    const result = analyzeThreads(metas, [1.0, 0.6]);

    // "building OAuth2 authentication" and "building OAuth2 auth system" should fuzzy match = core
    assert.ok(result.core.length >= 1);
    // "setting up providers" and "setting up OAuth providers" should fuzzy match
    assert.ok(result.core.some((t) => t.toLowerCase().includes('setting up')));
  });

  test('handles three compactions with decay weights', () => {
    const metas: ThreadMeta[] = [
      // Most recent (weight 1.0)
      {
        main: 'deploying v2',
        sub: ['health checks', 'DNS cutover', 'monitoring'],
      },
      // Middle (weight 0.6)
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'rate limiting', 'monitoring'],
      },
      // Oldest (weight 0.3)
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'database migration', 'testing'],
      },
    ];

    const result = analyzeThreads(metas, [1.0, 0.6, 0.3]);

    // "monitoring" appears in index 0 and 1 = core
    assert.ok(result.core.includes('monitoring'));

    // "building auth system" appears in index 1 and 2 but NOT 0 = fading
    assert.ok(result.fading.includes('building auth system'));

    // "health checks" and "DNS cutover" only in most recent = fresh
    assert.ok(result.fresh.includes('health checks'));
    assert.ok(result.fresh.includes('DNS cutover'));
  });

  test('empty sub-thread strings are ignored', () => {
    const metas: ThreadMeta[] = [
      {
        main: 'working on something',
        sub: ['', '', ''],
      },
    ];

    const result = analyzeThreads(metas, [1.0]);

    // Only main should appear (empty strings are filtered)
    assert.equal(result.fresh.length, 1);
    assert.ok(result.fresh.includes('working on something'));
  });
});
