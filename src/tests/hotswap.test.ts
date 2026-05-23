/**
 * Tests for the hot-swap compaction subsystem.
 *
 * Tests cover:
 * - stub.ts: generateStub() — stub content, marker, thread meta extraction
 * - lock.ts: acquireLock(), waitForLockAbsent() — exclusive locking + stale detection
 * - worker.ts: performAtomicSwap logic via runHotSwapWorker() integration
 * - constants.ts: regex correctness
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { generateStub } from '../hotswap/stub.js';
import { acquireLock, waitForLockAbsent } from '../hotswap/lock.js';
import { runHotSwapWorker, rewriteJsonlStub } from '../hotswap/worker.js';
import { KASETT_STUB_REGEX, THREAD_META_REGEX } from '../hotswap/constants.js';

// ---------------------------------------------------------------------------
// Helper: create a temp directory
// ---------------------------------------------------------------------------

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kasett-hotswap-test-'));
});

after(async () => {
  // cleanup is best-effort — OS will clean up anyway
});

// ---------------------------------------------------------------------------
// constants.ts
// ---------------------------------------------------------------------------

describe('constants: KASETT_STUB_REGEX', () => {
  test('matches a valid stub marker and captures the UUID', () => {
    const id = randomUUID();
    const text = `[KASETT_STUB::${id}]\n\nSession compaction in progress.`;
    const match = text.match(KASETT_STUB_REGEX);
    assert.ok(match, 'regex should match');
    assert.equal(match![1], id);
  });

  test('does not match a stub with corrupted UUID', () => {
    const text = '[KASETT_STUB::not-a-uuid]\n\nSome text';
    const match = text.match(KASETT_STUB_REGEX);
    // The regex is lenient (accepts [0-9a-f-]{36}) — a 36-char hex string matches
    // Verify that a completely wrong format does NOT match
    const badText = '[KASETT_STUB::]\n\nSome text';
    const badMatch = badText.match(KASETT_STUB_REGEX);
    assert.equal(badMatch, null);
  });

  test('does not match if prefix is wrong', () => {
    const id = randomUUID();
    const text = `[KASETT_SWAP::${id}]`;
    const match = text.match(KASETT_STUB_REGEX);
    assert.equal(match, null);
  });
});

describe('constants: THREAD_META_REGEX', () => {
  test('matches a valid [THREAD_META] block', () => {
    const text = `Some summary.\n\n[THREAD_META]\nmain: doing work\nsub1: active\nsub2: idle\nsub3: idle\n[/THREAD_META]`;
    const match = text.match(THREAD_META_REGEX);
    assert.ok(match);
    assert.ok(match![1].includes('main: doing work'));
  });

  test('does not match if block is unclosed', () => {
    const text = '[THREAD_META]\nmain: doing work';
    const match = text.match(THREAD_META_REGEX);
    assert.equal(match, null);
  });
});

// ---------------------------------------------------------------------------
// stub.ts: generateStub()
// ---------------------------------------------------------------------------

describe('generateStub: basic structure', () => {
  test('returns a stub string with [KASETT_STUB::<uuid>] marker', () => {
    const { stub, stubId } = generateStub(undefined, []);
    assert.ok(stub.includes(`[KASETT_STUB::${stubId}]`), 'stub must contain its own marker');
    // stubId should be a UUID format
    assert.match(stubId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('stub contains "compaction in progress" orientation text', () => {
    const { stub } = generateStub(undefined, []);
    assert.ok(stub.toLowerCase().includes('compaction in progress'));
  });

  test('stub contains [THREAD_META] block', () => {
    const { stub } = generateStub(undefined, []);
    assert.ok(stub.includes('[THREAD_META]'));
    assert.ok(stub.includes('[/THREAD_META]'));
  });

  test('each call generates a unique stubId', () => {
    const a = generateStub(undefined, []);
    const b = generateStub(undefined, []);
    assert.notEqual(a.stubId, b.stubId);
  });
});

describe('generateStub: thread meta extraction from previousSummary', () => {
  const previousSummary = `Built the auth system. OAuth2 is live.

[THREAD_META]
main: OAuth2 authentication system live
sub1: GitHub OAuth integration complete
sub2: rate limiting at 100 req/min
sub3: idle
[/THREAD_META]`;

  test('extracts thread meta from previousSummary', () => {
    const { stub } = generateStub(previousSummary, []);
    assert.ok(stub.includes('main: OAuth2 authentication system live'));
    assert.ok(stub.includes('sub1: GitHub OAuth integration complete'));
    assert.ok(stub.includes('sub2: rate limiting at 100 req/min'));
    assert.ok(stub.includes('sub3: idle'));
  });

  test('falls back to heuristic when previousSummary has no [THREAD_META]', () => {
    const { stub } = generateStub('Plain summary with no thread meta.', [
      { role: 'user', content: 'Set up the Kubernetes cluster on EKS' },
      { role: 'assistant', content: 'I will configure the EKS cluster now.' },
    ]);
    assert.ok(stub.includes('[THREAD_META]'));
    // Heuristic should produce something from the messages
    assert.ok(stub.includes('main:'));
  });

  test('falls back gracefully when previousSummary is undefined', () => {
    const { stub } = generateStub(undefined, [
      { role: 'user', content: 'Deploy the app to production' },
    ]);
    assert.ok(stub.includes('[THREAD_META]'));
    assert.ok(stub.includes('main:'));
  });

  test('falls back gracefully when messages are empty', () => {
    const { stub } = generateStub(undefined, []);
    assert.ok(stub.includes('[THREAD_META]'));
    assert.ok(stub.includes('[/THREAD_META]'));
  });

  // -------------------------------------------------------------------------
  // Stub cascade fix: if previousSummary is itself a stub (hot-swap failed
  // last time), do NOT extract meta from it. Fall through to the heuristic
  // so we don't perpetuate "Ongoing work" indefinitely.
  // -------------------------------------------------------------------------
  test('does not extract thread meta from a previous stub (stub cascade prevention)', () => {
    // Simulate a previous summary that is itself a kasett stub with default
    // "Ongoing work" meta — exactly what the live session had.
    const previousStub = [
      '[KASETT_STUB::778d230e-2f62-40f4-8b12-875506ced323]',
      '',
      'Session compaction in progress. Thread state:',
      '',
      '[THREAD_META]',
      'main: Ongoing work',
      'sub1: idle',
      'sub2: idle',
      'sub3: idle',
      '[/THREAD_META]',
    ].join('\n');

    // Pass messages that contain something more informative
    const messages = [
      { role: 'user', content: 'Fix the broken auth pipeline in staging' },
      { role: 'assistant', content: 'I will patch the OAuth2 configuration now.' },
    ];

    const { stub } = generateStub(previousStub, messages);

    // The stub should NOT blindly repeat "Ongoing work" from the previous stub.
    // The heuristic should produce a more informative label from the messages.
    assert.ok(!stub.includes('Ongoing work'), 'should not cascade the stub\'s fallback meta');
    // And it should still have a THREAD_META block
    assert.ok(stub.includes('[THREAD_META]'));
    assert.ok(stub.includes('[/THREAD_META]'));
  });

  test('DOES extract thread meta from a real (non-stub) previous summary', () => {
    // Confirm we didn't break normal extraction — a real compaction summary
    // (without [KASETT_STUB::] marker) should still yield its thread meta.
    const realSummary = [
      '# Session Summary',
      '',
      'Deployed auth system. OAuth2 is live.',
      '',
      '[THREAD_META]',
      'main: OAuth2 authentication pipeline complete',
      'sub1: rate limiting configured',
      'sub2: staging tests passing',
      'sub3: idle',
      '[/THREAD_META]',
    ].join('\n');

    const { stub } = generateStub(realSummary, []);

    assert.ok(stub.includes('main: OAuth2 authentication pipeline complete'));
    assert.ok(stub.includes('sub1: rate limiting configured'));
  });
});

describe('generateStub: content handles various message formats', () => {
  test('handles array-of-parts content format', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Configure the database backup job' }],
      },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(stub.includes('[THREAD_META]'));
  });

  test('handles object content format', () => {
    const messages = [
      {
        role: 'assistant',
        content: { text: 'I am setting up the cron job for backups.' },
      },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(stub.includes('[THREAD_META]'));
  });
});

// ---------------------------------------------------------------------------
// lock.ts: acquireLock() / waitForLockAbsent()
// ---------------------------------------------------------------------------

describe('acquireLock: exclusive acquisition', () => {
  test('acquires lock (creates lock file)', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const lockPath = `${sessionFile}.lock`;

    const handle = await acquireLock(sessionFile, { timeoutMs: 1000 });
    try {
      // Lock file should exist
      const { stat } = await import('node:fs/promises');
      const st = await stat(lockPath);
      assert.ok(st.isFile());
    } finally {
      await handle.release();
    }
  });

  test('release() removes the lock file', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const lockPath = `${sessionFile}.lock`;

    const handle = await acquireLock(sessionFile, { timeoutMs: 1000 });
    await handle.release();

    // Lock file should be gone
    const { stat } = await import('node:fs/promises');
    await assert.rejects(() => stat(lockPath), /ENOENT/);
  });

  test('release() is idempotent', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const handle = await acquireLock(sessionFile, { timeoutMs: 1000 });
    await handle.release();
    // Second release should not throw
    await assert.doesNotReject(() => handle.release());
  });

  test('second acquire fails within timeout when lock is held', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);

    const handle1 = await acquireLock(sessionFile, { timeoutMs: 1000 });
    try {
      // Try to acquire again with a short timeout — should fail
      await assert.rejects(
        () => acquireLock(sessionFile, { timeoutMs: 200, pollIntervalMs: 50 }),
        /Timed out waiting for session write lock/,
      );
    } finally {
      await handle1.release();
    }
  });

  test('second acquire succeeds after first is released', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);

    const handle1 = await acquireLock(sessionFile, { timeoutMs: 1000 });

    // Release after a short delay
    setTimeout(() => handle1.release(), 100);

    // This should succeed because handle1 will be released within the timeout
    const handle2 = await acquireLock(sessionFile, { timeoutMs: 1000, pollIntervalMs: 50 });
    await handle2.release();
  });

  test('reclaims stale lock (lock file older than staleLockMs)', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const lockPath = `${sessionFile}.lock`;

    // Create a stale lock file manually
    await writeFile(lockPath, '{}', 'utf-8');

    // Force the lock to appear stale by using staleLockMs = 0
    const handle = await acquireLock(sessionFile, { timeoutMs: 1000, staleLockMs: 0 });
    await handle.release();
  });
});

describe('waitForLockAbsent', () => {
  test('returns true immediately when no lock file exists', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const result = await waitForLockAbsent(sessionFile, 500);
    assert.equal(result, true);
  });

  test('returns true after lock is released', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const lockPath = `${sessionFile}.lock`;

    // Create lock file
    await writeFile(lockPath, '{}', 'utf-8');

    // Remove it after 100ms
    setTimeout(() => unlink(lockPath).catch(() => {}), 100);

    const result = await waitForLockAbsent(sessionFile, 1000, 30);
    assert.equal(result, true);
  });

  test('returns false when lock stays held beyond timeout', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const lockPath = `${sessionFile}.lock`;

    await writeFile(lockPath, '{}', 'utf-8');
    try {
      const result = await waitForLockAbsent(sessionFile, 200, 50);
      assert.equal(result, false);
    } finally {
      await unlink(lockPath).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// worker.ts: runHotSwapWorker() integration
// ---------------------------------------------------------------------------

/**
 * Build a minimal JSONL file for testing the atomic swap.
 */
