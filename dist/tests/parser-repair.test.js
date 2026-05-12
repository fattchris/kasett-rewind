/**
 * Phase F — V3 parser truncation repair tests.
 *
 * Production evidence (2026-05-12 16:35 UTC compaction in topic-12388):
 * Sonnet 4.5 produced a 14,113-char structured JSON body inside a fenced
 * ```json``` block. The output hit max_tokens mid-string and the closing
 * fence was lost, so the strict V3 parser bailed with PARSE_NONE. These
 * tests exercise the new repair path.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompactionOutputV3, parseCompactionOutputBestEffort, repairTruncatedJson, } from '../threads/parser.js';
describe('repairTruncatedJson', () => {
    test('returns input unchanged on well-formed JSON', () => {
        const text = '{"a":1,"b":[1,2,3]}';
        const r = repairTruncatedJson(text);
        assert.equal(r.repaired, text);
        assert.equal(r.repairsMade.length, 0);
    });
    test('closes an unterminated string', () => {
        const text = '{"a":"unfinished';
        const r = repairTruncatedJson(text);
        // Should append `"` and close the object
        assert.match(r.repaired, /"$|"\}$/);
        assert.ok(r.repairsMade.some((s) => s.startsWith('closed_unterminated_string')));
        assert.doesNotThrow(() => JSON.parse(r.repaired));
    });
    test('closes nested arrays and objects', () => {
        const text = '{"a":{"b":[1,2,{"c":';
        const r = repairTruncatedJson(text);
        assert.doesNotThrow(() => JSON.parse(r.repaired));
    });
    test('drops trailing comma before closing', () => {
        const text = '{"a":1, "b":2,';
        const r = repairTruncatedJson(text);
        assert.ok(r.repairsMade.includes('dropped_trailing_comma'));
        assert.doesNotThrow(() => JSON.parse(r.repaired));
    });
    test('drops orphan key (key without value) with leading comma', () => {
        const text = '{"a":1, "b":';
        const r = repairTruncatedJson(text);
        const parsed = JSON.parse(r.repaired);
        assert.equal(parsed['a'], 1);
        assert.ok(!('b' in parsed));
    });
    test('handles escaped quotes inside strings correctly', () => {
        const text = '{"a":"he said \\"hello\\""}';
        const r = repairTruncatedJson(text);
        assert.equal(r.repaired, text); // already valid
        const parsed = JSON.parse(r.repaired);
        assert.equal(parsed['a'], 'he said "hello"');
    });
    test('truncated mid-string with escaped chars still closes', () => {
        const text = '{"label":"Estimated cost for ';
        const r = repairTruncatedJson(text);
        assert.doesNotThrow(() => JSON.parse(r.repaired));
        const parsed = JSON.parse(r.repaired);
        assert.equal(typeof parsed['label'], 'string');
        assert.match(parsed['label'], /^Estimated cost/);
    });
    test('truncated array of objects', () => {
        const text = '[{"a":1},{"b":2},{"c":';
        const r = repairTruncatedJson(text);
        const parsed = JSON.parse(r.repaired);
        assert.ok(Array.isArray(parsed));
        assert.ok(parsed.length >= 2);
        assert.equal(parsed[0].a, 1);
        assert.equal(parsed[1].b, 2);
    });
});
describe('parseCompactionOutputV3 — truncation repair', () => {
    test('open fence with complete JSON parses', () => {
        const raw = `Narrative.\n\n\`\`\`json\n{ "main": "Test", "sub": [] }`;
        const r = parseCompactionOutputV3(raw);
        assert.ok(r.meta, `expected meta, got errors: ${r.errors.join('|')}`);
        assert.equal(r.meta?.main, 'Test');
        // Should report the open-fence path
        assert.ok(r.errors.some((e) => e.includes('open-fence-no-repair')));
    });
    test('truncated mid-string in nested object recovers', () => {
        const raw = `Narrative summary.

\`\`\`json
{
  "main": "Working on V3 parser repair",
  "sub": [
    { "id": "fix-parser", "label": "Make parser tolerate truncation", "status": "active" }
  ],
  "decisions": [],
  "open_questions": [],
  "key_state": [
    { "kind": "path", "value": "/src/threads/parser.ts", "label": "parser file" },
    { "kind": "value", "value": "32000", "label": "Estimated cost for `;
        const r = parseCompactionOutputV3(raw);
        assert.ok(r.meta, `expected recovered meta, got errors: ${r.errors.join('|')}`);
        assert.equal(r.meta?.main, 'Working on V3 parser repair');
        assert.ok(r.meta?.sub.length === 1);
        // Truncated key_state entry was either repaired or dropped — at minimum
        // we should have the first complete entry
        assert.ok(Array.isArray(r.meta?.key_state) && (r.meta?.key_state?.length ?? 0) >= 1);
        // Should be flagged partial
        const metaWithFlag = r.meta;
        assert.equal(metaWithFlag._partial, true);
    });
    test('truncated mid-array still recovers via lenient extract', () => {
        // Open fence, then a deeply truncated body that even the bracket
        // balancer can't quite save (deliberate dangling state).
        const raw = `\`\`\`json
{
  "main": "Recovery test",
  "sub": [
    { "id": "alpha", "label": "First", "status": "active" },
    { "id": "beta", "label": "Second", "status": "completed" },
    { "id": "gamma", "label": "Third", "stat`;
        const r = parseCompactionOutputV3(raw);
        assert.ok(r.meta, `expected meta, got errors: ${r.errors.join('|')}`);
        assert.equal(r.meta?.main, 'Recovery test');
        // At least the two complete sub items should survive
        assert.ok((r.meta?.sub.length ?? 0) >= 2);
    });
    test('valid closed fence is not affected by repair path', () => {
        const raw = `narrative

\`\`\`json
{ "main": "x", "sub": [] }
\`\`\``;
        const r = parseCompactionOutputV3(raw);
        assert.ok(r.meta);
        assert.equal(r.meta?.main, 'x');
        // Should NOT carry recovery markers
        assert.ok(!r.errors.some((e) => e.includes('recovered:')));
    });
    test('no fence at all returns null with appropriate error', () => {
        const r = parseCompactionOutputV3('Just narrative, no JSON');
        assert.equal(r.meta, null);
        assert.ok(r.errors.some((e) => e.includes('no fenced')));
    });
});
describe('parseCompactionOutputBestEffort — repair path', () => {
    test('reports v3 even when repair was needed', () => {
        const raw = `\`\`\`json
{ "main": "needs repair", "sub": [{"id":"x","label":"y","status":"active"}], "key_state":[`;
        const r = parseCompactionOutputBestEffort(raw);
        assert.equal(r.version, 'v3');
        assert.equal(r.metaV3?.main, 'needs repair');
    });
    test('falls through to v2 then v1 in order when no JSON at all', () => {
        const v1raw = `Narrative.

[THREAD_META]
main: legacy thread
sub1: alpha
sub2: beta
sub3: gamma
[/THREAD_META]`;
        const r = parseCompactionOutputBestEffort(v1raw);
        assert.equal(r.version, 'v1');
        assert.equal(r.metaV1?.main, 'legacy thread');
    });
});
//# sourceMappingURL=parser-repair.test.js.map