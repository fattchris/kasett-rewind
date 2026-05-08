import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ThreadTracker } from '../compaction/threads.js';
function makeSnapshot(overrides = {}) {
    return {
        mainThread: 'Building the auth system',
        subThreads: [],
        keyState: {},
        unresolved: [],
        threadHistory: [],
        ...overrides,
    };
}
function makeSummary(snapshot, overrides = {}) {
    return {
        summary: 'test',
        windowIndex: 0,
        windowTotal: 2,
        threadSnapshot: snapshot,
        timestamp: '2026-05-05T08:00:00Z',
        tokenCount: 100,
        ...overrides,
    };
}
describe('ThreadTracker', () => {
    describe('parse', () => {
        test('parses full structured output', () => {
            const input = `## Main Thread
Building OAuth2 authentication for MoltAI

## Active Sub-threads (max 3)
1. Provider config — Setting up Google federation
2. Database migration — Upgrading to PG15

## Thread History
- CI Pipeline: completed — Fixed the failing tests
- Monitoring: backgrounded — Deferred until after launch

## Key State
- targetVersion: PostgreSQL 15.2
- oauthProvider: Google
- endpoint: https://auth.moltai.com/callback

## Unresolved
- Need to register redirect URLs
- Rate limiting not configured`;
            const result = ThreadTracker.parse(input);
            assert.equal(result.mainThread, 'Building OAuth2 authentication for MoltAI');
            assert.equal(result.subThreads.length, 2);
            assert.equal(result.subThreads[0].name, 'Provider config');
            assert.equal(result.subThreads[0].status, 'active');
            assert.equal(result.subThreads[0].detail, 'Setting up Google federation');
            assert.equal(result.subThreads[1].name, 'Database migration');
            assert.equal(result.threadHistory.length, 2);
            assert.equal(result.threadHistory[0].thread, 'CI Pipeline');
            assert.equal(result.threadHistory[0].status, 'completed');
            assert.equal(result.threadHistory[1].thread, 'Monitoring');
            assert.equal(result.threadHistory[1].status, 'backgrounded');
            assert.equal(result.keyState['targetVersion'], 'PostgreSQL 15.2');
            assert.equal(result.keyState['oauthProvider'], 'Google');
            assert.equal(result.keyState['endpoint'], 'https://auth.moltai.com/callback');
            assert.equal(result.unresolved.length, 2);
            assert.equal(result.unresolved[0], 'Need to register redirect URLs');
        });
        test('parses output with minimal sections', () => {
            const input = `## Main Thread
Simple task

## Key State
- file: /tmp/test.ts`;
            const result = ThreadTracker.parse(input);
            assert.equal(result.mainThread, 'Simple task');
            assert.equal(result.subThreads.length, 0);
            assert.equal(result.threadHistory.length, 0);
            assert.equal(result.keyState['file'], '/tmp/test.ts');
            assert.equal(result.unresolved.length, 0);
        });
        test('returns Unknown for empty input', () => {
            const result = ThreadTracker.parse('');
            assert.equal(result.mainThread, 'Unknown');
        });
        test('handles ### heading format', () => {
            const input = `### Main Thread
Testing triple-hash headings

### Active Sub-threads (max 3)
1. Sub A — detail A

### Key State
- key1: value1`;
            const result = ThreadTracker.parse(input);
            assert.equal(result.mainThread, 'Testing triple-hash headings');
            assert.equal(result.subThreads.length, 1);
            assert.equal(result.subThreads[0].name, 'Sub A');
        });
        test('limits sub-threads to max 3', () => {
            const input = `## Main Thread
Test

## Active Sub-threads (max 3)
1. Thread A — detail
2. Thread B — detail
3. Thread C — detail
4. Thread D — detail (should be ignored)`;
            const result = ThreadTracker.parse(input);
            assert.equal(result.subThreads.length, 3);
        });
        test('parses key state with colons in values', () => {
            const input = `## Main Thread
Test

## Key State
- url: https://example.com:8080/path
- config: key=value:extra`;
            const result = ThreadTracker.parse(input);
            assert.equal(result.keyState['url'], 'https://example.com:8080/path');
            assert.equal(result.keyState['config'], 'key=value:extra');
        });
    });
    describe('validate', () => {
        test('returns no violations on first compaction (no previous)', () => {
            const current = makeSnapshot({
                mainThread: 'New task',
                subThreads: [{ name: 'Sub A', status: 'active' }],
            });
            const violations = ThreadTracker.validate(current, undefined);
            assert.deepEqual(violations, []);
        });
        test('returns no violations when all threads are present', () => {
            const previous = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [
                    { name: 'OAuth setup', status: 'active', detail: 'Google' },
                    { name: 'Database', status: 'active', detail: 'PG15' },
                ],
            });
            const current = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [{ name: 'OAuth setup', status: 'active', detail: 'Testing' }],
                threadHistory: [
                    { thread: 'Database', status: 'completed', lastSeen: '2026-05-05T08:00:00Z' },
                ],
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.deepEqual(violations, []);
        });
        test('detects silently dropped thread', () => {
            const previous = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [
                    { name: 'OAuth setup', status: 'active' },
                    { name: 'Database migration', status: 'active' },
                ],
            });
            const current = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [{ name: 'OAuth setup', status: 'active' }],
                // Database migration is completely missing!
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.equal(violations.length, 1);
            assert.ok(violations[0].includes('Database migration'));
        });
        test('does not flag completed threads from previous', () => {
            const previous = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [
                    { name: 'OAuth setup', status: 'completed' },
                    { name: 'Active work', status: 'active' },
                ],
            });
            const current = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [{ name: 'Active work', status: 'active' }],
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.deepEqual(violations, []);
        });
        test('does not flag backgrounded threads from previous', () => {
            const previous = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [
                    { name: 'Monitoring', status: 'backgrounded' },
                    { name: 'Active work', status: 'active' },
                ],
            });
            const current = makeSnapshot({
                mainThread: 'Building auth',
                subThreads: [{ name: 'Active work', status: 'active' }],
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.deepEqual(violations, []);
        });
        test('uses fuzzy matching for thread names', () => {
            const previous = makeSnapshot({
                mainThread: 'Building the authentication system',
                subThreads: [{ name: 'OAuth2 provider configuration', status: 'active' }],
            });
            const current = makeSnapshot({
                mainThread: 'Building the auth system',
                subThreads: [{ name: 'OAuth2 provider config', status: 'active' }],
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.deepEqual(violations, []);
        });
        test('detects missing main thread', () => {
            const previous = makeSnapshot({
                mainThread: 'Building authentication for platform XYZ',
            });
            const current = makeSnapshot({
                mainThread: 'Completely different unrelated topic here now',
            });
            const violations = ThreadTracker.validate(current, previous);
            assert.equal(violations.length, 1);
            assert.ok(violations[0].includes('main thread'));
        });
    });
    describe('mergeHistory', () => {
        test('adds completed threads from previous to history', () => {
            const previous = makeSummary(makeSnapshot({
                mainThread: 'Auth',
                subThreads: [
                    { name: 'OAuth', status: 'active' },
                    { name: 'Database', status: 'active' },
                ],
            }));
            const current = makeSnapshot({
                mainThread: 'Auth',
                subThreads: [{ name: 'OAuth', status: 'active' }],
                threadHistory: [],
            });
            const merged = ThreadTracker.mergeHistory(current, previous);
            assert.equal(merged.threadHistory.length, 1);
            assert.equal(merged.threadHistory[0].thread, 'Database');
            assert.equal(merged.threadHistory[0].status, 'backgrounded');
        });
        test('carries forward existing history from previous', () => {
            const previous = makeSummary(makeSnapshot({
                mainThread: 'Auth',
                subThreads: [],
                threadHistory: [
                    { thread: 'Old task', status: 'completed', lastSeen: '2026-05-04T00:00:00Z' },
                ],
            }));
            const current = makeSnapshot({
                mainThread: 'Auth',
                threadHistory: [],
            });
            const merged = ThreadTracker.mergeHistory(current, previous);
            assert.equal(merged.threadHistory.length, 1);
            assert.equal(merged.threadHistory[0].thread, 'Old task');
        });
        test('does not duplicate existing history entries', () => {
            const previous = makeSummary(makeSnapshot({
                mainThread: 'Auth',
                subThreads: [],
                threadHistory: [
                    { thread: 'CI Fix', status: 'completed', lastSeen: '2026-05-04T00:00:00Z' },
                ],
            }));
            const current = makeSnapshot({
                mainThread: 'Auth',
                threadHistory: [
                    { thread: 'CI Fix', status: 'completed', lastSeen: '2026-05-04T00:00:00Z' },
                ],
            });
            const merged = ThreadTracker.mergeHistory(current, previous);
            assert.equal(merged.threadHistory.length, 1);
        });
        test('caps history at 10 entries', () => {
            const historyEntries = Array.from({ length: 12 }, (_, i) => ({
                thread: `Thread ${i}`,
                status: 'completed',
                lastSeen: '2026-05-04T00:00:00Z',
            }));
            const previous = makeSummary(makeSnapshot({
                mainThread: 'Auth',
                subThreads: [],
                threadHistory: historyEntries.slice(0, 8),
            }));
            const current = makeSnapshot({
                mainThread: 'Auth',
                threadHistory: historyEntries.slice(8, 12),
            });
            const merged = ThreadTracker.mergeHistory(current, previous);
            assert.ok(merged.threadHistory.length <= 10);
        });
        test('returns current unchanged when no previous', () => {
            const current = makeSnapshot({
                mainThread: 'Fresh start',
                threadHistory: [
                    { thread: 'First', status: 'active', lastSeen: '2026-05-05T00:00:00Z' },
                ],
            });
            const merged = ThreadTracker.mergeHistory(current, undefined);
            assert.equal(merged.threadHistory.length, 1);
            assert.equal(merged.threadHistory[0].thread, 'First');
        });
    });
});
//# sourceMappingURL=threads.test.js.map