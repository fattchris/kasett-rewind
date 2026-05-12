import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKeyState,
  pickContinuityKeyState,
} from '../threads/weight.js';
import type { ThreadMetaV3 } from '../threads/schema.js';

const meta = (...keyState: Array<[string, string, string?]>): ThreadMetaV3 => ({
  main: 'm',
  sub: [],
  key_state: keyState.map(([kind, value, label]) => ({
    kind: kind as 'url' | 'id' | 'path' | 'version' | 'config' | 'value',
    value,
    ...(label ? { label } : {}),
  })),
});

describe('classifyKeyState — core / fresh / fading', () => {
  test('value present in all 3 most recent → core', () => {
    const result = classifyKeyState([
      meta(['url', 'https://x.com'], ['id', 'a-1']),
      meta(['url', 'https://x.com'], ['id', 'a-1']),
      meta(['url', 'https://x.com']),
    ]);
    const x = result.find((r) => r.value === 'https://x.com');
    assert.equal(x?.classification, 'core');
    assert.equal(x?.appearances, 3);
  });

  test('value first appearing in most-recent → fresh', () => {
    const result = classifyKeyState([
      meta(['url', 'https://NEW.com']),
      meta(['url', 'https://old.com']),
      meta(['url', 'https://old.com']),
    ]);
    const fresh = result.find((r) => r.value === 'https://NEW.com');
    assert.equal(fresh?.classification, 'fresh');
  });

  test('value only in older slots → fading', () => {
    const result = classifyKeyState([
      meta(['url', 'https://current.com']),
      meta(['url', 'https://gone.com']),
      meta(['url', 'https://gone.com']),
    ]);
    const fading = result.find((r) => r.value === 'https://gone.com');
    assert.equal(fading?.classification, 'fading');
  });

  test('exact (kind, value) match — same value with different kind is treated separately', () => {
    const result = classifyKeyState([
      meta(['url', '/foo/bar']),     // unusual but valid
      meta(['path', '/foo/bar']),
    ]);
    assert.equal(result.length, 2);
  });

  test('keeps latest label when label first present in newer slot', () => {
    const result = classifyKeyState([
      meta(['url', 'https://x.com', 'fresh label']),
      meta(['url', 'https://x.com']),
    ]);
    const x = result.find((r) => r.value === 'https://x.com');
    assert.equal(x?.label, 'fresh label');
  });

  test('handles metas without key_state (empty list)', () => {
    const result = classifyKeyState([
      meta(),
      meta(),
    ]);
    assert.deepEqual(result, []);
  });

  test('handles metas with undefined key_state field', () => {
    const result = classifyKeyState([
      { main: 'a', sub: [] },
      { main: 'b', sub: [] },
    ]);
    assert.deepEqual(result, []);
  });

  test('returns empty for zero metas', () => {
    assert.deepEqual(classifyKeyState([]), []);
  });
});

describe('pickContinuityKeyState', () => {
  test('keeps core and fresh, drops fading', () => {
    const classified = classifyKeyState([
      meta(['url', 'https://core.com'], ['url', 'https://fresh.com']),
      meta(['url', 'https://core.com'], ['url', 'https://fading.com']),
      meta(['url', 'https://core.com']),
    ]);
    const picked = pickContinuityKeyState(classified);
    const values = picked.map((p) => p.value).sort();
    assert.deepEqual(values, ['https://core.com', 'https://fresh.com']);
  });

  test('preserves label when present', () => {
    const classified = classifyKeyState([
      meta(['url', 'https://x.com', 'my label']),
    ]);
    const picked = pickContinuityKeyState(classified);
    assert.equal(picked[0].label, 'my label');
  });

  test('returns empty when input is empty', () => {
    assert.deepEqual(pickContinuityKeyState([]), []);
  });
});
