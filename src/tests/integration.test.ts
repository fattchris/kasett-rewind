import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionReader } from '../storage/reader.js';
import { ThreadTracker } from '../compaction/threads.js';
import { CompactionWindow } from '../compaction/window.js';
import { buildCompactionPrompt } from '../compaction/prompt.js';
import { generateCustomInstructions } from '../phase1/instructions.js';
import { SectionLoader } from '../phase1/section-loader.js';
import { DEFAULT_CONFIG } from '../types.js';
import type { CompactionSummary, KasettConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('Integration: Full Pipeline', () => {
  test('read fixture → load into window → generate prompt → parse mock output → validate threads', async () => {
    // Step 1: Read session JSONL
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const summaries = await reader.readCompactionSummaries(filePath);

    assert.equal(summaries.length, 2);

    // Step 2: Load into window
    const window = new CompactionWindow({ windowSize: 2 });
    window.load(summaries);
    assert.equal(window.size, 2);

    // Step 3: Generate prompt for next compaction
    const previousSummaries = window.getAll();
    const prompt = buildCompactionPrompt(previousSummaries, 2000);

    assert.ok(prompt.includes('PREVIOUS COMPACTION'));
    assert.ok(prompt.includes('OAuth2'));
    assert.ok(prompt.includes('OUTPUT FORMAT'));

    // Step 4: Simulate LLM output (mock)
    // Keep the main thread name close to previous for fuzzy match to pass
    const mockLlmOutput = `### Main Thread
Building OAuth2 authentication system — completing rate limiting

### Active Sub-threads (max 3)
1. Rate limiting — Implemented 100 req/min per client
2. GitHub OAuth — Redirect URL registered, testing flow

### Thread History
- OAuth2 provider config: completed — Google flow fully working
- Database migration: completed — Postgres 15.2 upgrade successful

### Key State
- targetVersion: PostgreSQL 15.2
- oauthProviders: Google (live), GitHub (testing)
- redirectUrl: https://auth.moltai.com/callback
- rateLimitTarget: /api/v1/token
- rateLimit: 100 req/min per client

### Unresolved
- GitHub OAuth scope approval pending from security team

### Narrative Summary
Rate limiting implementation completed for the token endpoint at 100 req/min. Google OAuth is in production. GitHub OAuth redirect registered and flow testing underway. All database work finished.`;

    // Step 5: Parse the mock output
    const parsedSnapshot = ThreadTracker.parse(mockLlmOutput);

    assert.equal(
      parsedSnapshot.mainThread,
      'Building OAuth2 authentication system — completing rate limiting',
    );
    assert.equal(parsedSnapshot.subThreads.length, 2);
    assert.equal(parsedSnapshot.subThreads[0].name, 'Rate limiting');
    assert.equal(parsedSnapshot.subThreads[1].name, 'GitHub OAuth');
    assert.equal(parsedSnapshot.threadHistory.length, 2);
    assert.equal(parsedSnapshot.keyState['rateLimit'], '100 req/min per client');
    assert.equal(parsedSnapshot.unresolved.length, 1);

    // Step 6: Validate thread evolution against previous
    const latestSummary = window.getLatest();
    assert.ok(latestSummary);
    const violations = ThreadTracker.validate(
      parsedSnapshot,
      latestSummary.threadSnapshot,
    );

    // Should have no violations — all threads from previous are accounted for
    assert.deepEqual(violations, []);
  });

  test('detect thread violation in mock output', async () => {
    // Read fixture
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const summaries = await reader.readCompactionSummaries(filePath);

    // Load the latest
    const latestSnapshot = summaries[summaries.length - 1].threadSnapshot;

    // Bad mock output that drops a thread
    const badMockOutput = `### Main Thread
Working on something completely new

### Active Sub-threads (max 3)
1. New thing A — doing stuff

### Key State
- key: value

### Summary
Forgot everything about OAuth and rate limiting.`;

    const parsedSnapshot = ThreadTracker.parse(badMockOutput);
    const violations = ThreadTracker.validate(parsedSnapshot, latestSnapshot);

    // Should detect violations — OAuth2 provider config and Rate limiting are missing
    assert.ok(violations.length > 0);
  });

  test('thread history merging across multiple compactions', async () => {
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const summaries = await reader.readCompactionSummaries(filePath);

    // Take the second summary as "previous"
    const previousSummary = summaries[1];

    // Create a new snapshot where OAuth is now done
    const currentSnapshot = ThreadTracker.parse(`### Main Thread
Building rate limiting system

### Active Sub-threads (max 3)
1. Rate limiting — Testing with load balancer

### Thread History
- OAuth2 provider config: completed — Both Google and GitHub working

### Key State
- rateLimit: 100 req/min
- loadBalancer: nginx

### Unresolved
- Load test results pending`);

    // Merge history
    const merged = ThreadTracker.mergeHistory(currentSnapshot, previousSummary);

    // Should carry forward the "Database migration" history from previous
    const dbThread = merged.threadHistory.find(
      (h) => h.thread === 'Database migration',
    );
    assert.ok(dbThread, 'Database migration history should be carried forward');
    assert.equal(dbThread.status, 'completed');
  });

  test('section loader formats previous summaries for injection', async () => {
    const config: KasettConfig = {
      windowSize: 2,
      windowBudgetSplit: [0.3, 0.3, 0.4],
      threadTracking: true,
    };

    const loader = new SectionLoader(config);
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const result = await loader.loadSections(filePath, 5000);

    // Should load 1 previous summary (excludes the most recent)
    assert.equal(result.summaryCount, 1);
    assert.ok(result.content.includes('kasett-rewind'));
    assert.ok(result.content.includes('OAuth2'));
    assert.ok(result.content.includes('PostgreSQL 15.2'));
  });

  test('section loader returns empty for single-window config', async () => {
    const config: KasettConfig = {
      windowSize: 1,
      windowBudgetSplit: [0.6, 0.4],
      threadTracking: true,
    };

    const loader = new SectionLoader(config);
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
    const result = await loader.loadSections(filePath, 5000);

    assert.equal(result.summaryCount, 0);
    assert.equal(result.content, '');
    assert.equal(result.wasTruncated, false);
  });

  test('section loader truncates when budget is small', async () => {
    const config: KasettConfig = {
      windowSize: 2,
      windowBudgetSplit: [0.3, 0.3, 0.4],
      threadTracking: true,
    };

    const loader = new SectionLoader(config);
    const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');

    // Very small budget forces truncation
    const result = await loader.loadSections(filePath, 200);

    assert.equal(result.summaryCount, 1);
    assert.ok(result.content.length > 0);
    assert.equal(result.wasTruncated, true);
  });

  test('custom instructions contain all required sections', () => {
    const instructions = generateCustomInstructions(DEFAULT_CONFIG);

    // Verify all mandatory sections are present
    const requiredSections = [
      'Main Thread',
      'Active Sub-threads',
      'Thread History',
      'Key State',
      'Unresolved',
      'Summary',
      'RULES:',
    ];

    for (const section of requiredSections) {
      assert.ok(
        instructions.includes(section),
        `Missing required section: ${section}`,
      );
    }
  });

  test('end-to-end: plain OC session → kasett window bootstrap', async () => {
    // Simulate: user has a session with plain compaction events,
    // then enables kasett-rewind. The reader should handle gracefully.
    const reader = new SessionReader();
    const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
    const summaries = await reader.readCompactionSummaries(filePath);

    // Load into window
    const window = new CompactionWindow({ windowSize: 2 });
    window.load(summaries);

    // Should work — just with empty thread snapshots
    assert.equal(window.size, 2);
    const latest = window.getLatest();
    assert.ok(latest);
    assert.equal(latest.threadSnapshot.mainThread, 'Unknown');

    // Generate prompt (should still work with empty snapshots)
    const prompt = buildCompactionPrompt(window.getAll(), 2000);
    assert.ok(prompt.includes('OUTPUT FORMAT'));
  });
});
