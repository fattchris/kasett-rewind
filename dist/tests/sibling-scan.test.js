/**
 * Tests for findSiblingSessionForTopic (Mod 3 — PAL-required unit tests).
 *
 * Covers:
 * - Two siblings with different mtimes → newer one selected
 * - One sibling older than 14 days → filtered out
 * - No siblings present → returns null
 * - Sibling exists but current file is excluded from results
 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { findSiblingSessionForTopic } from '../index.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let tmpDir;
before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kasett-sibling-scan-test-'));
});
/** Write an empty JSONL file and set its mtime to `mtime` (ms since epoch). */
async function makeSession(filename, mtimeMs) {
    const fullPath = join(tmpDir, filename);
    await writeFile(fullPath, '', 'utf-8');
    const mtimeSecs = mtimeMs / 1000;
    await utimes(fullPath, mtimeSecs, mtimeSecs);
    return fullPath;
}
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('findSiblingSessionForTopic: newer sibling selected', () => {
    test('returns the more-recently-modified sibling when two candidates exist', async () => {
        const topicId = '9001';
        const current = `sess-current-topic-${topicId}.jsonl`;
        const older = `sess-older-topic-${topicId}.jsonl`;
        const newer = `sess-newer-topic-${topicId}.jsonl`;
        await makeSession(current, NOW - 5 * DAY_MS);
        await makeSession(older, NOW - 3 * DAY_MS);
        await makeSession(newer, NOW - 1 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.ok(result !== null, 'should find a sibling');
        assert.equal(basename(result), newer, 'should pick the newer sibling');
    });
});
describe('findSiblingSessionForTopic: 14-day mtime cap', () => {
    test('filters out siblings older than 14 days and returns null when no recent siblings remain', async () => {
        const topicId = '9002';
        const current = `sess-current2-topic-${topicId}.jsonl`;
        const stale = `sess-stale-topic-${topicId}.jsonl`;
        await makeSession(current, NOW - 1 * DAY_MS);
        // Set mtime to 15 days ago — beyond the 14-day cap
        await makeSession(stale, NOW - 15 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.equal(result, null, 'stale sibling (15 days) should be filtered out');
    });
    test('returns a sibling that is exactly 13 days old (within cap)', async () => {
        const topicId = '9003';
        const current = `sess-current3-topic-${topicId}.jsonl`;
        const fresh = `sess-fresh-topic-${topicId}.jsonl`;
        await makeSession(current, NOW - 1 * DAY_MS);
        await makeSession(fresh, NOW - 13 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.ok(result !== null, 'sibling within 14-day cap should be found');
        assert.equal(basename(result), fresh);
    });
});
describe('findSiblingSessionForTopic: no siblings', () => {
    test('returns null when no sibling files exist for the topic', async () => {
        const topicId = '9004';
        const current = `sess-only-topic-${topicId}.jsonl`;
        await makeSession(current, NOW - 1 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.equal(result, null, 'should return null when current is the only file');
    });
    test('returns null when sessionsDir is empty', async () => {
        // Use a fresh sub-directory with no files
        const emptyDir = await mkdtemp(join(tmpdir(), 'kasett-sibling-empty-'));
        const result = await findSiblingSessionForTopic(emptyDir, 'any-topic-9005.jsonl', '9005');
        assert.equal(result, null);
    });
});
describe('findSiblingSessionForTopic: current file excluded', () => {
    test('does not return the current file as its own sibling', async () => {
        const topicId = '9006';
        const current = `sess-self-topic-${topicId}.jsonl`;
        // Only the current file exists — it must not count as a sibling of itself
        await makeSession(current, NOW - 1 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.equal(result, null, 'current file must be excluded from sibling results');
    });
});
describe('findSiblingSessionForTopic: sidecar and checkpoint files excluded', () => {
    test('ignores .kasett-meta.jsonl sidecar files', async () => {
        const topicId = '9007';
        const current = `sess-meta-topic-${topicId}.jsonl`;
        const sidecar = `sess-other-topic-${topicId}.kasett-meta.jsonl`;
        await makeSession(current, NOW - 2 * DAY_MS);
        await makeSession(sidecar, NOW - 1 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.equal(result, null, 'sidecar files must not be returned as siblings');
    });
    test('ignores .checkpoint.jsonl files', async () => {
        const topicId = '9008';
        const current = `sess-ckpt-topic-${topicId}.jsonl`;
        const checkpoint = `sess-other-topic-${topicId}.checkpoint.jsonl`;
        await makeSession(current, NOW - 2 * DAY_MS);
        await makeSession(checkpoint, NOW - 1 * DAY_MS);
        const result = await findSiblingSessionForTopic(tmpDir, current, topicId);
        assert.equal(result, null, 'checkpoint files must not be returned as siblings');
    });
});
//# sourceMappingURL=sibling-scan.test.js.map