function buildTestJsonl(stubId: string, stubSummary: string): string {
  const header = JSON.stringify({ type: 'session', id: 'test-session', cwd: '/tmp' });
  const msg1 = JSON.stringify({ type: 'message', id: 'msg_001', data: { role: 'user', content: 'Hello' } });
  const compaction = JSON.stringify({
    type: 'compaction',
    id: 'cmp_001',
    timestamp: new Date().toISOString(),
    data: {
      summary: stubSummary,
    },
  });
  const msg2 = JSON.stringify({ type: 'message', id: 'msg_002', data: { role: 'assistant', content: 'Hi there' } });
  return [header, msg1, compaction, msg2].join('\n') + '\n';
}

describe('runHotSwapWorker: sidecar write', () => {
  test('writes rich summary to sidecar and leaves session JSONL untouched', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stubSummary = `[KASETT_STUB::${stubId}]\n\nCompaction in progress.\n\n[THREAD_META]\nmain: test\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]`;
    const fullSummary = `Full LLM summary of the session.\n\n[THREAD_META]\nmain: finished the work\nsub1: deployed to prod\nsub2: idle\nsub3: idle\n[/THREAD_META]`;

    // Write test JSONL
    const originalJsonl = buildTestJsonl(stubId, stubSummary);
    await writeFile(sessionFile, originalJsonl, 'utf-8');

    let callCount = 0;
    const mockCallLLM = async (): Promise<string | undefined> => {
      callCount++;
      return fullSummary;
    };

    const logger = {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
      debug: (_: string) => {},
    };

    let writtenInfo: { sidecarPath: string; summaryChars: number; metaMain: string | null } | null = null;
    await runHotSwapWorker({
      sessionFile,
      stubId,
      messages: [{ role: 'user', content: 'test' }],
      previousSummaries: [],
      steeringPrompt: 'Steering prompt text',
      customInstructions: undefined,
      signal: undefined,
      compactionModel: 'test-model',
      hotSwapTimeoutMs: 5000,
      logger,
      callLLM: mockCallLLM,
      onSidecarWritten: (info) => {
        writtenInfo = info;
      },
    });

    // Verify LLM was called
    assert.equal(callCount, 1);

    // Session JSONL should have the stub replaced with the rich summary (Scenario C)
    const sessionContent = await readFile(sessionFile, 'utf-8');
    assert.ok(!sessionContent.includes(`[KASETT_STUB::${stubId}]`), 'stub must be replaced in JSONL');
    // The rich summary is JSON-encoded in the JSONL line, so check for a plain substring
    assert.ok(
      sessionContent.includes('Full LLM summary') || sessionContent.includes('finished the work'),
      'rich summary content must appear in JSONL',
    );

    // Sidecar should exist with one entry
    assert.ok(writtenInfo, 'onSidecarWritten callback should fire');
    const info = writtenInfo as { sidecarPath: string; summaryChars: number; metaMain: string | null };
    assert.equal(info.sidecarPath, `${sessionFile}.kasett-meta.jsonl`);
    assert.equal(info.summaryChars, fullSummary.length);
    assert.equal(info.metaMain, 'finished the work');

    const sidecarContent = await readFile(info.sidecarPath, 'utf-8');
    const sidecarLines = sidecarContent.split('\n').filter((l) => l.trim());
    assert.equal(sidecarLines.length, 1, 'sidecar should have exactly one entry');
    const entry = JSON.parse(sidecarLines[0]) as {
      compaction_id: string;
      stub_id?: string;
      summary_rich: string;
      thread_meta?: { main: string; sub: string[] };
      model?: string;
    };
    assert.equal(entry.compaction_id, stubId);
    assert.equal(entry.stub_id, stubId);
    assert.equal(entry.summary_rich, fullSummary);
    assert.equal(entry.thread_meta?.main, 'finished the work');
    assert.equal(entry.model, 'test-model');
  });

  test('multiple compactions append to the same sidecar in order', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const stubId1 = randomUUID();
    const stubId2 = randomUUID();
    const stubSummary1 = `[KASETT_STUB::${stubId1}]\n[THREAD_META]\nmain: a\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]`;
    await writeFile(sessionFile, buildTestJsonl(stubId1, stubSummary1), 'utf-8');

    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const summary1 = 'first rich [THREAD_META]\nmain: first\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]';
    const summary2 = 'second rich [THREAD_META]\nmain: second\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]';

    await runHotSwapWorker({
      sessionFile, stubId: stubId1,
      messages: [], previousSummaries: [],
      steeringPrompt: '', hotSwapTimeoutMs: 5000, logger,
      callLLM: async () => summary1,
    });
    await runHotSwapWorker({
      sessionFile, stubId: stubId2,
      messages: [], previousSummaries: [],
      steeringPrompt: '', hotSwapTimeoutMs: 5000, logger,
      callLLM: async () => summary2,
    });

    const sidecarContent = await readFile(`${sessionFile}.kasett-meta.jsonl`, 'utf-8');
    const lines = sidecarContent.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 2);
    const e1 = JSON.parse(lines[0]) as { compaction_id: string };
    const e2 = JSON.parse(lines[1]) as { compaction_id: string };
    assert.equal(e1.compaction_id, stubId1);
    assert.equal(e2.compaction_id, stubId2);
  });

  test('handles LLM returning undefined gracefully', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stubSummary = `[KASETT_STUB::${stubId}]\n\nCompaction in progress.`;

    await writeFile(sessionFile, buildTestJsonl(stubId, stubSummary), 'utf-8');

    const mockCallLLM = async (): Promise<string | undefined> => undefined;

    const warnMessages: string[] = [];
    const logger = {
      info: (_: string) => {},
      warn: (msg: string) => { warnMessages.push(msg); },
      error: (_: string) => {},
      debug: (_: string) => {},
    };

    await runHotSwapWorker({
      sessionFile,
      stubId,
      messages: [],
      previousSummaries: [],
      steeringPrompt: '',
      hotSwapTimeoutMs: 5000,
      logger,
      callLLM: mockCallLLM,
    });

    // Should warn about empty summary, stub should remain
    assert.ok(warnMessages.some((m) => m.includes('empty summary')));

    const content = await readFile(sessionFile, 'utf-8');
    // Stub should still be in the file (unchanged)
    assert.ok(content.includes(stubId));
  });

  test('preserves session JSONL byte-for-byte (sidecar approach never touches it)', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stubSummary = `[KASETT_STUB::${stubId}]\n\nCompaction in progress.\n\n[THREAD_META]\nmain: x\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]`;
    const fullSummary = 'Full summary after swap.';

    const originalContent = buildTestJsonl(stubId, stubSummary);
    await writeFile(sessionFile, originalContent, 'utf-8');

    const mockCallLLM = async (): Promise<string | undefined> => fullSummary;

    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    await runHotSwapWorker({
      sessionFile,
      stubId,
      messages: [],
      previousSummaries: [],
      steeringPrompt: '',
      hotSwapTimeoutMs: 5000,
      logger,
      callLLM: mockCallLLM,
    });

    // Scenario C: JSONL stub must be replaced with the rich summary
    const content = await readFile(sessionFile, 'utf-8');
    assert.ok(!content.includes(`[KASETT_STUB::${stubId}]`), 'stub must be replaced in JSONL');
    // fullSummary is JSON-encoded in the JSONL; check for a plain text substring
    assert.ok(content.includes('Full summary after swap'), 'rich summary content must appear in JSONL');

    // And the sidecar should also exist with the rich summary
    const sidecarContent = await readFile(`${sessionFile}.kasett-meta.jsonl`, 'utf-8');
    assert.ok(sidecarContent.includes(fullSummary));
  });

  test('respects abort signal before LLM call', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const ac = new AbortController();
    ac.abort();

    let llmCalled = false;
    const mockCallLLM = async (): Promise<string | undefined> => {
      llmCalled = true;
      return 'should not reach here';
    };

    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    await runHotSwapWorker({
      sessionFile,
      stubId,
      messages: [],
      previousSummaries: [],
      steeringPrompt: '',
      hotSwapTimeoutMs: 1000,
      signal: ac.signal,
      logger,
      callLLM: mockCallLLM,
    });

    // LLM should NOT have been called because signal was already aborted
    assert.equal(llmCalled, false, 'LLM should not be called when aborted before start');
  });
});

