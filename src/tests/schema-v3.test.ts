import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateThreadMetaV3,
  isValidKeyStateEntry,
  projectV3ToV2,
  schemaV3AsPromptString,
  THREAD_META_SCHEMA_V3,
  KEY_STATE_KINDS,
  MAX_KEY_STATE,
  type ThreadMetaV3,
} from '../threads/schema.js';

describe('THREAD_META_SCHEMA_V3 — schema constant', () => {
  test('extends V2 with optional key_state array', () => {
    assert.equal(THREAD_META_SCHEMA_V3.type, 'object');
    assert.deepEqual([...THREAD_META_SCHEMA_V3.required], ['main', 'sub']);
    assert.equal(THREAD_META_SCHEMA_V3.properties.key_state.maxItems, 20);
  });

  test('key_state items require kind+value', () => {
    const ksItems = THREAD_META_SCHEMA_V3.properties.key_state.items;
    assert.deepEqual([...ksItems.required], ['kind', 'value']);
  });

  test('enumerates exactly six kinds', () => {
    assert.deepEqual(
      [...THREAD_META_SCHEMA_V3.properties.key_state.items.properties.kind.enum],
      ['url', 'id', 'path', 'version', 'config', 'value'],
    );
  });

  test('KEY_STATE_KINDS matches schema enum', () => {
    assert.deepEqual(
      [...KEY_STATE_KINDS],
      [...THREAD_META_SCHEMA_V3.properties.key_state.items.properties.kind.enum],
    );
  });

  test('MAX_KEY_STATE matches maxItems', () => {
    assert.equal(MAX_KEY_STATE, THREAD_META_SCHEMA_V3.properties.key_state.maxItems);
  });
});

describe('schemaV3AsPromptString', () => {
  test('returns parseable JSON', () => {
    const s = schemaV3AsPromptString();
    const parsed = JSON.parse(s);
    assert.equal(parsed.properties.key_state.maxItems, 20);
  });
});

describe('isValidKeyStateEntry', () => {
  test('accepts minimal valid entry', () => {
    const r = isValidKeyStateEntry({ kind: 'url', value: 'https://example.com' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.kind, 'url');
      assert.equal(r.value.value, 'https://example.com');
    }
  });

  test('accepts entry with all optional fields', () => {
    const r = isValidKeyStateEntry({
      kind: 'id',
      value: 'arn:aws:iam::123:role/x',
      label: 'sudo role',
      context: 'used for elevated ops',
      thread_id: 'sudo-setup',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.label, 'sudo role');
      assert.equal(r.value.context, 'used for elevated ops');
      assert.equal(r.value.thread_id, 'sudo-setup');
    }
  });

  test('rejects unknown kind', () => {
    const r = isValidKeyStateEntry({ kind: 'foo', value: 'x' });
    assert.equal(r.ok, false);
  });

  test('rejects empty value', () => {
    const r = isValidKeyStateEntry({ kind: 'url', value: '' });
    assert.equal(r.ok, false);
  });

  test('rejects non-string label', () => {
    const r = isValidKeyStateEntry({ kind: 'url', value: 'x', label: 42 });
    assert.equal(r.ok, false);
  });

  test('rejects non-object input', () => {
    const r = isValidKeyStateEntry('hello');
    assert.equal(r.ok, false);
  });

  test('drops empty optional strings (treated as absent)', () => {
    const r = isValidKeyStateEntry({ kind: 'url', value: 'x', label: '' });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.label, undefined);
  });
});

describe('validateThreadMetaV3', () => {
  test('accepts V2-shaped object (no key_state) as valid V3', () => {
    const v3 = validateThreadMetaV3({ main: 'work', sub: [] });
    assert.equal(v3.ok, true);
    if (v3.ok) {
      assert.equal(v3.value.main, 'work');
      assert.equal(v3.value.key_state, undefined);
    }
  });

  test('accepts V3 with valid key_state', () => {
    const v3 = validateThreadMetaV3({
      main: 'oauth',
      sub: [{ id: 'a', label: 'A', status: 'active' }],
      key_state: [
        { kind: 'url', value: 'https://x.com' },
        { kind: 'id', value: 'arn:aws:iam::1:role/r' },
      ],
    });
    assert.equal(v3.ok, true);
    if (v3.ok) {
      assert.equal(v3.value.key_state?.length, 2);
    }
  });

  test('drops invalid key_state entries silently while keeping valid ones', () => {
    const v3 = validateThreadMetaV3({
      main: 'x',
      sub: [],
      key_state: [
        { kind: 'url', value: 'https://ok.com' },
        { kind: 'badkind', value: 'nope' },     // dropped
        { kind: 'id', value: '' },               // dropped
        { kind: 'path', value: '/valid/path' },
      ],
    });
    assert.equal(v3.ok, true);
    if (v3.ok) {
      assert.equal(v3.value.key_state?.length, 2);
      assert.deepEqual(
        v3.value.key_state?.map((e) => e.value),
        ['https://ok.com', '/valid/path'],
      );
    }
  });

  test('caps key_state at MAX_KEY_STATE', () => {
    const ks = Array.from({ length: 30 }, (_, i) => ({
      kind: 'value',
      value: `v${i}`,
    }));
    const v3 = validateThreadMetaV3({ main: 'x', sub: [], key_state: ks });
    assert.equal(v3.ok, true);
    if (v3.ok) {
      assert.equal(v3.value.key_state?.length, MAX_KEY_STATE);
    }
  });

  test('treats non-array key_state as missing', () => {
    const v3 = validateThreadMetaV3({ main: 'x', sub: [], key_state: 'oops' });
    assert.equal(v3.ok, true);
    if (v3.ok) assert.equal(v3.value.key_state, undefined);
  });

  test('rejects when V2 part is invalid (missing main)', () => {
    const v3 = validateThreadMetaV3({ sub: [], key_state: [] });
    assert.equal(v3.ok, false);
  });
});

describe('projectV3ToV2', () => {
  test('drops key_state, preserves V2 fields', () => {
    const v3: ThreadMetaV3 = {
      main: 'm',
      sub: [{ id: 'a', label: 'A', status: 'active' }],
      decisions: ['d1'],
      open_questions: ['q1'],
      key_state: [{ kind: 'url', value: 'https://x' }],
    };
    const v2 = projectV3ToV2(v3);
    assert.equal((v2 as ThreadMetaV3).key_state, undefined);
    assert.equal(v2.main, 'm');
    assert.deepEqual(v2.decisions, ['d1']);
    assert.deepEqual(v2.open_questions, ['q1']);
  });

  test('omits decisions/open_questions when undefined', () => {
    const v3: ThreadMetaV3 = { main: 'm', sub: [] };
    const v2 = projectV3ToV2(v3);
    assert.equal(v2.decisions, undefined);
    assert.equal(v2.open_questions, undefined);
  });
});
