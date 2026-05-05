import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrientationPrompt, buildSteeringPrompt } from '../threads/steering.js';
import type { WeightedSummary } from '../threads/weight.js';

describe('buildOrientationPrompt', () => {
  test('parses [THREAD_META] from a raw summary string', () => {
    const rawSummary = `Implemented OAuth2 authentication for MoltAI.
Rate limiting added to token endpoints.

[THREAD_META]
main: building OAuth2 authentication
sub1: GitHub OAuth integration
sub2: rate limiting
sub3: monitoring setup
[/THREAD_META]`;

    const result = buildOrientationPrompt(rawSummary);

    assert.ok(result !== null);
    assert.ok(result!.includes('building OAuth2 authentication'));
    assert.ok(result!.startsWith('You are currently working on:'));
  });

  test('includes active sub-threads in orientation', () => {
    const rawSummary = `[THREAD_META]
main: main task
sub1: sub A
sub2: sub B
sub3: idle
[/THREAD_META]`;

    const result = buildOrientationPrompt(rawSummary);

    assert.ok(result !== null);
    assert.ok(result!.includes('sub A'));
    assert.ok(result!.includes('sub B'));
    // idle subs should be filtered out
    assert.ok(!result!.includes('idle'));
  });

  test('returns null when no [THREAD_META] block found', () => {
    const result = buildOrientationPrompt('A plain summary with no thread meta.');
    assert.equal(result, null);
  });

  test('returns just main when all subs are idle', () => {
    const rawSummary = `[THREAD_META]
main: only active thread
sub1: idle
sub2: idle
sub3: idle
[/THREAD_META]`;

    const result = buildOrientationPrompt(rawSummary);
    assert.ok(result !== null);
    assert.ok(result!.includes('only active thread'));
    assert.ok(!result!.includes('Active sub-threads'));
  });
});

describe('buildSteeringPrompt', () => {
  test('includes weighted previous summaries as context', () => {
    const weighted: WeightedSummary[] = [
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
    const weighted: WeightedSummary[] = [
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
