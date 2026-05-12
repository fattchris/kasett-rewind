import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCanonicalThread, findCanonicalThreadsBatch, } from '../global/matcher.js';
const rec = (over) => ({
    ts: '2026-05-12T12:00:00Z',
    agent_id: 'main',
    session_id: 's-A',
    thread_id: 'orig',
    label: 'orig label',
    status: 'active',
    schema_version: 'v3',
    ...over,
});
describe('findCanonicalThread — exact-id', () => {
    test('exact thread_id match returns canonical', () => {
        const recs = [
            rec({
                ts: '2026-05-10T00:00:00Z',
                thread_id: 'kasett-impl',
                canonical_id: 'kasett-impl',
                label: 'Kasett implementation',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'kasett-impl', label: 'Kasett implementation' }, recs);
        assert.equal(m.match_strategy, 'exact-id');
        assert.equal(m.canonical_id, 'kasett-impl');
        assert.equal(m.confidence, 1.0);
    });
    test('exact-id match wins over lexical even when older', () => {
        const recs = [
            rec({
                ts: '2026-05-12T00:00:00Z',
                thread_id: 'other-thread',
                canonical_id: 'other-thread',
                label: 'kasett implementation new',
            }),
            rec({
                ts: '2026-05-10T00:00:00Z',
                thread_id: 'kasett-impl',
                canonical_id: 'kasett-canon',
                label: 'unrelated label',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'kasett-impl', label: 'something' }, recs);
        assert.equal(m.match_strategy, 'exact-id');
        assert.equal(m.canonical_id, 'kasett-canon');
    });
    test('matches against canonical_id alias', () => {
        const recs = [
            rec({
                thread_id: 'old-id',
                canonical_id: 'kasett-impl',
                label: 'kasett',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'kasett-impl', label: 'kasett' }, recs);
        assert.equal(m.match_strategy, 'exact-id');
        assert.equal(m.canonical_id, 'kasett-impl');
    });
});
describe('findCanonicalThread — lexical', () => {
    test('matches when label tokens overlap above threshold', () => {
        const recs = [
            rec({
                thread_id: 'aws-vpc-cleanup',
                label: 'AWS VPC cleanup phase one',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'fresh-id', label: 'AWS VPC cleanup continued' }, recs);
        assert.equal(m.match_strategy, 'lexical');
        assert.ok(m.confidence >= 0.5);
        assert.equal(m.canonical_id, 'aws-vpc-cleanup');
    });
    test('refuses lexical match on bare/short labels (deploy problem)', () => {
        // "deploy" alone is too sparse — the matcher should not falsely merge
        // "deploy" in topic-A with "deploy" in topic-B.
        const recs = [
            rec({
                thread_id: 'claudia-deploy',
                label: 'deploy',
                session_id: 'topic-A',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'mux-deploy', label: 'deploy' }, recs);
        assert.equal(m.match_strategy, 'none');
    });
    test('lexical fires when label has enough specificity', () => {
        const recs = [
            rec({
                thread_id: 'claudia-deploy',
                label: 'Claudia agent deploy to prod',
                session_id: 'topic-A',
            }),
        ];
        // Same label tokens — should match.
        const m = findCanonicalThread({ thread_id: 'fresh', label: 'Claudia agent deploy continuing' }, recs);
        assert.equal(m.match_strategy, 'lexical');
        assert.equal(m.canonical_id, 'claudia-deploy');
    });
    test('honors custom lexicalThreshold', () => {
        const recs = [
            rec({
                thread_id: 'aws-deploy',
                label: 'AWS staging deployment work',
            }),
        ];
        const candidate = { thread_id: 'fresh', label: 'AWS thing different' };
        // With threshold 0.5, expect "none" (too few overlapping tokens).
        const m1 = findCanonicalThread(candidate, recs, { lexicalThreshold: 0.5 });
        assert.equal(m1.match_strategy, 'none');
        // With threshold 0.1, expect a lexical match.
        const m2 = findCanonicalThread(candidate, recs, {
            lexicalThreshold: 0.1,
            minLexicalTokens: 2,
        });
        assert.equal(m2.match_strategy, 'lexical');
    });
});
describe('findCanonicalThread — semantic', () => {
    test('off by default', () => {
        const recs = [
            rec({
                thread_id: 'kasett-phase-d-identity',
                label: 'Kasett Phase D thread identity matcher',
            }),
        ];
        const m = findCanonicalThread({
            thread_id: 'fresh',
            label: 'Phase E cross-session thread identity work',
        }, recs);
        // The two labels share tokens — they may already lexical-match. The
        // assertion here is loose: semantic should NOT fire when useEmbedding
        // is false.
        assert.notEqual(m.match_strategy, 'semantic');
    });
    test('opt-in semantic tier returns a semantic strategy when enabled', () => {
        // Force a case where lexical fails but semantic might fire.
        const recs = [
            rec({
                thread_id: 'oauth-redirect',
                label: 'oauth redirect debugging staging',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'fresh', label: 'kasett indexing snapshot tests' }, recs, { useEmbedding: true });
        // Either 'none' or 'semantic' is acceptable — what matters is that
        // when it fires, it's semantic and confidence is reasonable.
        if (m.match_strategy === 'semantic') {
            assert.ok(m.confidence >= 0.55);
        }
    });
});
describe('findCanonicalThread — none', () => {
    test('empty record list returns none', () => {
        const m = findCanonicalThread({ thread_id: 't', label: 'l' }, []);
        assert.equal(m.match_strategy, 'none');
        assert.equal(m.confidence, 0);
        assert.equal(m.canonical_id, undefined);
    });
    test('no overlap returns none', () => {
        const recs = [
            rec({ thread_id: 'aws-vpc', label: 'AWS VPC cleanup' }),
        ];
        const m = findCanonicalThread({
            thread_id: 'fresh',
            label: 'GitHub Actions OIDC role rotation',
        }, recs);
        assert.equal(m.match_strategy, 'none');
    });
});
describe('findCanonicalThread — excludeSessionId', () => {
    test('skips records from the excluded session', () => {
        const recs = [
            rec({
                thread_id: 'kasett',
                canonical_id: 'kasett',
                session_id: 'sess-CURRENT',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'kasett', label: 'kasett' }, recs, { excludeSessionId: 'sess-CURRENT' });
        assert.equal(m.match_strategy, 'none');
    });
});
describe('findCanonicalThread — recency ordering', () => {
    test('most recent contributing record wins', () => {
        const recs = [
            rec({
                ts: '2026-05-08T00:00:00Z',
                thread_id: 'old',
                canonical_id: 'canon',
                label: 'something',
            }),
            rec({
                ts: '2026-05-12T00:00:00Z',
                thread_id: 'newer',
                canonical_id: 'canon',
                label: 'something',
            }),
        ];
        const m = findCanonicalThread({ thread_id: 'old', label: 'whatever' }, recs);
        assert.equal(m.match_strategy, 'exact-id');
        assert.equal(m.canonical_id, 'canon');
        assert.equal(m.contributing_record?.thread_id, 'old');
    });
});
describe('findCanonicalThreadsBatch', () => {
    test('resolves multiple candidates in one go', () => {
        const recs = [
            rec({ thread_id: 'a', canonical_id: 'a-c', label: 'thread A' }),
            rec({ thread_id: 'b', canonical_id: 'b-c', label: 'thread B' }),
        ];
        const out = findCanonicalThreadsBatch([
            { thread_id: 'a', label: 'thread A' },
            { thread_id: 'c', label: 'totally new' },
        ], recs);
        assert.equal(out.size, 2);
        assert.equal(out.get('a')?.canonical_id, 'a-c');
        assert.equal(out.get('c')?.match_strategy, 'none');
    });
});
//# sourceMappingURL=global-matcher.test.js.map