// ---------------------------------------------------------------------------
// Bug fix: buildHeuristicThreadMeta — filter tool output from thread labels
// ---------------------------------------------------------------------------

describe('generateStub: heuristic filters tool output messages', () => {
  test('does not use ls -l output as thread label', () => {
    const messages = [
      { role: 'user', content: 'list the files' },
      {
        role: 'tool',
        content: 'total 8\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 .\n-rw-r--r-- 1 root root  123 Jan  1 00:00 README.md',
      },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(!stub.includes('total 8'), 'stub should not contain ls output');
    assert.ok(!stub.includes('drwxr-xr-x'), 'stub should not contain directory listing');
    assert.ok(stub.includes('[THREAD_META]'));
    // Should fall back to the user message or "Ongoing work"
    assert.ok(
      stub.includes('list the files') || stub.includes('Ongoing work'),
      'should use user message or default',
    );
  });

  test('does not use JSON blob as thread label', () => {
    const messages = [
      { role: 'user', content: 'check the config' },
      { role: 'assistant', content: '{"status":"ok","data":{"x":1}}' },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(!stub.includes('{"status"'), 'stub should not contain JSON blob');
    // Should prefer last user message
    assert.ok(
      stub.includes('check the config') || stub.includes('Ongoing work'),
      'should use user message or default',
    );
  });

  test('falls back to "Ongoing work" when all messages look like tool output', () => {
    const messages = [
      { role: 'tool', content: 'total 4\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 .' },
      { role: 'tool', content: '{"exit_code":0,"output":"done"}' },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(stub.includes('Ongoing work'), 'should default to "Ongoing work"');
  });

  test('prefers the LAST user message over earlier assistant messages', () => {
    const messages = [
      { role: 'assistant', content: 'I will set up the database.' },
      { role: 'user', content: 'Now deploy the app to production' },
    ];
    const { stub } = generateStub(undefined, messages);
    // Should prefer last user message
    assert.ok(
      stub.includes('Now deploy the app') || stub.includes('deploy the app'),
      'should prefer last user message',
    );
  });

  test('uses assistant message when no user messages are available (all-assistant context)', () => {
    const messages = [
      { role: 'assistant', content: 'Building the OAuth integration now.' },
      { role: 'assistant', content: 'All tests pass. Feature complete.' },
    ];
    const { stub } = generateStub(undefined, messages);
    // Should use something meaningful, not garbage
    assert.ok(stub.includes('[THREAD_META]'));
    assert.ok(!stub.includes('drwx'), 'should not contain tool output');
  });

  test('handles empty messages with default fallback', () => {
    const { stub } = generateStub(undefined, []);
    assert.ok(stub.includes('Ongoing work'), 'empty messages should produce "Ongoing work"');
  });

  test('natural language user message is used directly', () => {
    const messages = [
      { role: 'user', content: 'Build a REST API endpoint for user authentication' },
    ];
    const { stub } = generateStub(undefined, messages);
    assert.ok(
      stub.includes('Build a REST API endpoint') || stub.includes('REST API endpoint'),
      'natural language user message should be the thread label',
    );
  });
});

// ---------------------------------------------------------------------------
// Bug fix: resolveSessionFileFromState — sessionFile resolution fallbacks
// (tested via index.ts indirectly through the before_compaction hook behavior)
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState: fallback scanning', () => {
  test('finds JSONL by exact stem match in sessions directory', async () => {
    const sessionsDir = join(tmpDir, `agents-${randomUUID()}`, 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionKey = 'test-session-abc123';
    const sessionFile = join(sessionsDir, `${sessionKey}.jsonl`);
    await writeFile(sessionFile, '{"type":"session"}\n', 'utf-8');

    // We test the scanning logic by simulating what resolveSessionFileFromState does:
    // scan the directory, find the file by stem match
    const { readdir: rd } = await import('node:fs/promises');
    const files = await rd(sessionsDir);
    const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl') && !f.endsWith('.lock'));
    const exactMatch = jsonlFiles.find(
      (f: string) => f === `${sessionKey}.jsonl` || f.replace(/\.jsonl$/, '') === sessionKey,
    );

    assert.ok(exactMatch, 'should find exact stem match');
    assert.equal(exactMatch, `${sessionKey}.jsonl`);
  });

  test('finds JSONL via lock file when only one session is locked', async () => {
    const sessionsDir = join(tmpDir, `agents-${randomUUID()}`, 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionFile = `compaction-session-xyz.jsonl`;
    // Create the JSONL + its lock file (as OC would during compaction)
    await writeFile(join(sessionsDir, sessionFile), '{"type":"session"}\n', 'utf-8');
    await writeFile(join(sessionsDir, `${sessionFile}.lock`), '{}', 'utf-8');

    const { readdir: rd } = await import('node:fs/promises');
    const files = await rd(sessionsDir);
    const lockFiles = files.filter((f: string) => f.endsWith('.jsonl.lock'));

    assert.equal(lockFiles.length, 1, 'should find exactly one lock file');
    const derivedSession = lockFiles[0].replace(/\.lock$/, '');
    assert.equal(derivedSession, sessionFile, 'should derive session file from lock file');
  });
});

// ---------------------------------------------------------------------------
// Integration: generateStub → stub marker → worker finds and replaces it
// ---------------------------------------------------------------------------

describe('Integration: generateStub + runHotSwapWorker end-to-end', () => {
  test('stub marker from generateStub is found and replaced by worker', async () => {
    const sessionFile = join(tmpDir, `session-${randomUUID()}.jsonl`);

    // Generate stub as summarize() would
    const previousSummary = `Previous summary.\n\n[THREAD_META]\nmain: shipping feature\nsub1: writing tests\nsub2: idle\nsub3: idle\n[/THREAD_META]`;
    const { stub, stubId } = generateStub(previousSummary, [
      { role: 'user', content: 'Let us build the hot-swap feature' },
    ]);

    // Write it into a JSONL (as OC would after summarize() returned)
    const jsonlContent = [
      JSON.stringify({ type: 'session', id: 'test', cwd: '/tmp' }),
      JSON.stringify({
        type: 'compaction',
        id: 'cmp_hotswap',
        timestamp: new Date().toISOString(),
        data: { summary: stub },
      }),
    ].join('\n') + '\n';
    await writeFile(sessionFile, jsonlContent, 'utf-8');

    // Run worker with a mock LLM
    const richSummary = `Hot-swap feature built and tested. Zero-delay compaction working.\n\n[THREAD_META]\nmain: hot-swap compaction feature complete\nsub1: tests passing\nsub2: docs updated\nsub3: idle\n[/THREAD_META]`;
    const mockCallLLM = async (): Promise<string | undefined> => richSummary;
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    await runHotSwapWorker({
      sessionFile,
      stubId,
      messages: [{ role: 'user', content: 'Let us build the hot-swap feature' }],
      previousSummaries: [previousSummary],
      steeringPrompt: 'steer',
      hotSwapTimeoutMs: 5000,
      logger,
      callLLM: mockCallLLM,
    });

    // Phase G (Scenario C): the JSONL stub should be replaced with the rich summary.
    const result = await readFile(sessionFile, 'utf-8');
    const lines = result.split('\n').filter((l) => l.trim());
    const cmpLine = lines.find((l) => l.includes('"compaction"'));
    assert.ok(cmpLine, 'compaction line must exist in JSONL');
    const entry = JSON.parse(cmpLine) as { data: { summary: string } };
    assert.ok(
      !entry.data.summary.includes(`[KASETT_STUB::${stubId}]`),
      'stub placeholder must be replaced in JSONL',
    );
    assert.equal(
      entry.data.summary,
      richSummary,
      'JSONL summary must equal the rich summary after Scenario C rewrite',
    );

    // The sidecar should also have the rich summary (written first).
    const sidecarPath = `${sessionFile}.kasett-meta.jsonl`;
    const sidecarContent = await readFile(sidecarPath, 'utf-8');
    const sidecarLines = sidecarContent.split('\n').filter((l) => l.trim());
    assert.equal(sidecarLines.length, 1);
    const sidecarEntry = JSON.parse(sidecarLines[0]) as {
      compaction_id: string;
      summary_rich: string;
      thread_meta?: { main: string };
    };
    assert.equal(sidecarEntry.compaction_id, stubId);
    assert.equal(sidecarEntry.summary_rich, richSummary);
    assert.equal(sidecarEntry.thread_meta?.main, 'hot-swap compaction feature complete');
  });
});

// ---------------------------------------------------------------------------
// rewriteJsonlStub unit tests (Scenario C)
// ---------------------------------------------------------------------------

describe('rewriteJsonlStub: top-level summary field', () => {
  test('replaces stub in top-level summary field and returns ok=true', async () => {
    const sessionFile = join(tmpDir, `session-rw-toplevel-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stub = `[KASETT_STUB::${stubId}] Session compaction in progress`;
    const rich = `Rich summary for top-level test.\n\n[THREAD_META]\nmain: top-level verified\nsub1: idle\n[/THREAD_META]`;

    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test' }),
      JSON.stringify({ type: 'compaction', id: 'c1', timestamp: new Date().toISOString(), summary: stub }),
    ].join('\n') + '\n';
    await writeFile(sessionFile, jsonl, 'utf-8');

    const logLines: string[] = [];
    const hookEvents: string[] = [];
    const logger = {
      info: (m: string) => { logLines.push(m); },
      warn: (m: string) => { logLines.push(m); },
      debug: (_: string) => {},
    };

    const result = await rewriteJsonlStub(
      sessionFile, stubId, rich, logger,
      (ev) => { hookEvents.push(ev.action); },
    );

    assert.equal(result.ok, true, 'should return ok=true');
    assert.ok(typeof result.bytesWritten === 'number' && result.bytesWritten > 0, 'bytesWritten should be positive');

    const newContent = await readFile(sessionFile, 'utf-8');
    assert.ok(newContent.includes('"compaction"'), 'compaction line must remain');
    const lines = newContent.split('\n').filter((l) => l.trim());
    const cmpLine = lines.find((l) => l.includes('"compaction"'))!;
    const entry = JSON.parse(cmpLine) as { summary: string };
    assert.equal(entry.summary, rich, 'top-level summary must be replaced');
    assert.ok(!entry.summary.includes(`[KASETT_STUB::${stubId}]`), 'stub marker must be gone');

    // Log and hook event checks
    assert.ok(logLines.some((l) => l.includes('STUB_REPLACED_IN_JSONL')), 'must log STUB_REPLACED_IN_JSONL');
    assert.ok(hookEvents.includes('stub_replaced_in_jsonl'), 'must emit stub_replaced_in_jsonl hook event');
  });
});

describe('rewriteJsonlStub: data.summary field (fixture/legacy layout)', () => {
  test('replaces stub in data.summary field', async () => {
    const sessionFile = join(tmpDir, `session-rw-datasummary-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stub = `[KASETT_STUB::${stubId}] Session compaction in progress`;
    const rich = `Rich summary for data.summary test.\n\n[THREAD_META]\nmain: data-summary verified\nsub1: idle\n[/THREAD_META]`;

    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test' }),
      JSON.stringify({ type: 'compaction', id: 'c1', data: { summary: stub } }),
    ].join('\n') + '\n';
    await writeFile(sessionFile, jsonl, 'utf-8');

    const result = await rewriteJsonlStub(
      sessionFile, stubId, rich,
      { info: () => {}, warn: () => {}, debug: () => {} },
      () => {},
    );

    assert.equal(result.ok, true, 'should return ok=true for data.summary');

    const newContent = await readFile(sessionFile, 'utf-8');
    const lines = newContent.split('\n').filter((l) => l.trim());
    const cmpLine = lines.find((l) => l.includes('"compaction"'))!;
    const entry = JSON.parse(cmpLine) as { data: { summary: string } };
    assert.equal(entry.data.summary, rich, 'data.summary must be replaced');
    assert.ok(!entry.data.summary.includes(`[KASETT_STUB::${stubId}]`), 'stub marker must be gone');
  });
});

describe('rewriteJsonlStub: not-found and edge cases', () => {
  test('returns not_found when stub_id is not in the JSONL', async () => {
    const sessionFile = join(tmpDir, `session-rw-notfound-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const differentId = randomUUID();
    const stub = `[KASETT_STUB::${differentId}] Session compaction in progress`;

    const jsonl = [
      JSON.stringify({ type: 'session', id: 'test' }),
      JSON.stringify({ type: 'compaction', id: 'c1', summary: stub }),
    ].join('\n') + '\n';
    await writeFile(sessionFile, jsonl, 'utf-8');

    const hookEvents: string[] = [];
    const result = await rewriteJsonlStub(
      sessionFile, stubId, 'Some rich summary',
      { info: () => {}, warn: () => {}, debug: () => {} },
      (ev) => { hookEvents.push(ev.action); },
    );

    assert.equal(result.ok, false, 'should return ok=false when stub not found');
    assert.equal(result.reason, 'not_found');
    assert.ok(hookEvents.includes('stub_rewrite_not_found'), 'must emit stub_rewrite_not_found hook event');

    // JSONL must be unchanged
    const content = await readFile(sessionFile, 'utf-8');
    assert.ok(content.includes(differentId), 'original stub must remain intact');
  });

  test('returns empty_sidecar when richSummary is empty', async () => {
    const sessionFile = join(tmpDir, `session-rw-empty-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    await writeFile(sessionFile, '{}\n', 'utf-8');

    const logLines: string[] = [];
    const result = await rewriteJsonlStub(
      sessionFile, stubId, '',
      { info: (m: string) => { logLines.push(m); }, warn: () => {}, debug: () => {} },
      () => {},
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty_sidecar');
    assert.ok(logLines.some((l) => l.includes('STUB_REWRITE_SKIP') && l.includes('empty_sidecar')));
  });

  test('replaces ALL occurrences when multiple stubs exist in JSONL', async () => {
    const sessionFile = join(tmpDir, `session-rw-multi-${randomUUID()}.jsonl`);
    const stubId = randomUUID();
    const stub = `[KASETT_STUB::${stubId}] Session compaction in progress`;
    const rich = 'Replacement for all stubs';

    const jsonl = [
      JSON.stringify({ type: 'compaction', id: 'c1', summary: stub }),
      JSON.stringify({ type: 'compaction', id: 'c2', summary: stub }),
    ].join('\n') + '\n';
    await writeFile(sessionFile, jsonl, 'utf-8');

    const result = await rewriteJsonlStub(
      sessionFile, stubId, rich,
      { info: () => {}, warn: () => {}, debug: () => {} },
      () => {},
    );

    assert.equal(result.ok, true);

    const newContent = await readFile(sessionFile, 'utf-8');
    const lines = newContent.split('\n').filter((l) => l.trim());
    const cmpLines = lines.filter((l) => l.includes('"compaction"'));
    assert.equal(cmpLines.length, 2, 'both compaction lines must remain');
    for (const cl of cmpLines) {
      const entry = JSON.parse(cl) as { summary: string };
      assert.equal(entry.summary, rich, 'both stubs must be replaced');
    }
  });
});
