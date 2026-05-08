import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompactionOutput } from '../threads/parser.js';
describe('parseCompactionOutput', () => {
    test('extracts thread meta and clean summary', () => {
        const raw = `This is the narrative summary of what happened.
We worked on authentication and deployed the service.

[THREAD_META]
main: building OAuth2 authentication system
sub1: completing GitHub OAuth integration
sub2: rate limiting at 100 req/min
sub3: monitoring auth performance
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.equal(result.summary, 'This is the narrative summary of what happened.\nWe worked on authentication and deployed the service.');
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'building OAuth2 authentication system');
        assert.deepEqual(result.meta.sub, [
            'completing GitHub OAuth integration',
            'rate limiting at 100 req/min',
            'monitoring auth performance',
        ]);
    });
    test('returns null meta when no THREAD_META block exists', () => {
        const raw = 'Just a plain summary without any thread meta block.';
        const result = parseCompactionOutput(raw);
        assert.equal(result.summary, raw);
        assert.equal(result.meta, null);
    });
    test('handles thread meta with extra whitespace', () => {
        const raw = `Summary here.

[THREAD_META]
  main:   building the thing  
  sub1:   first sub-thread  
  sub2:   second sub-thread  
  sub3:   third sub-thread  
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'building the thing');
        assert.equal(result.meta.sub[0], 'first sub-thread');
        assert.equal(result.meta.sub[1], 'second sub-thread');
        assert.equal(result.meta.sub[2], 'third sub-thread');
    });
    test('returns null meta when block is malformed (missing subs)', () => {
        const raw = `Summary.

[THREAD_META]
main: only a main thread
sub1: just one sub
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.equal(result.meta, null);
        assert.equal(result.summary, 'Summary.');
    });
    test('returns null meta when block is malformed (missing main)', () => {
        const raw = `Summary.

[THREAD_META]
sub1: sub one
sub2: sub two
sub3: sub three
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.equal(result.meta, null);
    });
    test('strips thread meta from middle of summary', () => {
        const raw = `First part of summary.

[THREAD_META]
main: main thread
sub1: sub one
sub2: sub two
sub3: sub three
[/THREAD_META]

Some trailing text that should not be here but we handle it.`;
        const result = parseCompactionOutput(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'main thread');
        assert.ok(result.summary.includes('First part of summary.'));
        assert.ok(result.summary.includes('Some trailing text'));
        assert.ok(!result.summary.includes('[THREAD_META]'));
    });
    test('handles case-insensitive field names', () => {
        const raw = `Summary.

[THREAD_META]
Main: building something
Sub1: first thing
Sub2: second thing
Sub3: third thing
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'building something');
    });
    test('preserves colons in thread descriptions', () => {
        const raw = `Summary.

[THREAD_META]
main: deploying service at https://api.example.com:8080
sub1: configuring rate limit: 100 req/min
sub2: monitoring via endpoint: /health
sub3: testing OAuth flow
[/THREAD_META]`;
        const result = parseCompactionOutput(raw);
        assert.ok(result.meta);
        assert.equal(result.meta.main, 'deploying service at https://api.example.com:8080');
        assert.equal(result.meta.sub[0], 'configuring rate limit: 100 req/min');
        assert.equal(result.meta.sub[1], 'monitoring via endpoint: /health');
    });
});
//# sourceMappingURL=parser.test.js.map