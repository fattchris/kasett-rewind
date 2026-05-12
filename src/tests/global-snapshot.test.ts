import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendGlobalRecord,
  globalIndexPathFor,
} from '../global/index-writer.js';
import {
  buildSnapshot,
  globalSnapshotPathFor,
  readSnapshot,
  refreshSnapshot,
  writeSnapshot,
} from '../global/snapshot.js';
import type { GlobalThreadRecord, GlobalThreadSnapshot } from '../global/types.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'kasett-snap-'));
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const rec = (over: Partial<GlobalThreadRecord>): GlobalThreadRecord => ({
  ts: '2026-05-12T12:00:00Z',
  agent_id: 'main',
  session_id: 'sess-A',
  thread_id: 'thread-1',
  label: 'thread one',
  status: 'active',
  schema_version: 'v3',
  ...over,
});

describe('buildSnapshot', () => {
  test('groups records by canonical_id', () => {
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-10T10:00:00Z',
        session_id: 'sA',
        thread_id: 'kasett',
        canonical_id: 'kasett',
        label: 'kasett impl',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-11T10:00:00Z',
        session_id: 'sB',
        thread_id: 'kasett',
        canonical_id: 'kasett',
        label: 'kasett work continued',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T10:00:00Z',
        session_id: 'sA',
        thread_id: 'other',
        canonical_id: 'other',
        label: 'other thing',
      }),
    );

    const snap = buildSnapshot(tmp);
    assert.equal(Object.keys(snap.threads).length, 2);
    const k = snap.threads['kasett'];
    assert.ok(k);
    assert.equal(k.label, 'kasett work continued'); // most recent wins
    assert.equal(k.total_observations, 2);
    assert.equal(k.sessions.length, 2);
    assert.deepEqual(
      k.sessions.map((s) => s.session_id).sort(),
      ['sA', 'sB'],
    );
  });

  test('per-session compaction_count', () => {
    for (let i = 0; i < 3; i++) {
      appendGlobalRecord(
        tmp,
        rec({
          ts: new Date(2026, 4, 12, i).toISOString(),
          thread_id: 'k',
          canonical_id: 'k',
          session_id: 'sA',
        }),
      );
    }
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-13T00:00:00Z',
        thread_id: 'k',
        canonical_id: 'k',
        session_id: 'sB',
      }),
    );
    const snap = buildSnapshot(tmp);
    const k = snap.threads['k'];
    const sA = k.sessions.find((s) => s.session_id === 'sA');
    assert.equal(sA?.compaction_count, 3);
    const sB = k.sessions.find((s) => s.session_id === 'sB');
    assert.equal(sB?.compaction_count, 1);
  });

  test('aliases capture all observed thread_ids that resolve to canonical', () => {
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T10:00:00Z',
        thread_id: 'a-id',
        canonical_id: 'a-id',
        label: 'alpha thread investigation work',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T11:00:00Z',
        thread_id: 'a-renamed',
        canonical_id: 'a-id',
        label: 'alpha thread investigation work',
      }),
    );
    const snap = buildSnapshot(tmp);
    const a = snap.threads['a-id'];
    assert.deepEqual(a.aliases.sort(), ['a-id', 'a-renamed']);
  });

  test('most-recent-wins for status', () => {
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-10T10:00:00Z',
        thread_id: 'k',
        canonical_id: 'k',
        status: 'active',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T10:00:00Z',
        thread_id: 'k',
        canonical_id: 'k',
        status: 'completed',
      }),
    );
    const snap = buildSnapshot(tmp);
    assert.equal(snap.threads['k'].status, 'completed');
  });

  test('resolves canonical at projection time when records lack one', () => {
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-10T00:00:00Z',
        thread_id: 'thread-A',
        // no canonical_id — older migrated row
        label: 'kasett indexing snapshot work',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T00:00:00Z',
        thread_id: 'thread-A',
        // also no canonical
        label: 'kasett indexing snapshot work',
      }),
    );
    const snap = buildSnapshot(tmp);
    // Same thread_id should collapse to one entry.
    assert.equal(Object.keys(snap.threads).length, 1);
    const k = Object.values(snap.threads)[0];
    assert.equal(k.total_observations, 2);
  });

  test('respects sinceMs option', () => {
    const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
    const newTs = new Date().toISOString();
    appendGlobalRecord(
      tmp,
      rec({ ts: oldTs, thread_id: 'old-thread', canonical_id: 'old-thread' }),
    );
    appendGlobalRecord(
      tmp,
      rec({ ts: newTs, thread_id: 'new-thread', canonical_id: 'new-thread' }),
    );
    const snap = buildSnapshot(tmp, { sinceMs: 1000 * 60 * 60 });
    assert.equal(Object.keys(snap.threads).length, 1);
    assert.ok(snap.threads['new-thread']);
  });

  test('idempotent — building twice yields equivalent snapshots', () => {
    appendGlobalRecord(tmp, rec({ thread_id: 'a', canonical_id: 'a' }));
    appendGlobalRecord(tmp, rec({ thread_id: 'b', canonical_id: 'b' }));
    const snap1 = buildSnapshot(tmp);
    const snap2 = buildSnapshot(tmp);
    // ts will differ; threads structure should match
    assert.deepEqual(
      Object.keys(snap1.threads).sort(),
      Object.keys(snap2.threads).sort(),
    );
    for (const id of Object.keys(snap1.threads)) {
      assert.deepEqual(
        snap1.threads[id].sessions.map((s) => s.session_id),
        snap2.threads[id].sessions.map((s) => s.session_id),
      );
    }
  });

  test('uses pre-loaded records when provided (no fs read)', () => {
    const records: GlobalThreadRecord[] = [
      rec({ thread_id: 'in-memory', canonical_id: 'in-memory' }),
    ];
    const snap = buildSnapshot('/non/existent/path', { records });
    assert.equal(Object.keys(snap.threads).length, 1);
  });
});

