import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrientationPrompt, buildSteeringPrompt } from '../threads/steering.js';
import type { ThreadMeta } from '../types.js';
import type { WeightedThreadAnalysis } from '../threads/weight.js';

describe('buildOrientationPrompt', () => {
  test('produces orientation string from thread meta', () => {
    const meta: ThreadMeta = {
      main: 'building OAuth2 authentication',
      sub: ['GitHub OAuth integration', 'rate limiting', 'monitoring setup'],
    };

    const result = buildOrientationPrompt(meta);

    assert.ok(result.includes('building OAuth2 authentication'));
    assert.ok(result.includes('GitHub OAuth integration'));
    assert.ok(result.includes('rate limiting'));
    assert.ok(result.includes('monitoring setup'));
    assert.ok(result.startsWith('You are currently working on:'));
  });

  test('includes all three sub-threads', () => {
    const meta: ThreadMeta = {
      main: 'main task',
      sub: ['sub A', 'sub B', 'sub C'],
    };

    const result = buildOrientationPrompt(meta);

    assert.ok(result.includes('sub A'));
    assert.ok(result.includes('sub B'));
    assert.ok(result.includes('sub C'));
  });
});

describe('buildSteeringPrompt', () => {
  test('includes core threads section when present', () => {
    const analysis: WeightedThreadAnalysis = {
      core: ['building auth system', 'OAuth setup'],
      fresh: ['monitoring'],
      fading: ['database migration'],
    };

    const metas: ThreadMeta[] = [
      { main: 'building auth system', sub: ['OAuth setup', 'monitoring', 'testing'] },
    ];

    const result = buildSteeringPrompt(analysis, metas);

    assert.ok(result.includes('Core Threads'));
    assert.ok(result.includes('building auth system'));
    assert.ok(result.includes('OAuth setup'));
  });

  test('includes fresh threads section when present', () => {
    const analysis: WeightedThreadAnalysis = {
      core: [],
      fresh: ['new feature X', 'new feature Y'],
      fading: [],
    };

    const result = buildSteeringPrompt(analysis, []);

    assert.ok(result.includes('New Threads'));
    assert.ok(result.includes('new feature X'));
    assert.ok(result.includes('new feature Y'));
  });

  test('includes fading threads section when present', () => {
    const analysis: WeightedThreadAnalysis = {
      core: [],
      fresh: [],
      fading: ['old task A', 'old task B'],
    };

    const result = buildSteeringPrompt(analysis, []);

    assert.ok(result.includes('Fading Threads'));
    assert.ok(result.includes('old task A'));
    assert.ok(result.includes('old task B'));
  });

  test('includes THREAD_META output format instructions', () => {
    const analysis: WeightedThreadAnalysis = {
      core: [],
      fresh: [],
      fading: [],
    };

    const result = buildSteeringPrompt(analysis, []);

    assert.ok(result.includes('[THREAD_META]'));
    assert.ok(result.includes('[/THREAD_META]'));
    assert.ok(result.includes('main:'));
    assert.ok(result.includes('sub1:'));
    assert.ok(result.includes('sub2:'));
    assert.ok(result.includes('sub3:'));
  });

  test('shows thread history from previous metas', () => {
    const analysis: WeightedThreadAnalysis = {
      core: ['auth system'],
      fresh: [],
      fading: [],
    };

    const metas: ThreadMeta[] = [
      { main: 'auth system', sub: ['OAuth', 'rate limiting', 'testing'] },
      { main: 'auth system', sub: ['OAuth', 'database', 'setup'] },
    ];

    const result = buildSteeringPrompt(analysis, metas);

    assert.ok(result.includes('Recent Thread History'));
    assert.ok(result.includes('(most recent)'));
    assert.ok(result.includes('2 compactions ago'));
  });

  test('includes rules about always outputting 1 main + 3 subs', () => {
    const analysis: WeightedThreadAnalysis = {
      core: [],
      fresh: [],
      fading: [],
    };

    const result = buildSteeringPrompt(analysis, []);

    assert.ok(result.includes('exactly 1 main + 3 subs'));
  });

  test('handles empty analysis gracefully', () => {
    const analysis: WeightedThreadAnalysis = {
      core: [],
      fresh: [],
      fading: [],
    };

    const result = buildSteeringPrompt(analysis, []);

    // Should still produce valid output with format instructions
    assert.ok(result.includes('Thread-Aware Compaction Instructions'));
    assert.ok(result.includes('[THREAD_META]'));
    assert.ok(!result.includes('Core Threads'));
    assert.ok(!result.includes('New Threads'));
    assert.ok(!result.includes('Fading Threads'));
  });
});
