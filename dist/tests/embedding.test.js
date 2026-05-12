import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, fingerprintCosine, DEFAULT_DIMS } from '../threads/embedding.js';
describe('fingerprint', () => {
    test('returns Uint8Array of length dims/8 by default', () => {
        const fp = fingerprint('hello world');
        assert.ok(fp instanceof Uint8Array);
        assert.equal(fp.length, DEFAULT_DIMS / 8);
    });
    test('is deterministic for the same input', () => {
        const a = fingerprint('OAuth redirect debugging');
        const b = fingerprint('OAuth redirect debugging');
        assert.deepEqual(Array.from(a), Array.from(b));
    });
    test('empty string yields empty (all zeros) fingerprint', () => {
        const fp = fingerprint('');
        let bits = 0;
        for (const byte of fp) {
            for (let i = 0; i < 8; i++)
                bits += (byte >> i) & 1;
        }
        assert.equal(bits, 0);
    });
    test('throws if dims is not positive multiple of 8', () => {
        assert.throws(() => fingerprint('x', 0));
        assert.throws(() => fingerprint('x', 7));
        assert.throws(() => fingerprint('x', -8));
    });
    test('different labels produce different fingerprints', () => {
        const a = fingerprint('Deploy API');
        const b = fingerprint('Refactor database schema');
        assert.notDeepEqual(Array.from(a), Array.from(b));
    });
});
describe('fingerprintCosine', () => {
    test('identical fingerprints have cosine 1.0', () => {
        const a = fingerprint('Deploy API to staging');
        const b = fingerprint('Deploy API to staging');
        assert.equal(fingerprintCosine(a, b), 1.0);
    });
    test('disjoint label tokens have low cosine', () => {
        const a = fingerprint('Deploy API');
        const b = fingerprint('Refactor schema');
        const c = fingerprintCosine(a, b);
        assert.ok(c < 0.5, `expected low cosine, got ${c}`);
    });
    test('partially overlapping tokens have intermediate cosine', () => {
        const a = fingerprint('OAuth redirect staging debugging');
        const b = fingerprint('OAuth redirect production debugging');
        // Three tokens overlap (oauth, redirect, debugging), one unique each
        const c = fingerprintCosine(a, b);
        assert.ok(c > 0.5 && c < 1.0, `expected intermediate cosine, got ${c}`);
    });
    test('similarity ordering: identical > overlapping > disjoint', () => {
        const cur = fingerprint('Deploy API staging');
        const same = fingerprint('Deploy API staging');
        const partial = fingerprint('Deploy API production');
        const disjoint = fingerprint('Refactor billing module');
        const cSame = fingerprintCosine(cur, same);
        const cPartial = fingerprintCosine(cur, partial);
        const cDisjoint = fingerprintCosine(cur, disjoint);
        assert.ok(cSame > cPartial, `same(${cSame}) should exceed partial(${cPartial})`);
        assert.ok(cPartial > cDisjoint, `partial(${cPartial}) should exceed disjoint(${cDisjoint})`);
    });
    test('empty fingerprint vs anything returns 0', () => {
        const empty = fingerprint('');
        const a = fingerprint('Deploy API');
        assert.equal(fingerprintCosine(empty, a), 0);
        assert.equal(fingerprintCosine(a, empty), 0);
    });
    test('throws on length mismatch', () => {
        const a = fingerprint('x', 256);
        const b = fingerprint('x', 512);
        assert.throws(() => fingerprintCosine(a, b));
    });
});
//# sourceMappingURL=embedding.test.js.map