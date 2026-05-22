import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionReader } from '../storage/reader.js';
import { weightSummaries } from '../threads/weight.js';
import { buildSteeringPrompt, buildOrientationPrompt } from '../threads/steering.js';
import { parseCompactionOutput, parseCompactionOutputBestEffort } from '../threads/parser.js';
import { DEFAULT_CONFIG } from '../types.js';
import type { ThreadMeta } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('Integration: Full Pipeline', () => {
  test('read fixture → extract summaries → weight → steer → parse output', async () => {
    // Step 1: Read session JSONL — get last N summaries
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const summaries = await reader.readLastNSummaries(filePath, DEFAULT_CONFIG.compaction.windowSize);

    assert.equal(summaries.length, 3);

    // Step 2: Pair summaries with temporal decay weights (most recent first)
    const weighted = weightSummaries([...summaries].reverse(), DEFAULT_CONFIG.compaction.weights);

    assert.equal(weighted.length, 3);
    assert.equal(weighted[0].weight, 1.0);
    assert.equal(weighted[1].weight, 0.6);
    assert.equal(weighted[2].weight, 0.3);

    // Step 3: Build steering prompt with weighted context
    const steering = buildSteeringPrompt(weighted);
    assert.ok(steering.includes('[THREAD_META]'));
    assert.ok(steering.includes('Previous Compaction Summaries'));

    // Step 4: Simulate LLM output with thread meta
    const mockLlmOutput = `GitHub OAuth integration completed and deployed to production.
Rate limiting stable at 100 req/min. All auth endpoints monitored.
System is ready for production traffic.

[THREAD_META]
main: OAuth2 auth system deployed and operational
sub1: GitHub OAuth live in production
sub2: monitoring auth system performance metrics
sub3: planning v2 auth features (PKCE, refresh tokens)
[/THREAD_META]`;

    // Step 5: Parse the output
    const parsed = parseCompactionOutput(mockLlmOutput);

    assert.ok(parsed.meta);
    assert.equal(parsed.meta.main, 'OAuth2 auth system deployed and operational');
    assert.equal(parsed.meta.sub[0], 'GitHub OAuth live in production');
    assert.equal(parsed.meta.sub[1], 'monitoring auth system performance metrics');
    assert.equal(parsed.meta.sub[2], 'planning v2 auth features (PKCE, refresh tokens)');

    // Summary should not contain the meta block
    assert.ok(!parsed.summary.includes('[THREAD_META]'));
    assert.ok(parsed.summary.includes('GitHub OAuth integration completed'));
  });

  test('orientation prompt from last N summaries in session JSONL (thread trajectory)', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    // Read last 3 summaries (oldest first), reverse to most-recent-first, parse thread metas
    const recentSummaries = await reader.readLastNSummaries(filePath, DEFAULT_CONFIG.compaction.windowSize);
    const metas: ThreadMeta[] = recentSummaries
      .slice()
      .reverse()
      .map((s) => parseCompactionOutputBestEffort(s).metaV1)
      .filter((m): m is ThreadMeta => m !== null);

    assert.ok(metas.length > 0);

    const orientation = buildOrientationPrompt(metas);

    assert.ok(orientation !== null);
    // Current state: most recent compaction's thread meta
    assert.ok(orientation!.includes('building OAuth2 authentication system'));
    assert.ok(orientation!.includes('completing GitHub OAuth integration'));
    assert.ok(orientation!.includes('rate limiting live at 100 req/min'));
    assert.ok(orientation!.includes('monitoring auth system performance'));
    // Trajectory from older compactions
    assert.ok(orientation!.includes('Thread trajectory'));
    assert.ok(orientation!.includes('-1:'));
    assert.ok(orientation!.includes('-2:'));
  });

  test('v3 sidecar summaries still produce orientation (hot-swap continuity path)', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const recentSummaries = await reader.readLastNSummaries(filePath, DEFAULT_CONFIG.compaction.windowSize);

    assert.ok(recentSummaries.length > 0);
    const metas: ThreadMeta[] = recentSummaries
      .slice()
      .reverse()
      .map((s) => parseCompactionOutputBestEffort(s).metaV1)
      .filter((m): m is ThreadMeta => m !== null);

    assert.ok(metas.length > 0, 'best-effort parser should recover v3 sidecar meta');
    const orientation = buildOrientationPrompt(metas);
    assert.ok(orientation);
    assert.ok(orientation!.includes('building OAuth2 authentication system'));
  });

  test('readLastNSummaries returns all compaction summaries including plain ones', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-mixed.jsonl');
    const summaries = await reader.readLastNSummaries(filePath, 3);

    // Mixed has 2 compaction events (1 plain, 1 with kaspiett)
    assert.equal(summaries.length, 2);
  });

  test('plain session: summaries have no [THREAD_META], orientation returns null', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
    const recentSummaries = await reader.readLastNSummaries(filePath, DEFAULT_CONFIG.compaction.windowSize);

    // Has summaries but no thread metadata in any supported schema.
    assert.ok(recentSummaries.length > 0);
    const metas: ThreadMeta[] = recentSummaries
      .slice()
      .reverse()
      .map((s) => parseCompactionOutputBestEffort(s).metaV1)
      .filter((m): m is ThreadMeta => m !== null);

    assert.equal(metas.length, 0);
    const orientation = buildOrientationPrompt(metas);
    assert.equal(orientation, null);
  });

  test('weightSummaries preserves correct temporal order and labels', () => {
    const summaries = [
      'most recent compaction summary',
      'previous compaction summary',
      'oldest compaction summary',
    ];

    const weighted = weightSummaries(summaries, [1.0, 0.6, 0.3]);

    assert.equal(weighted[0].summary, 'most recent compaction summary');
    assert.ok(weighted[0].label.includes('most recent'));
    assert.equal(weighted[1].summary, 'previous compaction summary');
    assert.ok(!weighted[1].label.includes('most recent'));
    assert.equal(weighted[2].weight, 0.3);
  });

  test('steering prompt contains weighted summaries verbatim', () => {
    const weighted = weightSummaries(
      ['OAuth deployed. Monitoring active.', 'OAuth setup started.'],
      [1.0, 0.6],
    );

    const steering = buildSteeringPrompt(weighted);

    assert.ok(steering.includes('OAuth deployed. Monitoring active.'));
    assert.ok(steering.includes('OAuth setup started.'));
  });
});
