import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCandidateKeyState, detectInString, flattenMessages, } from '../keystate/detector.js';
const findOne = (results, predicate) => results.find(predicate);
describe('detectInString — URLs', () => {
    test('finds plain http/https URLs', () => {
        const r = detectInString('see https://example.com/foo and http://x.test/y');
        const urls = r.filter((e) => e.kind === 'url').map((e) => e.value);
        assert.deepEqual(urls.sort(), [
            'http://x.test/y',
            'https://example.com/foo',
        ]);
    });
    test('strips trailing punctuation', () => {
        const r = detectInString('Visit https://example.com.');
        assert.equal(findOne(r, (e) => e.kind === 'url')?.value, 'https://example.com');
    });
    test('handles URLs in markdown link text without dragging brackets', () => {
        const r = detectInString('[link](https://example.com/path)');
        assert.equal(findOne(r, (e) => e.kind === 'url')?.value, 'https://example.com/path');
    });
});
describe('detectInString — AWS / IDs', () => {
    test('finds AWS ARN as id', () => {
        const r = detectInString('role: arn:aws:iam::843979154439:role/clyde-sudo');
        assert.equal(findOne(r, (e) => e.kind === 'id' && e.value.startsWith('arn:'))?.value, 'arn:aws:iam::843979154439:role/clyde-sudo');
    });
    test('finds AWS resource IDs (vpc, subnet, sg, i-)', () => {
        const r = detectInString('vpc-0a1b2c3d4e5f67890 sg-deadbeef i-00112233445566778');
        const ids = r.filter((e) => e.kind === 'id').map((e) => e.value);
        assert.ok(ids.includes('vpc-0a1b2c3d4e5f67890'));
        assert.ok(ids.includes('sg-deadbeef'));
        assert.ok(ids.includes('i-00112233445566778'));
    });
    test('finds UUID', () => {
        const r = detectInString('uuid: 12345678-1234-1234-1234-1234567890ab');
        assert.equal(findOne(r, (e) => e.kind === 'id' && e.value.includes('12345678'))?.value, '12345678-1234-1234-1234-1234567890ab');
    });
    test('finds git SHA', () => {
        const r = detectInString('commit a1b2c3d4 fixed the bug');
        assert.ok(r.some((e) => e.kind === 'id' && e.value === 'a1b2c3d4'));
    });
    test('does not classify pure numeric strings as git SHA', () => {
        const r = detectInString('timestamp 1234567890 is a number not a sha');
        assert.equal(r.find((e) => e.kind === 'id' && /^\d+$/.test(e.value)), undefined);
    });
});
describe('detectInString — paths', () => {
    test('finds absolute paths with multiple slashes', () => {
        const r = detectInString('see /home/node/.openclaw/workspace/foo.md for details');
        assert.ok(r.some((e) => e.kind === 'path' && e.value === '/home/node/.openclaw/workspace/foo.md'));
    });
    test('skips short paths', () => {
        const r = detectInString('a /x file');
        assert.equal(r.find((e) => e.kind === 'path'), undefined);
    });
    test('requires at least 2 slashes', () => {
        const r = detectInString('use /etc only');
        assert.equal(r.find((e) => e.kind === 'path'), undefined);
    });
});
describe('detectInString — versions', () => {
    test('finds semver with patch', () => {
        const r = detectInString('upgrade to 4.14.2');
        assert.ok(r.some((e) => e.kind === 'version' && e.value === '4.14.2'));
    });
    test('finds v-prefixed', () => {
        const r = detectInString('v2.0 is stable');
        assert.ok(r.some((e) => e.kind === 'version' && e.value === 'v2.0'));
    });
    test('finds prerelease suffix', () => {
        const r = detectInString('using 1.0.0-rc.3 today');
        assert.ok(r.some((e) => e.kind === 'version' && e.value === '1.0.0-rc.3'));
    });
    test('skips bare 1.0 / 3.14 to reduce noise', () => {
        const r = detectInString('pi = 3.14 is well known');
        assert.equal(r.find((e) => e.kind === 'version' && e.value === '3.14'), undefined);
    });
    test('finds known model identifiers', () => {
        const r = detectInString('using claude-opus-4-7 and gpt-4-turbo today');
        const versions = r.filter((e) => e.kind === 'version').map((e) => e.value);
        assert.ok(versions.includes('claude-opus-4-7'));
        assert.ok(versions.includes('gpt-4-turbo'));
    });
});
describe('detectInString — config', () => {
    test('finds KEY=value tokens', () => {
        const r = detectInString('Set FOO_BAR=hello and PORT=18800 today');
        const configs = r.filter((e) => e.kind === 'config').map((e) => e.value);
        assert.ok(configs.includes('FOO_BAR=hello'));
        assert.ok(configs.includes('PORT=18800'));
    });
    test('ignores lowercase keys', () => {
        const r = detectInString('foo=bar baz=qux');
        assert.equal(r.find((e) => e.kind === 'config'), undefined);
    });
});
describe('detectInString — overlap suppression', () => {
    test('UUID is not double-classified as git SHA', () => {
        const r = detectInString('id 12345678-1234-1234-1234-1234567890ab here');
        const ids = r.filter((e) => e.kind === 'id');
        // Should be exactly 1 (the UUID) — not 1 UUID + 5 fragmented hex SHAs
        assert.equal(ids.length, 1);
        assert.ok(ids[0].value.includes('12345678-1234'));
    });
    test('AWS ARN is id, not split into fragment versions/paths', () => {
        const r = detectInString('arn:aws:iam::843979154439:role/clyde-sudo');
        const arn = r.find((e) => e.value.startsWith('arn:'));
        assert.equal(arn?.kind, 'id');
    });
});
describe('detectInString — deduplication', () => {
    test('repeated identical values yield one entry', () => {
        const r = detectInString('see https://example.com and https://example.com again, plus https://example.com');
        assert.equal(r.filter((e) => e.value === 'https://example.com').length, 1);
    });
    test('same value with different kinds is preserved', () => {
        // Deduplication is per (kind, value) pair. 7-char lowercase hex SHA.
        const r = detectInString('a1b2c3d touched the file');
        assert.ok(r.some((e) => e.kind === 'id' && e.value === 'a1b2c3d'));
    });
});
describe('detectCandidateKeyState — message wrapping', () => {
    test('handles string content', () => {
        const r = detectCandidateKeyState([
            { role: 'user', content: 'see https://x.com today' },
        ]);
        assert.ok(r.some((e) => e.kind === 'url' && e.value === 'https://x.com'));
    });
    test('handles array-of-parts content', () => {
        const r = detectCandidateKeyState([
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'check ' },
                    { type: 'text', text: '/path/to/file.md' },
                ],
            },
        ]);
        assert.ok(r.some((e) => e.kind === 'path' && e.value === '/path/to/file.md'));
    });
    test('handles object content with .text', () => {
        const r = detectCandidateKeyState([
            { role: 'user', content: { type: 'text', text: 'arn:aws:s3:::my-bucket' } },
        ]);
        assert.ok(r.some((e) => e.kind === 'id'));
    });
    test('returns empty for empty input', () => {
        assert.deepEqual(detectCandidateKeyState([]), []);
    });
    test('survives null/undefined content gracefully', () => {
        const r = detectCandidateKeyState([
            { role: 'user', content: null },
            { role: 'user', content: undefined },
            { role: 'user', content: 'https://ok.com' },
        ]);
        assert.equal(r.length, 1);
        assert.equal(r[0].value, 'https://ok.com');
    });
});
describe('flattenMessages', () => {
    test('joins string and array contents', () => {
        const s = flattenMessages([
            { role: 'u', content: 'one' },
            { role: 'a', content: ['two', 'three'] },
        ]);
        assert.match(s, /one/);
        assert.match(s, /two/);
        assert.match(s, /three/);
    });
});
//# sourceMappingURL=keystate-detector.test.js.map