import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchThread, matchAllThreads, tokenize, jaccard, } from '../threads/identity.js';
const sub = (id, label, status = 'active') => ({
    id,
    label,
    status,
});
describe('tokenize', () => {
    test('lowercases, splits on non-alphanumeric, drops short + stopwords', () => {
        const t = tokenize('Deploy API to staging');
        assert.deepEqual(Array.from(t).sort(), ['api', 'deploy', 'staging']);
    });
    test('drops two-character tokens', () => {
        const t = tokenize('UI test');
        assert.deepEqual(Array.from(t).sort(), ['test']);
    });
    test('handles empty input', () => {
        assert.equal(tokenize('').size, 0);
    });
    test('punctuation does not produce empty tokens', () => {
        const t = tokenize('debug-prod-deploy!');
        assert.deepEqual(Array.from(t).sort(), ['debug', 'deploy', 'prod']);
    });
});
describe('jaccard', () => {
    test('identical sets => 1.0', () => {
        const a = new Set(['x', 'y']);
        const b = new Set(['x', 'y']);
        assert.equal(jaccard(a, b), 1.0);
    });
    test('disjoint sets => 0', () => {
        assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
    });
    test('partial overlap', () => {
        const a = new Set(['a', 'b', 'c']);
        const b = new Set(['b', 'c', 'd']);
        // |∩|=2, |∪|=4 => 0.5
        assert.equal(jaccard(a, b), 0.5);
    });
    test('empty input returns 0', () => {
        assert.equal(jaccard(new Set(), new Set(['a'])), 0);
        assert.equal(jaccard(new Set(['a']), new Set()), 0);
    });
});
describe('matchThread — exact-id tier', () => {
    test('exact id match returns confidence 1.0', () => {
        const cur = sub('deploy-api', 'Deploy API to prod');
        const prev = [sub('deploy-api', 'Deploy API')];
        const m = matchThread(cur, prev);
        assert.equal(m.strategy, 'exact-id');
        assert.equal(m.confidence, 1.0);
        assert.equal(m.matched_to, 'deploy-api');
        assert.equal(m.evolved, true); // label changed
    });
    test('exact id match same label → not evolved', () => {
        const cur = sub('deploy-api', 'Deploy API');
        const prev = [sub('deploy-api', 'Deploy API')];
        const m = matchThread(cur, prev);
        assert.equal(m.evolved, false);
    });
});
describe('matchThread — lexical tier', () => {
    test('different ids, overlapping labels match via Jaccard', () => {
        const cur = sub('deploy', 'Deploy API to staging');
        const prev = [sub('infra-deploy', 'Deploy API staging')];
        // tokens: {deploy, api, staging} vs {deploy, api, staging} → 1.0
        const m = matchThread(cur, prev);
        assert.equal(m.strategy, 'lexical');
        assert.ok(m.confidence >= 0.5);
        assert.equal(m.matched_to, 'infra-deploy');
        assert.equal(m.evolved, true);
    });
    test('lexical threshold can be tightened', () => {
        const cur = sub('a', 'Deploy API staging environment');
        const prev = [sub('b', 'Deploy production')];
        // Slight overlap on "deploy" only; Jaccard ~0.2
        const m = matchThread(cur, prev, { lexicalThreshold: 0.5 });
        assert.equal(m.strategy, 'none');
    });
    test('picks best lexical match when multiple candidates', () => {
        const cur = sub('q', 'OAuth redirect debugging staging');
        const prev = [
            sub('a', 'Random unrelated work'),
            sub('b', 'OAuth redirect staging'),
            sub('c', 'OAuth flow research'),
        ];
        const m = matchThread(cur, prev);
        assert.equal(m.matched_to, 'b'); // best Jaccard overlap
    });
});
describe('matchThread — semantic tier (opt-in)', () => {
    test('semantic tier disabled by default', () => {
        const cur = sub('a', 'GitHub PR review');
        const prev = [sub('b', 'Pull request review')];
        // no token overlap → lexical=none, but semantic might catch it via hash collision
        const m = matchThread(cur, prev);
        // We assert default: semantic is OFF, so we expect 'none'
        assert.equal(m.strategy, 'none');
    });
    test('semantic tier returns a match when enabled and labels share tokens', () => {
        // Bag-of-tokens fingerprint: identical labels → cosine 1.0
        const cur = sub('a', 'OAuth redirect debugging');
        const prev = [sub('b', 'OAuth redirect debugging')];
        // Lexical actually catches this first; semantic only triggers when lexical fails.
        const m = matchThread(cur, prev, { useEmbedding: true });
        assert.equal(m.strategy, 'lexical');
    });
});
describe('matchThread — none tier', () => {
    test('returns none when no previous threads', () => {
        const m = matchThread(sub('a', 'A'), []);
        assert.equal(m.strategy, 'none');
        assert.equal(m.confidence, 0);
    });
    test('returns none when no overlap', () => {
        const cur = sub('xyz', 'Aurora regulatory framework');
        const prev = [sub('abc', 'Kubernetes operator deployment')];
        const m = matchThread(cur, prev);
        assert.equal(m.strategy, 'none');
    });
});
describe('matchAllThreads', () => {
    test('returns one match per current thread', () => {
        const cur = [sub('a', 'A'), sub('b', 'B')];
        const prev = [sub('a', 'A')];
        const m = matchAllThreads(cur, prev);
        assert.equal(m.size, 2);
        assert.equal(m.get('a')?.strategy, 'exact-id');
        assert.equal(m.get('b')?.strategy, 'none');
    });
});
//# sourceMappingURL=identity.test.js.map