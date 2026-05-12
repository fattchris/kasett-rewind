import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidGlobalThreadRecord,
  isValidGlobalThreadSnapshot,
  type GlobalThreadRecord,
  type GlobalThreadSnapshot,
} from '../global/types.js';

const baseRecord: GlobalThreadRecord = {
  ts: '2026-05-12T16:00:00Z',
  agent_id: 'main',
  session_id: 'sess-abc',
  thread_id: 'kasett-impl',
  label: 'Kasett Phase E impl',
  status: 'active',
  schema_version: 'v3',
};

describe('isValidGlobalThreadRecord', () => {
  test('accepts a minimal valid record', () => {
    assert.equal(isValidGlobalThreadRecord(baseRecord), true);
  });

  test('accepts optional fields when correctly typed', () => {
    const r: GlobalThreadRecord = {
      ...baseRecord,
      topic_name: 'topic-20751',
      canonical_id: 'kasett-impl',
      is_main: false,
      ts_first_seen: '2026-05-10T12:00:00Z',
    };
    assert.equal(isValidGlobalThreadRecord(r), true);
  });

  test('rejects missing required fields', () => {
    assert.equal(isValidGlobalThreadRecord({}), false);
    assert.equal(
      isValidGlobalThreadRecord({ ...baseRecord, ts: '' }),
      false,
    );
    assert.equal(
      isValidGlobalThreadRecord({ ...baseRecord, agent_id: '' }),
      false,
    );
    assert.equal(
      isValidGlobalThreadRecord({ ...baseRecord, thread_id: '' }),
      false,
    );
  });

  test('rejects bad status', () => {
    assert.equal(
      isValidGlobalThreadRecord({ ...baseRecord, status: 'pending' as never }),
      false,
    );
  });

  test('rejects bad schema_version', () => {
    assert.equal(
      isValidGlobalThreadRecord({
        ...baseRecord,
        schema_version: 'v4' as never,
      }),
      false,
    );
  });

  test('rejects wrong types on optional fields', () => {
    assert.equal(
      isValidGlobalThreadRecord({
        ...baseRecord,
        topic_name: 42 as unknown as string,
      }),
      false,
    );
    assert.equal(
      isValidGlobalThreadRecord({
        ...baseRecord,
        is_main: 'yes' as unknown as boolean,
      }),
      false,
    );
  });

  test('rejects null/undefined/non-objects', () => {
    assert.equal(isValidGlobalThreadRecord(null), false);
    assert.equal(isValidGlobalThreadRecord(undefined), false);
    assert.equal(isValidGlobalThreadRecord('not an object'), false);
    assert.equal(isValidGlobalThreadRecord(42), false);
  });
});

describe('isValidGlobalThreadSnapshot', () => {
  test('accepts a minimal valid snapshot', () => {
    const s: GlobalThreadSnapshot = {
      ts: '2026-05-12T16:00:00Z',
      threads: {},
    };
    assert.equal(isValidGlobalThreadSnapshot(s), true);
  });

  test('accepts a populated snapshot', () => {
    const s: GlobalThreadSnapshot = {
      ts: '2026-05-12T16:00:00Z',
      threads: {
        'kasett-impl': {
          canonical_id: 'kasett-impl',
          label: 'Kasett impl',
          status: 'active',
          sessions: [],
          aliases: ['kasett-impl'],
          total_observations: 1,
          last_compaction: '2026-05-12T16:00:00Z',
        },
      },
    };
    assert.equal(isValidGlobalThreadSnapshot(s), true);
  });

  test('rejects missing fields', () => {
    assert.equal(isValidGlobalThreadSnapshot({}), false);
    assert.equal(
      isValidGlobalThreadSnapshot({ ts: '2026-05-12T16:00:00Z' }),
      false,
    );
    assert.equal(
      isValidGlobalThreadSnapshot({
        threads: {},
      }),
      false,
    );
  });

  test('rejects null / non-objects', () => {
    assert.equal(isValidGlobalThreadSnapshot(null), false);
    assert.equal(isValidGlobalThreadSnapshot('hi'), false);
  });
});
