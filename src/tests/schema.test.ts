import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateThreadMetaV2,
  projectV2ToV1,
  schemaAsPromptString,
  THREAD_META_SCHEMA_V2,
  THREAD_STATUS_VALUES,
  type ThreadMetaV2,
} from '../threads/schema.js';

describe('THREAD_META_SCHEMA_V2 — schema constant', () => {
  test('exposes top-level type=object with required main+sub', () => {
    assert.equal(THREAD_META_SCHEMA_V2.type, 'object');
    assert.deepEqual([...THREAD_META_SCHEMA_V2.required], ['main', 'sub']);
  });

  test('caps sub at 5 items', () => {
    assert.equal(THREAD_META_SCHEMA_V2.properties.sub.maxItems, 5);
  });

  test('enumerates exactly the four valid statuses', () => {
    assert.deepEqual(
      [...THREAD_META_SCHEMA_V2.properties.sub.items.properties.status.enum],
      ['active', 'blocked', 'completed', 'fading'],
    );
  });

  test('decisions and open_questions are optional and capped at 5', () => {
    assert.equal(THREAD_META_SCHEMA_V2.properties.decisions.maxItems, 5);
    assert.equal(THREAD_META_SCHEMA_V2.properties.open_questions.maxItems, 5);
    assert.ok(!THREAD_META_SCHEMA_V2.required.includes('decisions' as never));
  });

  test('THREAD_STATUS_VALUES is consistent with schema enum', () => {
    assert.deepEqual(
      [...THREAD_STATUS_VALUES],
      [...THREAD_META_SCHEMA_V2.properties.sub.items.properties.status.enum],
    );
  });
});

describe('schemaAsPromptString', () => {
  test('returns a JSON.parse-able string', () => {
    const s = schemaAsPromptString();
    const parsed = JSON.parse(s);
    assert.equal(parsed.type, 'object');
    assert.equal(parsed.properties.sub.maxItems, 5);
  });
});

describe('validateThreadMetaV2 — happy path', () => {
  test('accepts minimal valid object (main + empty sub)', () => {
    const result = validateThreadMetaV2({ main: 'building thing', sub: [] });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.main, 'building thing');
      assert.deepEqual(result.value.sub, []);
    }
  });

  test('accepts full v2 with subs, decisions, open_questions', () => {
    const input = {
      main: 'OAuth redirect debugging',
      sub: [
        { id: 'github-app-uri', label: 'Update redirect URI', status: 'completed' },
        { id: 'cdk-prod', label: 'Mirror in prod', status: 'blocked' },
      ],
      decisions: ['Pin to ALB DNS'],
      open_questions: ['Does this affect SSO?'],
    };
    const result = validateThreadMetaV2(input);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.sub.length, 2);
      assert.equal(result.value.sub[0].status, 'completed');
      assert.equal(result.value.decisions?.[0], 'Pin to ALB DNS');
      assert.equal(result.value.open_questions?.[0], 'Does this affect SSO?');
    }
  });

  test('trims whitespace from main, id, label', () => {
    const result = validateThreadMetaV2({
      main: '  hello  ',
      sub: [{ id: '  foo  ', label: '  bar  ', status: 'active' }],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.main, 'hello');
      assert.equal(result.value.sub[0].id, 'foo');
      assert.equal(result.value.sub[0].label, 'bar');
    }
  });

  test('accepts all four status values', () => {
    for (const status of ['active', 'blocked', 'completed', 'fading'] as const) {
      const result = validateThreadMetaV2({
        main: 'm',
        sub: [{ id: 'x', label: 'y', status }],
      });
      assert.equal(result.ok, true, `status=${status} should validate`);
    }
  });
});

describe('validateThreadMetaV2 — failures', () => {
  test('rejects null and primitives', () => {
    assert.equal(validateThreadMetaV2(null).ok, false);
    assert.equal(validateThreadMetaV2(42).ok, false);
    assert.equal(validateThreadMetaV2('hi').ok, false);
    assert.equal(validateThreadMetaV2([]).ok, false);
  });

  test('rejects missing main', () => {
    const result = validateThreadMetaV2({ sub: [] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('main')));
    }
  });

  test('rejects empty main string after trim', () => {
    const result = validateThreadMetaV2({ main: '   ', sub: [] });
    assert.equal(result.ok, false);
  });

  test('rejects missing sub', () => {
    const result = validateThreadMetaV2({ main: 'x' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('sub')));
    }
  });

  test('rejects sub with > 5 items', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: Array(6).fill({ id: 'a', label: 'b', status: 'active' }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('at most 5')));
    }
  });

  test('rejects sub item missing id', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: [{ label: 'y', status: 'active' }],
    });
    assert.equal(result.ok, false);
  });

  test('rejects sub item with invalid status', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: [{ id: 'a', label: 'b', status: 'in-progress' }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('status')));
    }
  });

  test('rejects empty id or label', () => {
    const r1 = validateThreadMetaV2({
      main: 'x',
      sub: [{ id: '', label: 'b', status: 'active' }],
    });
    assert.equal(r1.ok, false);
    const r2 = validateThreadMetaV2({
      main: 'x',
      sub: [{ id: 'a', label: '', status: 'active' }],
    });
    assert.equal(r2.ok, false);
  });

  test('rejects decisions with non-string entry', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: [],
      decisions: ['valid', 42 as unknown as string],
    });
    assert.equal(result.ok, false);
  });

  test('rejects open_questions > 5 items', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: [],
      open_questions: Array(6).fill('q'),
    });
    assert.equal(result.ok, false);
  });

  test('treats null decisions/open_questions as missing (not error)', () => {
    const result = validateThreadMetaV2({
      main: 'x',
      sub: [],
      decisions: null,
      open_questions: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.decisions, undefined);
      assert.equal(result.value.open_questions, undefined);
    }
  });
});

describe('projectV2ToV1', () => {
  test('projects v2 → v1 with all 3 slots filled', () => {
    const v2: ThreadMetaV2 = {
      main: 'm',
      sub: [
        { id: 'a', label: 'A', status: 'active' },
        { id: 'b', label: 'B', status: 'blocked' },
        { id: 'c', label: 'C', status: 'completed' },
      ],
    };
    const v1 = projectV2ToV1(v2);
    assert.equal(v1.main, 'm');
    assert.deepEqual(v1.sub, ['A', 'B', 'C']);
  });

  test('pads with idle when fewer than 3 subs', () => {
    const v2: ThreadMetaV2 = {
      main: 'm',
      sub: [{ id: 'a', label: 'only one', status: 'active' }],
    };
    const v1 = projectV2ToV1(v2);
    assert.deepEqual(v1.sub, ['only one', 'idle', 'idle']);
  });

  test('truncates to 3 when more than 3 subs', () => {
    const v2: ThreadMetaV2 = {
      main: 'm',
      sub: [
        { id: 'a', label: 'A', status: 'active' },
        { id: 'b', label: 'B', status: 'active' },
        { id: 'c', label: 'C', status: 'active' },
        { id: 'd', label: 'D', status: 'active' },
        { id: 'e', label: 'E', status: 'active' },
      ],
    };
    const v1 = projectV2ToV1(v2);
    assert.equal(v1.sub.length, 3);
    assert.deepEqual(v1.sub, ['A', 'B', 'C']);
  });

  test('handles empty sub array — all idle', () => {
    const v2: ThreadMetaV2 = { main: 'm', sub: [] };
    const v1 = projectV2ToV1(v2);
    assert.deepEqual(v1.sub, ['idle', 'idle', 'idle']);
  });
});
