import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendGlobalRecord, globalIndexExists, globalIndexPathFor, readGlobalRecords, GLOBAL_INDEX_FILENAME, } from '../global/index-writer.js';
let tmp;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kasett-global-'));
});
afterEach(() => {
    try {
        rmSync(tmp, { recursive: true, force: true });
    }
    catch {
        /* ignore */
    }
});
const makeRecord = (over = {}) => ({
    ts: new Date().toISOString(),
    agent_id: 'main',
    session_id: 'sess-A',
    thread_id: 'thread-1',
    label: 'first thread',
    status: 'active',
    schema_version: 'v3',
    ...over,
});
describe('globalIndexPathFor', () => {
    test('appends sessions/.kasett-global-threads.jsonl when given agent root', () => {
        const p = globalIndexPathFor('/some/agents/main');
        assert.equal(p, `/some/agents/main/sessions/${GLOBAL_INDEX_FILENAME}`);
    });
    test('does not double-append when given a sessions dir', () => {
        const p = globalIndexPathFor('/some/agents/main/sessions');
        assert.equal(p, `/some/agents/main/sessions/${GLOBAL_INDEX_FILENAME}`);
    });
});
describe('appendGlobalRecord', () => {
    test('creates parent dir + file on first write', () => {
        assert.equal(globalIndexExists(tmp), false);
        const r = makeRecord();
        const result = appendGlobalRecord(tmp, r);
        assert.equal(result.written, true);
        assert.ok(result.path);
        assert.equal(globalIndexExists(tmp), true);
    });
    test('round-trip — read back what we wrote', () => {
        const r1 = makeRecord({ thread_id: 'a', label: 'A' });
        const r2 = makeRecord({ thread_id: 'b', label: 'B' });
        appendGlobalRecord(tmp, r1);
        appendGlobalRecord(tmp, r2);
        const recs = readGlobalRecords(tmp);
        assert.equal(recs.length, 2);
        assert.equal(recs[0].thread_id, 'a');
        assert.equal(recs[1].thread_id, 'b');
    });
    test('rejects invalid records without writing', () => {
        const result = appendGlobalRecord(tmp, {
            ...makeRecord(),
            status: 'bogus',
        });
        assert.equal(result.written, false);
        assert.equal(result.error, 'invalid_record');
        assert.equal(globalIndexExists(tmp), false);
    });
    test('append-only — multiple appends preserve order across many writes', () => {
        const N = 25;
        for (let i = 0; i < N; i++) {
            appendGlobalRecord(tmp, makeRecord({ thread_id: `t-${i}`, label: `L${i}` }));
        }
        const recs = readGlobalRecords(tmp);
        assert.equal(recs.length, N);
        for (let i = 0; i < N; i++) {
            assert.equal(recs[i].thread_id, `t-${i}`);
        }
    });
    test('skips malformed lines gracefully', () => {
        const r = makeRecord();
        appendGlobalRecord(tmp, r);
        // Inject a corrupt line directly
        const path = globalIndexPathFor(tmp);
        appendFileSync(path, 'not-json-at-all\n');
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'after' }));
        const recs = readGlobalRecords(tmp);
        assert.equal(recs.length, 2);
        assert.equal(recs[0].thread_id, 'thread-1');
        assert.equal(recs[1].thread_id, 'after');
    });
    test('returns empty when file does not exist', () => {
        assert.deepEqual(readGlobalRecords(tmp), []);
    });
});
describe('readGlobalRecords filters', () => {
    test('thread_id filter', () => {
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'a' }));
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'b' }));
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'a' }));
        const recs = readGlobalRecords(tmp, { thread_id: 'a' });
        assert.equal(recs.length, 2);
        assert.ok(recs.every((r) => r.thread_id === 'a'));
    });
    test('canonical_id filter — falls back to thread_id when canonical missing', () => {
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'orig', canonical_id: 'canon' }));
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'orig' }));
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'other' }));
        const recs = readGlobalRecords(tmp, { canonical_id: 'canon' });
        assert.equal(recs.length, 1);
        const recs2 = readGlobalRecords(tmp, { canonical_id: 'orig' });
        assert.equal(recs2.length, 1);
        assert.equal(recs2[0].thread_id, 'orig');
    });
    test('session_id and agent_id filters', () => {
        appendGlobalRecord(tmp, makeRecord({ session_id: 'A', agent_id: 'main' }));
        appendGlobalRecord(tmp, makeRecord({ session_id: 'B', agent_id: 'main' }));
        appendGlobalRecord(tmp, makeRecord({ session_id: 'A', agent_id: 'alpha' }));
        const a = readGlobalRecords(tmp, { session_id: 'A' });
        assert.equal(a.length, 2);
        const alpha = readGlobalRecords(tmp, { agent_id: 'alpha' });
        assert.equal(alpha.length, 1);
    });
    test('sinceMs filter', () => {
        const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
        const newTs = new Date().toISOString();
        appendGlobalRecord(tmp, makeRecord({ ts: oldTs, thread_id: 'old' }));
        appendGlobalRecord(tmp, makeRecord({ ts: newTs, thread_id: 'new' }));
        const recent = readGlobalRecords(tmp, { sinceMs: 1000 * 60 * 60 });
        assert.equal(recent.length, 1);
        assert.equal(recent[0].thread_id, 'new');
    });
});
describe('appendGlobalRecord — file content', () => {
    test('each record on its own line, valid JSON', () => {
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'a' }));
        appendGlobalRecord(tmp, makeRecord({ thread_id: 'b' }));
        const path = globalIndexPathFor(tmp);
        const raw = readFileSync(path, 'utf-8');
        const lines = raw.split('\n').filter((l) => l.trim());
        assert.equal(lines.length, 2);
        for (const l of lines) {
            const parsed = JSON.parse(l);
            assert.ok(parsed.thread_id);
        }
    });
});
//# sourceMappingURL=global-index-writer.test.js.map