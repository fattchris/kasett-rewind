import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCompactionOutputV3,
  parseCompactionOutputBestEffort,
} from '../threads/parser.js';

describe('parseCompactionOutputV3 — happy path', () => {
  test('parses V3 with key_state from fenced JSON', () => {
    const raw = `Narrative summary describing the work.

\`\`\`json
{
  "main": "OAuth debugging",
  "sub": [
    { "id": "redirect-uri", "label": "Update redirect URI", "status": "completed" }
  ],
  "decisions": ["Pin to ALB DNS"],
  "open_questions": [],
  "key_state": [
    { "kind": "url", "value": "https://staging.example.com/oauth/callback", "label": "callback URL" },
    { "kind": "id", "value": "arn:aws:iam::123:role/x" }
  ]
}
\`\`\``;
    const r = parseCompactionOutputV3(raw);
    assert.ok(r.meta);
    assert.equal(r.meta?.key_state?.length, 2);
    assert.equal(r.meta?.key_state?.[0].kind, 'url');
    assert.equal(r.metaV2?.main, 'OAuth debugging');
    assert.equal(r.metaV1?.sub.length, 3); // padded to 3 with idle
    assert.equal(r.summary, 'Narrative summary describing the work.');
  });

  test('parses V3 without key_state (V2-shaped) cleanly', () => {
    const raw = `Summary text.

\`\`\`json
{ "main": "x", "sub": [] }
\`\`\``;
    const r = parseCompactionOutputV3(raw);
    assert.ok(r.meta);
    assert.equal(r.meta?.key_state, undefined);
    assert.equal(r.metaV2?.sub.length, 0);
  });

  test('drops invalid key_state entries while keeping valid ones', () => {
    const raw = `Summary.

\`\`\`json
{
  "main": "x",
  "sub": [],
  "key_state": [
    { "kind": "url", "value": "https://ok.com" },
    { "kind": "BAD", "value": "nope" },
    { "kind": "path", "value": "/valid/path/here" }
  ]
}
\`\`\``;
    const r = parseCompactionOutputV3(raw);
    assert.ok(r.meta);
    assert.equal(r.meta?.key_state?.length, 2);
  });

  test('returns null meta when no fenced json present', () => {
    const r = parseCompactionOutputV3('just narrative, no json');
    assert.equal(r.meta, null);
    assert.equal(r.metaV1, null);
    assert.match(r.errors[0], /no fenced/);
  });

  test('uses LAST fenced block when multiple are present', () => {
    const raw = `Example schema:
\`\`\`json
{ "main": "EXAMPLE", "sub": [] }
\`\`\`

Actual answer:
\`\`\`json
{ "main": "ACTUAL", "sub": [] }
\`\`\``;
    const r = parseCompactionOutputV3(raw);
    assert.equal(r.meta?.main, 'ACTUAL');
  });

  test('reports JSON parse errors', () => {
    const raw = '\n```json\n{ broken json,, }\n```\n';
    const r = parseCompactionOutputV3(raw);
    assert.equal(r.meta, null);
    assert.match(r.errors[0], /JSON parse failed/);
  });
});

describe('parseCompactionOutputBestEffort — V3 priority', () => {
  test('prefers V3 over V2 when both succeed', () => {
    const raw = `\`\`\`json
{
  "main": "v3 takes priority",
  "sub": [],
  "key_state": [{ "kind": "url", "value": "https://x.com" }]
}
\`\`\``;
    const r = parseCompactionOutputBestEffort(raw);
    assert.equal(r.version, 'v3');
    assert.equal(r.metaV3?.key_state?.length, 1);
    assert.equal(r.metaV2?.main, 'v3 takes priority');
    assert.ok(r.metaV1);
  });

  test('falls through to V2 when key_state absent', () => {
    const raw = `\`\`\`json
{ "main": "no keystate", "sub": [] }
\`\`\``;
    const r = parseCompactionOutputBestEffort(raw);
    // V3 validator accepts this as valid V3 (no key_state)
    assert.equal(r.version, 'v3');
    assert.equal(r.metaV3?.key_state, undefined);
  });

  test('falls back to V1 sentinel block when no JSON fence', () => {
    const raw = `Some narrative.
[THREAD_META]
main: building thing
sub1: alpha
sub2: beta
sub3: idle
[/THREAD_META]`;
    const r = parseCompactionOutputBestEffort(raw);
    assert.equal(r.version, 'v1');
    assert.equal(r.metaV1?.main, 'building thing');
    assert.equal(r.metaV2, null);
    assert.equal(r.metaV3, null);
  });

  test('returns version=none when nothing matches', () => {
    const r = parseCompactionOutputBestEffort('just prose');
    assert.equal(r.version, 'none');
    assert.equal(r.metaV1, null);
    assert.equal(r.metaV2, null);
    assert.equal(r.metaV3, null);
  });
});
