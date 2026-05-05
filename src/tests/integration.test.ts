import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionReader } from '../storage/reader.js';
import { analyzeThreads } from '../threads/weight.js';
import { buildSteeringPrompt, buildOrientationPrompt } from '../threads/steering.js';
import { parseCompactionOutput } from '../threads/parser.js';
import { DEFAULT_CONFIG } from '../types.js';
import type { ThreadMeta } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('Integration: Full Pipeline', () => {
  test('read fixture → extract metas → weight → steer → parse output', async () => {
    // Step 1: Read session JSONL
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const events = await reader.readLastNWithMeta(filePath, DEFAULT_CONFIG.windowSize);

    assert.equal(events.length, 3);

    // Step 2: Extract metas (most recent first for analysis)
    const metas: ThreadMeta[] = events
      .filter((e) => e.data.kaspiett != null)
      .map((e) => e.data.kaspiett!)
      .reverse();

    assert.equal(metas.length, 3);

    // Step 3: Analyze with weights
    const analysis = analyzeThreads(metas, DEFAULT_CONFIG.weights);

    // "building OAuth2 authentication system for MoltAI platform" appears in all 3 = core
    assert.ok(analysis.core.some((t) => t.toLowerCase().includes('oauth2 authentication')));

    // Step 4: Build steering prompt
    const steering = buildSteeringPrompt(analysis, metas);
    assert.ok(steering.includes('[THREAD_META]'));
    assert.ok(steering.includes('Core Threads'));

    // Step 5: Simulate LLM output with thread meta
    const mockLlmOutput = `GitHub OAuth integration completed and deployed to production.
Rate limiting stable at 100 req/min. All auth endpoints monitored.
System is ready for production traffic.

[THREAD_META]
main: OAuth2 auth system deployed and operational
sub1: GitHub OAuth live in production
sub2: monitoring auth system performance metrics
sub3: planning v2 auth features (PKCE, refresh tokens)
[/THREAD_META]`;

    // Step 6: Parse the output
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

  test('orientation prompt from latest meta', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const meta = await reader.readLatestMeta(filePath);

    assert.ok(meta);

    const orientation = buildOrientationPrompt(meta);

    assert.ok(orientation.includes('building OAuth2 authentication system'));
    assert.ok(orientation.includes('completing GitHub OAuth integration'));
    assert.ok(orientation.includes('rate limiting live at 100 req/min'));
    assert.ok(orientation.includes('monitoring auth system performance'));
  });

  test('mixed session: only kaspiett events are analyzed', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-mixed.jsonl');
    const events = await reader.readLastNWithMeta(filePath, 3);

    // Only 1 event has kaspiett
    assert.equal(events.length, 1);

    const metas = events.map((e) => e.data.kaspiett!).reverse();
    const analysis = analyzeThreads(metas, [1.0]);

    // All threads are "fresh" since only one compaction
    assert.ok(analysis.fresh.length > 0);
    assert.deepEqual(analysis.core, []);
    assert.deepEqual(analysis.fading, []);
  });

  test('plain session: no metas available, orientation returns null', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
    const meta = await reader.readLatestMeta(filePath);

    assert.equal(meta, null);
  });

  test('thread evolution: core threads persist, fading threads captured', async () => {
    // Simulate 3 compactions where a thread fades out
    const metas: ThreadMeta[] = [
      // Most recent: auth is gone, now doing deploys
      {
        main: 'deploying to production',
        sub: ['health checks', 'load balancer config', 'DNS setup'],
      },
      // Previous: auth still main
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'rate limiting', 'deploying to production'],
      },
      // Oldest: auth was main
      {
        main: 'building auth system',
        sub: ['OAuth setup', 'database migration', 'testing'],
      },
    ];

    const analysis = analyzeThreads(metas, [1.0, 0.6, 0.3]);

    // "deploying to production" appears in index 0 and 1 = core
    assert.ok(analysis.core.some((t) => t.toLowerCase().includes('deploying to production')));

    // "building auth system" appears in index 1 and 2 but NOT 0 = fading
    assert.ok(analysis.fading.some((t) => t.toLowerCase().includes('building auth')));

    // "health checks", "load balancer config", "DNS setup" only in 0 = fresh
    assert.ok(analysis.fresh.some((t) => t.toLowerCase().includes('health checks')));
  });
});