describe('writeSnapshot / readSnapshot', () => {
  test('round-trip', () => {
    const snap: GlobalThreadSnapshot = {
      ts: '2026-05-12T12:00:00Z',
      threads: {
        k: {
          canonical_id: 'k',
          label: 'l',
          status: 'active',
          sessions: [],
          aliases: ['k'],
          total_observations: 1,
          last_compaction: '2026-05-12T12:00:00Z',
        },
      },
    };
    writeSnapshot(tmp, snap);
    const read = readSnapshot(tmp);
    assert.ok(read);
    assert.equal(Object.keys(read!.threads).length, 1);
    assert.equal(read!.threads['k'].label, 'l');
  });

  test('atomic — temp file is gone after write', () => {
    const snap: GlobalThreadSnapshot = {
      ts: '2026-05-12T12:00:00Z',
      threads: {},
    };
    writeSnapshot(tmp, snap);
    const path = globalSnapshotPathFor(tmp);
    assert.ok(existsSync(path));
    assert.equal(existsSync(path + '.tmp'), false);
  });

  test('readSnapshot returns null when file is absent', () => {
    assert.equal(readSnapshot(tmp), null);
  });

  test('readSnapshot returns null on malformed JSON', () => {
    const snap: GlobalThreadSnapshot = {
      ts: '2026-05-12T12:00:00Z',
      threads: {},
    };
    writeSnapshot(tmp, snap);
    // Corrupt
    const path = globalSnapshotPathFor(tmp);
    writeFileSync(path, 'not json');
    assert.equal(readSnapshot(tmp), null);
  });
});

describe('refreshSnapshot', () => {
  test('builds and writes in one call', () => {
    appendGlobalRecord(tmp, rec({ thread_id: 'k', canonical_id: 'k' }));
    refreshSnapshot(tmp);
    const read = readSnapshot(tmp);
    assert.ok(read);
    assert.equal(Object.keys(read!.threads).length, 1);
  });

  test('overwrites stale snapshot atomically', () => {
    appendGlobalRecord(tmp, rec({ thread_id: 'k', canonical_id: 'k' }));
    refreshSnapshot(tmp);
    const before = readFileSync(globalSnapshotPathFor(tmp), 'utf-8');

    appendGlobalRecord(tmp, rec({ thread_id: 'k2', canonical_id: 'k2' }));
    refreshSnapshot(tmp);
    const after = readFileSync(globalSnapshotPathFor(tmp), 'utf-8');

    assert.notEqual(before, after);
    const snap = JSON.parse(after);
    assert.equal(Object.keys(snap.threads).length, 2);
  });

  test('empty index → empty snapshot, no crash', () => {
    refreshSnapshot(tmp);
    const read = readSnapshot(tmp);
    assert.ok(read);
    assert.equal(Object.keys(read!.threads).length, 0);
  });
});

describe('globalSnapshotPathFor', () => {
  test('lives next to the index file', () => {
    const idx = globalIndexPathFor(tmp);
    const snap = globalSnapshotPathFor(tmp);
    assert.equal(snap.replace(/[^/]+$/, ''), idx.replace(/[^/]+$/, ''));
  });
});
