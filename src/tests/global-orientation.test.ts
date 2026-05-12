import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendGlobalRecord } from '../global/index-writer.js';
import {
  getCrossSessionContext,
  getCrossSessionContextFromRecords,
} from '../global/orientation.js';
import { refreshSnapshot } from '../global/snapshot.js';
import type { GlobalThreadRecord } from '../global/types.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'kasett-orient-'));
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const rec = (over: Partial<GlobalThreadRecord>): GlobalThreadRecord => ({
  ts: new Date().toISOString(),
  agent_id: 'main',
  session_id: 'sess-X',
  thread_id: 'thread-x',
  label: 'thread x',
  status: 'active',
  schema_version: 'v3',
  ...over,
});

describe('getCrossSessionContext', () => {
  test('returns threads only from OTHER sessions', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-CURRENT',
        thread_id: 'in-current',
        canonical_id: 'in-current',
        label: 'in current session',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 'in-other',
        canonical_id: 'in-other',
        label: 'in other session',
      }),
    );

    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT');
    assert.equal(ctx.active_other_sessions.length, 1);
    assert.equal(ctx.active_other_sessions[0].canonical_id, 'in-other');
  });

  test('respects topThreads cap', () => {
    for (let i = 0; i < 10; i++) {
      appendGlobalRecord(
        tmp,
        rec({
          ts: new Date(Date.now() - i * 60000).toISOString(),
          session_id: `sess-${i}`,
          thread_id: `t-${i}`,
          canonical_id: `t-${i}`,
        }),
      );
    }
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT', { topThreads: 3 });
    assert.equal(ctx.active_other_sessions.length, 3);
  });

  test('default filters out completed/fading', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 'done-thread',
        canonical_id: 'done-thread',
        status: 'completed',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 'live-thread',
        canonical_id: 'live-thread',
        status: 'active',
      }),
    );
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT');
    assert.equal(ctx.active_other_sessions.length, 1);
    assert.equal(ctx.active_other_sessions[0].canonical_id, 'live-thread');
  });

  test('honors custom statuses option', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 'done',
        canonical_id: 'done',
        status: 'completed',
      }),
    );
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT', {
      statuses: ['completed'],
    });
    assert.equal(ctx.active_other_sessions.length, 1);
  });

  test('respects sinceMs lookback', () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
    const recent = new Date().toISOString();
    appendGlobalRecord(
      tmp,
      rec({
        ts: old,
        session_id: 'sess-OTHER',
        thread_id: 'old',
        canonical_id: 'old',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: recent,
        session_id: 'sess-OTHER',
        thread_id: 'new',
        canonical_id: 'new',
      }),
    );
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT', {
      sinceMs: 1000 * 60 * 60,
    });
    assert.equal(ctx.active_other_sessions.length, 1);
    assert.equal(ctx.active_other_sessions[0].canonical_id, 'new');
  });

  test('sorts by recency descending', () => {
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-10T00:00:00Z',
        session_id: 's-A',
        thread_id: 'older',
        canonical_id: 'older',
      }),
    );
    appendGlobalRecord(
      tmp,
      rec({
        ts: '2026-05-12T00:00:00Z',
        session_id: 's-B',
        thread_id: 'newer',
        canonical_id: 'newer',
      }),
    );
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'sess-CURRENT', {
      sinceMs: 1000 * 60 * 60 * 24 * 365 * 5,
    });
    assert.equal(ctx.active_other_sessions[0].canonical_id, 'newer');
  });

  test('topic_name surfaces when present', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-X',
        topic_name: 'topic-20751',
        thread_id: 't',
        canonical_id: 't',
      }),
    );
    refreshSnapshot(tmp);
    const ctx = getCrossSessionContext(tmp, 'CURRENT');
    assert.equal(ctx.active_other_sessions[0].last_topic_name, 'topic-20751');
  });

  test('empty index returns empty list', () => {
    const ctx = getCrossSessionContext(tmp, 'CURRENT');
    assert.equal(ctx.active_other_sessions.length, 0);
  });

  test('forceRebuild bypasses cached snapshot', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 't',
        canonical_id: 't',
      }),
    );
    // No snapshot written yet → forceRebuild builds fresh from records.
    const ctx = getCrossSessionContext(tmp, 'CURRENT', { forceRebuild: true });
    assert.equal(ctx.active_other_sessions.length, 1);
  });

  test('accepts pre-built snapshot', () => {
    const snapshot = {
      ts: '2026-05-12T12:00:00Z',
      threads: {
        x: {
          canonical_id: 'x',
          label: 'x label',
          status: 'active' as const,
          sessions: [
            {
              session_id: 'sess-OTHER',
              first_seen: '2026-05-12T11:00:00Z',
              last_seen: '2026-05-12T11:00:00Z',
              label_used: 'x label',
              compaction_count: 1,
            },
          ],
          aliases: ['x'],
          total_observations: 1,
          last_compaction: '2026-05-12T11:00:00Z',
        },
      },
    };
    const ctx = getCrossSessionContext(tmp, 'CURRENT', {
      snapshot,
      sinceMs: 1000 * 60 * 60 * 24 * 365 * 5,
    });
    assert.equal(ctx.active_other_sessions.length, 1);
    assert.equal(ctx.active_other_sessions[0].canonical_id, 'x');
  });
});

describe('getCrossSessionContextFromRecords', () => {
  test('builds snapshot fresh from index records, no snapshot file', () => {
    appendGlobalRecord(
      tmp,
      rec({
        session_id: 'sess-OTHER',
        thread_id: 't',
        canonical_id: 't',
      }),
    );
    const ctx = getCrossSessionContextFromRecords(tmp, 'CURRENT');
    assert.equal(ctx.active_other_sessions.length, 1);
  });
});
