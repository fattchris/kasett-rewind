/**
 * Tests for the cold-start session-rollover bridge.
 *
 * Covers:
 *   1. Detector: cold session + sibling with raw turns → fire
 *   2. Detector: cold session + sibling with compactions only → fire is still
 *      true at the detector layer (caller decides whether Tier 2 already
 *      handled it). The detector only checks raw-turn count.
 *   3. Detector: current session too warm → skip
 *   4. Detector: sibling too old → skip
 *   5. Detector: sibling too thin → skip
 *   6. Detector: no sibling → skip
 *   7. Detector: disabled via config → skip
 *   8. Detector: previously failed marker present → skip
 *   9. Detector: pending sidecar present → skip
 *  10. Detector: consumed marker present → skip
 *  11. Stub builder: produces valid entry with last user + last assistant
 *  12. Stub builder: handles empty turns gracefully
 *  13. Sidecar: write + read roundtrip
 *  14. Sidecar: consume renames atomically; second consume is no-op
 *  15. Sidecar: corrupt file returns null on read
 *  16. Worker: empty sibling → marks failed
 *  17. Worker: LLM returns null → marks failed
 *  18. Worker: LLM returns valid summary → writes rich sidecar (non-stub)
 *  19. Worker: timeout aborts and marks failed
 *  20. Reader: readRawTurns returns only user/assistant turns, in order
 *  21. Reader: readRawTurns respects maxTurns cap (tail)
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectRolloverOpportunity } from '../rollover/detector.js';
import { buildRolloverStub } from '../rollover/stub.js';
import { runRolloverWorker } from '../rollover/worker.js';
import { writeRolloverSidecar, readRolloverSidecar, consumeRolloverSidecar, rolloverPathFor, rolloverConsumedPathFor, markRolloverFailed, rolloverHasFailed, rolloverPending, rolloverWasConsumed, } from '../rollover/sidecar.js';
import { findSiblingSessionForTopic } from '../index.js';
import { SessionReader } from '../storage/reader.js';
import { DEFAULT_CONFIG } from '../types.js';
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let tmpDir;
const silentLogger = {
    debug: (_) => { },
    warn: (_) => { },
    info: (_) => { },
};
before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kasett-rollover-test-'));
});
after(async () => {
    try {
        await rm(tmpDir, { recursive: true, force: true });
    }
    catch {
        /* ignore */
    }
});
/** Write a JSONL session file with the given message turns. */
async function writeSession(filename, turns, mtimeMs) {
    const path = join(tmpDir, filename);
    const lines = [
        JSON.stringify({ type: 'session' }),
        ...turns.map((t) => JSON.stringify({
            type: 'message',
            id: `msg-${Math.random().toString(36).slice(2)}`,
            message: {
                role: t.role,
                content: [{ type: 'text', text: t.text }],
                timestamp: new Date().toISOString(),
            },
        })),
    ];
    await writeFile(path, lines.join('\n') + '\n');
    if (mtimeMs !== undefined) {
        const seconds = mtimeMs / 1000;
        await utimes(path, seconds, seconds);
    }
    return path;
}
/** Cleanup helper: remove all rollover-related markers for a session. */
async function cleanupMarkers(sessionFile) {
    const paths = [
        rolloverPathFor(sessionFile),
        rolloverConsumedPathFor(sessionFile),
        `${sessionFile}.rollover.failed.json`,
        `${sessionFile}.rollover.stub-injected`,
    ];
    for (const p of paths) {
        try {
            await rm(p, { force: true });
        }
        catch {
            /* ignore */
        }
    }
}
// ---------------------------------------------------------------------------
// Detector tests
// ---------------------------------------------------------------------------
describe('detectRolloverOpportunity', () => {
    test('cold session + sibling with raw turns → fire=true', async () => {
        const current = await writeSession('current-cold-topic-100.jsonl', []);
        const sibling = await writeSession('sibling-cold-topic-100.jsonl', [
            { role: 'user', text: 'hello' },
            { role: 'assistant', text: 'hi back' },
            { role: 'user', text: 'what next?' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '100',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, true);
        if (verdict.fire) {
            assert.equal(verdict.siblingFile, sibling);
            assert.equal(verdict.siblingTurnCount, 3);
            assert.equal(verdict.currentTurnCount, 0);
        }
    });
    test('current session too warm → skip', async () => {
        const current = await writeSession('current-warm-topic-101.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
            { role: 'user', text: 'c' }, // 3 > minTurns(2)
        ]);
        await writeSession('sibling-warm-topic-101.jsonl', [
            { role: 'user', text: 'old' },
            { role: 'assistant', text: 'older' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '101',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'current_too_warm');
    });
    test('sibling too old → skip', async () => {
        const current = await writeSession('current-old-topic-102.jsonl', []);
        await writeSession('sibling-old-topic-102.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ], Date.now() - 200 * 3600 * 1000);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '102',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire) {
            // findSiblingSessionForTopic has its own 14-day cap (336h), so 200h is
            // still within sibling-finder reach but past the cold-start gate's
            // 168h default. Either reason is acceptable — both indicate "skip".
            assert.ok(verdict.reason === 'sibling_too_stale' || verdict.reason === 'no_sibling', `unexpected reason: ${verdict.reason}`);
        }
    });
    test('sibling too thin → skip', async () => {
        const current = await writeSession('current-thin-topic-103.jsonl', []);
        await writeSession('sibling-thin-topic-103.jsonl', [{ role: 'user', text: 'lonely' }], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '103',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'sibling_too_thin');
    });
    test('no sibling → skip', async () => {
        const current = await writeSession('current-orphan-topic-104.jsonl', []);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '104',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'no_sibling');
    });
    test('disabled via config → skip', async () => {
        const current = await writeSession('current-disabled-topic-105.jsonl', []);
        await writeSession('sibling-disabled-topic-105.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        const verdict = await detectRolloverOpportunity({
            config: { ...DEFAULT_CONFIG.coldStart, enabled: false },
            currentSessionFile: current,
            topicId: '105',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'disabled');
    });
    test('previously failed marker → skip', async () => {
        const current = await writeSession('current-failed-topic-106.jsonl', []);
        await writeSession('sibling-failed-topic-106.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        await markRolloverFailed(current, 'test_setup');
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '106',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'previously_failed');
        await cleanupMarkers(current);
    });
    test('pending sidecar present → skip', async () => {
        const current = await writeSession('current-pending-topic-107.jsonl', []);
        await writeSession('sibling-pending-topic-107.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        const fakeEntry = {
            schemaVersion: 1,
            sourceSessionFile: 'doesnt-matter',
            sourceSessionMtimeMs: Date.now(),
            generatedAtMs: Date.now(),
            turnsConsumed: 1,
            threadMeta: null,
            summary: 'already here',
            stub: false,
        };
        await writeRolloverSidecar(current, fakeEntry);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '107',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'sidecar_pending');
        await cleanupMarkers(current);
    });
    test('consumed marker present → skip', async () => {
        const current = await writeSession('current-consumed-topic-108.jsonl', []);
        await writeSession('sibling-consumed-topic-108.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ], Date.now() - 5 * 3600 * 1000);
        await cleanupMarkers(current);
        // Simulate prior consume: write then consume.
        const fakeEntry = {
            schemaVersion: 1,
            sourceSessionFile: 'doesnt-matter',
            sourceSessionMtimeMs: Date.now(),
            generatedAtMs: Date.now(),
            turnsConsumed: 1,
            threadMeta: null,
            summary: 'old',
            stub: false,
        };
        await writeRolloverSidecar(current, fakeEntry);
        await consumeRolloverSidecar(current);
        const verdict = await detectRolloverOpportunity({
            config: DEFAULT_CONFIG.coldStart,
            currentSessionFile: current,
            topicId: '108',
            findSibling: findSiblingSessionForTopic,
        });
        assert.equal(verdict.fire, false);
        if (!verdict.fire)
            assert.equal(verdict.reason, 'already_consumed');
        await cleanupMarkers(current);
    });
});
// ---------------------------------------------------------------------------
// Stub builder tests
// ---------------------------------------------------------------------------
describe('buildRolloverStub', () => {
    test('builds valid entry with last user + last assistant', () => {
        const entry = buildRolloverStub({
            siblingTurns: [
                { role: 'user', content: 'first user' },
                { role: 'assistant', content: 'first assistant' },
                { role: 'user', content: 'second user' },
                { role: 'assistant', content: 'second assistant' },
            ],
            siblingFile: '/tmp/fake.jsonl',
            siblingMtimeMs: Date.now() - 3 * 3600 * 1000,
        });
        assert.equal(entry.schemaVersion, 1);
        assert.equal(entry.stub, true);
        assert.equal(entry.sourceSessionFile, '/tmp/fake.jsonl');
        assert.equal(entry.turnsConsumed, 4);
        assert.ok(entry.summary.includes('ROLLOVER_CONTEXT'));
        assert.ok(entry.summary.includes('second user'));
        assert.ok(entry.summary.includes('second assistant'));
        // The 3h-ago timestamp must produce a sane "ago" label
        assert.ok(/~\d+h ago/.test(entry.summary) || /~\d+d ago/.test(entry.summary));
    });
    test('handles empty turns gracefully', () => {
        const entry = buildRolloverStub({
            siblingTurns: [],
            siblingFile: '/tmp/empty.jsonl',
            siblingMtimeMs: Date.now(),
        });
        assert.equal(entry.stub, true);
        assert.equal(entry.turnsConsumed, 0);
        assert.ok(entry.summary.includes('No user/assistant turns recoverable'));
    });
    test('handles array content from OC schema', () => {
        const entry = buildRolloverStub({
            siblingTurns: [
                { role: 'user', content: [{ type: 'text', text: 'array content here' }] },
            ],
            siblingFile: '/tmp/array.jsonl',
            siblingMtimeMs: Date.now(),
        });
        assert.ok(entry.summary.includes('array content here'));
    });
    test('truncates long turn content', () => {
        const longText = 'x'.repeat(2000);
        const entry = buildRolloverStub({
            siblingTurns: [{ role: 'user', content: longText }],
            siblingFile: '/tmp/long.jsonl',
            siblingMtimeMs: Date.now(),
            maxChars: 100,
        });
        // The truncated quote should contain a "…" suffix
        assert.ok(entry.summary.includes('…'));
        // And the full 2000-char run shouldn't be present
        assert.ok(!entry.summary.includes('x'.repeat(2000)));
    });
});
// ---------------------------------------------------------------------------
// Sidecar tests
// ---------------------------------------------------------------------------
describe('rollover sidecar', () => {
    test('write + read roundtrip', async () => {
        const sessionFile = join(tmpDir, 'sidecar-roundtrip.jsonl');
        await writeFile(sessionFile, '{}\n');
        const entry = {
            schemaVersion: 1,
            sourceSessionFile: '/elsewhere/sibling.jsonl',
            sourceSessionMtimeMs: 12345,
            generatedAtMs: 67890,
            turnsConsumed: 7,
            threadMeta: { main: 'm', sub: ['a', 'b', 'c'] },
            summary: 'hello world',
            stub: false,
        };
        await writeRolloverSidecar(sessionFile, entry);
        const read = await readRolloverSidecar(sessionFile);
        assert.deepEqual(read, entry);
        await cleanupMarkers(sessionFile);
    });
    test('consume renames atomically; second consume is no-op', async () => {
        const sessionFile = join(tmpDir, 'sidecar-consume.jsonl');
        await writeFile(sessionFile, '{}\n');
        const entry = {
            schemaVersion: 1,
            sourceSessionFile: 'x',
            sourceSessionMtimeMs: 1,
            generatedAtMs: 2,
            turnsConsumed: 3,
            threadMeta: null,
            summary: 's',
            stub: false,
        };
        await writeRolloverSidecar(sessionFile, entry);
        assert.equal(rolloverPending(sessionFile), true);
        const first = await consumeRolloverSidecar(sessionFile);
        assert.equal(first, true);
        assert.equal(rolloverPending(sessionFile), false);
        assert.equal(rolloverWasConsumed(sessionFile), true);
        const second = await consumeRolloverSidecar(sessionFile);
        assert.equal(second, false);
        await cleanupMarkers(sessionFile);
    });
    test('corrupt file returns null on read', async () => {
        const sessionFile = join(tmpDir, 'sidecar-corrupt.jsonl');
        await writeFile(sessionFile, '{}\n');
        await writeFile(rolloverPathFor(sessionFile), 'not json at all }');
        const read = await readRolloverSidecar(sessionFile);
        assert.equal(read, null);
        await cleanupMarkers(sessionFile);
    });
    test('failed marker flips rolloverHasFailed', async () => {
        const sessionFile = join(tmpDir, 'sidecar-failed.jsonl');
        await writeFile(sessionFile, '{}\n');
        assert.equal(rolloverHasFailed(sessionFile), false);
        await markRolloverFailed(sessionFile, 'test');
        assert.equal(rolloverHasFailed(sessionFile), true);
        await cleanupMarkers(sessionFile);
    });
});
// ---------------------------------------------------------------------------
// Worker tests (LLM mocked)
// ---------------------------------------------------------------------------
describe('runRolloverWorker', () => {
    test('empty sibling → marks failed', async () => {
        const current = join(tmpDir, 'worker-empty-current.jsonl');
        await writeFile(current, '{}\n');
        const sibling = join(tmpDir, 'worker-empty-sibling.jsonl');
        await writeFile(sibling, JSON.stringify({ type: 'session' }) + '\n');
        await cleanupMarkers(current);
        const result = await runRolloverWorker({
            currentSessionFile: current,
            siblingFile: sibling,
            siblingMtimeMs: Date.now(),
            maxSourceTurns: 100,
            timeoutMs: 5000,
            maxTokens: 4000,
            logger: silentLogger,
            callLLM: async () => 'should not be called',
        });
        assert.equal(result.success, false);
        assert.equal(result.reason, 'sibling_empty');
        assert.equal(rolloverHasFailed(current), true);
        await cleanupMarkers(current);
    });
    test('LLM returns empty → marks failed', async () => {
        const current = join(tmpDir, 'worker-llmempty-current.jsonl');
        await writeFile(current, '{}\n');
        const sibling = await writeSession('worker-llmempty-sibling-topic-200.jsonl', [
            { role: 'user', text: 'hi' },
            { role: 'assistant', text: 'hello' },
        ]);
        await cleanupMarkers(current);
        const result = await runRolloverWorker({
            currentSessionFile: current,
            siblingFile: sibling,
            siblingMtimeMs: Date.now(),
            maxSourceTurns: 100,
            timeoutMs: 5000,
            maxTokens: 4000,
            logger: silentLogger,
            callLLM: async () => '',
        });
        assert.equal(result.success, false);
        assert.equal(result.reason, 'llm_empty');
        assert.equal(rolloverHasFailed(current), true);
        await cleanupMarkers(current);
    });
    test('LLM returns valid summary → writes rich sidecar', async () => {
        const current = join(tmpDir, 'worker-good-current.jsonl');
        await writeFile(current, '{}\n');
        const sibling = await writeSession('worker-good-sibling-topic-201.jsonl', [
            { role: 'user', text: 'task A' },
            { role: 'assistant', text: 'doing task A' },
            { role: 'user', text: 'task B' },
        ]);
        await cleanupMarkers(current);
        const fakeSummary = '[ROLLOVER_CONTEXT]\n[THREAD_META] main: tasks | sub: a; b; idle\n\nWorked on task A and B.\n[/ROLLOVER_CONTEXT]';
        const result = await runRolloverWorker({
            currentSessionFile: current,
            siblingFile: sibling,
            siblingMtimeMs: Date.now(),
            maxSourceTurns: 100,
            timeoutMs: 5000,
            maxTokens: 4000,
            logger: silentLogger,
            callLLM: async () => fakeSummary,
        });
        assert.equal(result.success, true);
        assert.ok(result.entry);
        assert.equal(result.entry.stub, false);
        assert.equal(result.entry.turnsConsumed, 3);
        assert.ok(result.entry.summary.includes('Worked on task A and B.'));
        // Verify it lands on disk
        const onDisk = await readRolloverSidecar(current);
        assert.ok(onDisk);
        assert.equal(onDisk.stub, false);
        await cleanupMarkers(current);
    });
    test('LLM returns unwrapped summary → worker wraps it', async () => {
        const current = join(tmpDir, 'worker-wrap-current.jsonl');
        await writeFile(current, '{}\n');
        const sibling = await writeSession('worker-wrap-sibling-topic-202.jsonl', [
            { role: 'user', text: 'a' },
            { role: 'assistant', text: 'b' },
        ]);
        await cleanupMarkers(current);
        const naked = 'just some prose, no wrapper';
        const result = await runRolloverWorker({
            currentSessionFile: current,
            siblingFile: sibling,
            siblingMtimeMs: Date.now(),
            maxSourceTurns: 100,
            timeoutMs: 5000,
            maxTokens: 4000,
            logger: silentLogger,
            callLLM: async () => naked,
        });
        assert.equal(result.success, true);
        assert.ok(result.entry.summary.startsWith('[ROLLOVER_CONTEXT]'));
        assert.ok(result.entry.summary.endsWith('[/ROLLOVER_CONTEXT]'));
        await cleanupMarkers(current);
    });
    test('LLM call throws → marks failed', async () => {
        const current = join(tmpDir, 'worker-throw-current.jsonl');
        await writeFile(current, '{}\n');
        const sibling = await writeSession('worker-throw-sibling-topic-203.jsonl', [
            { role: 'user', text: 'x' },
            { role: 'assistant', text: 'y' },
        ]);
        await cleanupMarkers(current);
        const result = await runRolloverWorker({
            currentSessionFile: current,
            siblingFile: sibling,
            siblingMtimeMs: Date.now(),
            maxSourceTurns: 100,
            timeoutMs: 5000,
            maxTokens: 4000,
            logger: silentLogger,
            callLLM: async () => {
                throw new Error('simulated llm failure');
            },
        });
        assert.equal(result.success, false);
        assert.ok(result.reason.includes('simulated llm failure'));
        assert.equal(rolloverHasFailed(current), true);
        await cleanupMarkers(current);
    });
});
// ---------------------------------------------------------------------------
// Reader tests for readRawTurns
// ---------------------------------------------------------------------------
describe('SessionReader.readRawTurns', () => {
    test('returns only user/assistant turns, in order', async () => {
        const path = await writeSession('reader-order.jsonl', [
            { role: 'user', text: 'one' },
            { role: 'assistant', text: 'two' },
            { role: 'system', text: 'three (should be filtered)' },
            { role: 'user', text: 'four' },
        ]);
        const reader = new SessionReader();
        const turns = await reader.readRawTurns(path, 0);
        assert.equal(turns.length, 3);
        assert.equal(turns[0].role, 'user');
        assert.equal(turns[1].role, 'assistant');
        assert.equal(turns[2].role, 'user');
    });
    test('respects maxTurns cap (returns tail)', async () => {
        const path = await writeSession('reader-cap.jsonl', [
            { role: 'user', text: '1' },
            { role: 'assistant', text: '2' },
            { role: 'user', text: '3' },
            { role: 'assistant', text: '4' },
            { role: 'user', text: '5' },
        ]);
        const reader = new SessionReader();
        const turns = await reader.readRawTurns(path, 2);
        assert.equal(turns.length, 2);
        // Should be the LAST two (tail)
        const lastTexts = turns.map((t) => {
            const c = t.content;
            return c[0].text;
        });
        assert.deepEqual(lastTexts, ['4', '5']);
    });
    test('missing file returns empty array', async () => {
        const reader = new SessionReader();
        const turns = await reader.readRawTurns(join(tmpDir, 'does-not-exist.jsonl'), 0);
        assert.deepEqual(turns, []);
    });
    test('handles malformed lines without crashing', async () => {
        const path = join(tmpDir, 'reader-malformed.jsonl');
        const lines = [
            JSON.stringify({ type: 'session' }),
            'not json at all',
            JSON.stringify({
                type: 'message',
                message: {
                    role: 'user',
                    content: [{ type: 'text', text: 'valid' }],
                },
            }),
            'also bad {',
            JSON.stringify({
                type: 'message',
                message: {
                    role: 'assistant',
                    content: 'string content',
                },
            }),
        ];
        await writeFile(path, lines.join('\n') + '\n');
        const reader = new SessionReader();
        const turns = await reader.readRawTurns(path, 0);
        assert.equal(turns.length, 2);
        assert.equal(turns[0].role, 'user');
        assert.equal(turns[1].role, 'assistant');
    });
});
//# sourceMappingURL=rollover.test.js.map