/**
 * Lenient-truncate behavior for V2/V3 validators.
 *
 * Established 2026-05-12 after Phase 2 benchmark surfaced a production bug:
 * `validateThreadMetaV3` was rejecting entire LLM outputs when the Sonnet
 * 4.5 LLM correctly identified 6-10 concurrent threads on complex sessions
 * and emitted a `sub[]` array longer than the schema cap of 5. The
 * structured payload was lost and the agent fell back to prose-only.
 *
 * The fix:
 *   - `validateThreadMetaV3` defaults to LENIENT \u2014 oversized arrays are
 *     truncated to cap, and a `_truncated_<field>: true` flag is set so
 *     downstream code can log/alert without losing the structured content.
 *   - `validateThreadMetaV3Strict` preserves the prior strict behavior for
 *     callers that want to know about overflow loudly.
 *   - `validateThreadMetaV2` defaults to STRICT (backward compat with the
 *     existing schema.test.ts suite). `validateThreadMetaV2Lenient` and
 *     `validateThreadMetaV2(raw, { mode: 'lenient' })` opt into truncation.
 *
 * Type errors (wrong type, missing required, invalid status enum) remain
 * hard failures in BOTH modes \u2014 lenient is about caps, not safety.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateThreadMetaV2, validateThreadMetaV2Strict, validateThreadMetaV2Lenient, validateThreadMetaV3, validateThreadMetaV3Strict, validateThreadMetaV3Lenient, } from '../threads/schema.js';
// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
function sub(id) {
    return { id, label: `${id}-label`, status: 'active' };
}
function ks(value) {
    return { kind: 'value', value };
}
// ---------------------------------------------------------------------------
// V2: lenient sub[] overflow
// ---------------------------------------------------------------------------
describe('validateThreadMetaV2 \u2014 lenient sub[] overflow', () => {
    test('6 sub items \u2192 5 kept, _truncated_sub flag set', () => {
        const subs = Array.from({ length: 6 }, (_, i) => sub(`s${i}`));
        const result = validateThreadMetaV2Lenient({ main: 'work', sub: subs });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value._truncated_sub, true);
        // First 5 preserved in order
        assert.equal(result.value.sub[0].id, 's0');
        assert.equal(result.value.sub[4].id, 's4');
    });
    test('10 sub items \u2192 5 kept, flag set', () => {
        const subs = Array.from({ length: 10 }, (_, i) => sub(`s${i}`));
        const result = validateThreadMetaV2({ main: 'work', sub: subs }, { mode: 'lenient' });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value._truncated_sub, true);
    });
    test('exactly 5 sub items \u2192 no truncation flag', () => {
        const subs = Array.from({ length: 5 }, (_, i) => sub(`s${i}`));
        const result = validateThreadMetaV2Lenient({ main: 'work', sub: subs });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value._truncated_sub, undefined);
    });
    test('strict mode (default) still rejects 6 sub items', () => {
        const subs = Array.from({ length: 6 }, (_, i) => sub(`s${i}`));
        const strict = validateThreadMetaV2({ main: 'work', sub: subs });
        assert.equal(strict.ok, false);
        if (strict.ok)
            return;
        assert.ok(strict.errors.some((e) => e.includes('at most 5')));
    });
    test('explicit Strict alias matches default behavior', () => {
        const subs = Array.from({ length: 6 }, (_, i) => sub(`s${i}`));
        const strict = validateThreadMetaV2Strict({ main: 'work', sub: subs });
        assert.equal(strict.ok, false);
    });
});
describe('validateThreadMetaV2 \u2014 lenient decisions / open_questions', () => {
    test('lenient: 8 decisions \u2192 5 kept, flag set', () => {
        const result = validateThreadMetaV2Lenient({
            main: 'm',
            sub: [],
            decisions: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.decisions?.length, 5);
        assert.equal(result.value._truncated_decisions, true);
    });
    test('lenient: 7 open_questions \u2192 5 kept, flag set', () => {
        const result = validateThreadMetaV2Lenient({
            main: 'm',
            sub: [],
            open_questions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.open_questions?.length, 5);
        assert.equal(result.value._truncated_open_questions, true);
    });
    test('strict (default) still rejects 6 decisions', () => {
        const result = validateThreadMetaV2({
            main: 'm',
            sub: [],
            decisions: ['a', 'b', 'c', 'd', 'e', 'f'],
        });
        assert.equal(result.ok, false);
    });
    test('lenient: type errors STILL hard-fail (decisions has number)', () => {
        const result = validateThreadMetaV2Lenient({
            main: 'm',
            sub: [],
            decisions: ['valid', 42],
        });
        // Type error => hard fail even in lenient mode
        assert.equal(result.ok, false);
    });
    test('lenient: missing main STILL hard-fails', () => {
        const result = validateThreadMetaV2Lenient({ sub: [] });
        assert.equal(result.ok, false);
    });
    test('lenient: invalid status enum STILL hard-fails', () => {
        const result = validateThreadMetaV2Lenient({
            main: 'm',
            sub: [{ id: 'a', label: 'b', status: 'in-progress' }],
        });
        assert.equal(result.ok, false);
    });
    test('lenient: multiple overflows can stack flags independently', () => {
        const result = validateThreadMetaV2Lenient({
            main: 'm',
            sub: Array.from({ length: 7 }, (_, i) => sub(`s${i}`)),
            decisions: Array.from({ length: 8 }, (_, i) => `d${i}`),
            open_questions: Array.from({ length: 6 }, (_, i) => `q${i}`),
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value._truncated_sub, true);
        assert.equal(result.value._truncated_decisions, true);
        assert.equal(result.value._truncated_open_questions, true);
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value.decisions?.length, 5);
        assert.equal(result.value.open_questions?.length, 5);
    });
});
// ---------------------------------------------------------------------------
// V3: lenient default, plus key_state truncation
// ---------------------------------------------------------------------------
describe('validateThreadMetaV3 \u2014 lenient by default', () => {
    test('default: 8 sub items \u2192 5 kept, flag set (no { mode } needed)', () => {
        const subs = Array.from({ length: 8 }, (_, i) => sub(`s${i}`));
        const result = validateThreadMetaV3({ main: 'work', sub: subs });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value._truncated_sub, true);
    });
    test('default: 25 key_state items \u2192 20 kept, _truncated_key_state flag', () => {
        const ksList = Array.from({ length: 25 }, (_, i) => ks(`v${i}`));
        const result = validateThreadMetaV3({
            main: 'work',
            sub: [],
            key_state: ksList,
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.key_state?.length, 20);
        assert.equal(result.value._truncated_key_state, true);
        // First 20 preserved in order
        assert.equal(result.value.key_state?.[0].value, 'v0');
        assert.equal(result.value.key_state?.[19].value, 'v19');
    });
    test('default: exactly 20 key_state items \u2192 no flag', () => {
        const ksList = Array.from({ length: 20 }, (_, i) => ks(`v${i}`));
        const result = validateThreadMetaV3({
            main: 'work',
            sub: [],
            key_state: ksList,
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.key_state?.length, 20);
        assert.equal(result.value._truncated_key_state, undefined);
    });
    test('default: combined sub + key_state overflow \u2014 both flags set', () => {
        const result = validateThreadMetaV3({
            main: 'complex session',
            sub: Array.from({ length: 9 }, (_, i) => sub(`s${i}`)),
            key_state: Array.from({ length: 30 }, (_, i) => ks(`v${i}`)),
            decisions: Array.from({ length: 7 }, (_, i) => `d${i}`),
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value.key_state?.length, 20);
        assert.equal(result.value.decisions?.length, 5);
        assert.equal(result.value._truncated_sub, true);
        assert.equal(result.value._truncated_key_state, true);
        assert.equal(result.value._truncated_decisions, true);
    });
    test('default: key_state with mixed valid+invalid entries \u2014 invalid dropped, no truncation flag if total valid <= 20', () => {
        const ksList = [
            ks('v0'),
            { kind: 'invalid-kind', value: 'x' }, // dropped
            ks('v1'),
            { value: 'no-kind' }, // dropped
            ks('v2'),
        ];
        const result = validateThreadMetaV3({
            main: 'm',
            sub: [],
            key_state: ksList,
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.key_state?.length, 3);
        assert.equal(result.value._truncated_key_state, undefined);
    });
    test('default: valid count 22 (>20) sets _truncated_key_state flag, invalid count irrelevant', () => {
        const ksList = [
            ...Array.from({ length: 22 }, (_, i) => ks(`v${i}`)),
            { kind: 'bad', value: 'x' }, // invalid \u2014 doesn't count toward truncation
        ];
        const result = validateThreadMetaV3({
            main: 'm',
            sub: [],
            key_state: ksList,
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.key_state?.length, 20);
        assert.equal(result.value._truncated_key_state, true);
    });
    test('strict: V3 with 6 subs \u2192 hard-rejects', () => {
        const subs = Array.from({ length: 6 }, (_, i) => sub(`s${i}`));
        const result = validateThreadMetaV3Strict({ main: 'work', sub: subs });
        assert.equal(result.ok, false);
    });
    test('strict: V3 with 21 key_state \u2192 hard-rejects', () => {
        const ksList = Array.from({ length: 21 }, (_, i) => ks(`v${i}`));
        const result = validateThreadMetaV3Strict({
            main: 'work',
            sub: [],
            key_state: ksList,
        });
        assert.equal(result.ok, false);
        if (result.ok)
            return;
        assert.ok(result.errors.some((e) => e.includes('key_state')));
    });
    test('explicit Lenient alias matches default V3 behavior', () => {
        const subs = Array.from({ length: 7 }, (_, i) => sub(`s${i}`));
        const r1 = validateThreadMetaV3({ main: 'work', sub: subs });
        const r2 = validateThreadMetaV3Lenient({ main: 'work', sub: subs });
        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        if (!r1.ok || !r2.ok)
            return;
        assert.equal(r1.value.sub.length, r2.value.sub.length);
        assert.equal(r1.value._truncated_sub, r2.value._truncated_sub);
    });
    test('lenient: empty key_state array \u2192 no key_state field, no flag', () => {
        const result = validateThreadMetaV3({
            main: 'm',
            sub: [],
            key_state: [],
        });
        assert.equal(result.ok, true);
        if (!result.ok)
            return;
        assert.equal(result.value.key_state, undefined);
        assert.equal(result.value._truncated_key_state, undefined);
    });
});
// ---------------------------------------------------------------------------
// Realistic Tier-4 LLM-shaped payload (the bug we shipped to fix)
// ---------------------------------------------------------------------------
describe('Tier-4 realistic LLM payload (regression for the production bug)', () => {
    test('LLM emits 8 subs + 25 key_state on a complex session \u2014 lenient V3 keeps the structured content', () => {
        // Shape modeled after session-11 fallback in
        // research/phase2-results/compliance-report.md
        const llmOutput = {
            main: 'multi-thread infra debug session',
            sub: [
                { id: 'oauth-redirect', label: 'OAuth redirect URI', status: 'active' },
                { id: 'cdk-prod', label: 'CDK prod mirror', status: 'blocked' },
                { id: 'efs-mount', label: 'EFS mount target', status: 'active' },
                { id: 'agent-fleet', label: 'Agent fleet rebalance', status: 'active' },
                { id: 'dns-cleanup', label: 'DNS cleanup', status: 'completed' },
                { id: 'sg-audit', label: 'SG audit', status: 'fading' },
                { id: 'iam-policy', label: 'IAM policy refactor', status: 'active' },
                { id: 'vault-pull', label: 'Vault pull model', status: 'blocked' },
            ],
            key_state: Array.from({ length: 25 }, (_, i) => ({
                kind: 'value',
                value: `value-${i}`,
                label: `label ${i}`,
            })),
            decisions: ['Pin to ALB', 'Use clyde-sudo for delete'],
            open_questions: ['Does this affect SSO?'],
        };
        // BEFORE the fix: validateThreadMetaV3 would have returned ok=false and
        // the worker/parser would have lost ALL structured output.
        const result = validateThreadMetaV3(llmOutput);
        assert.equal(result.ok, true, 'lenient V3 must not reject overflow');
        if (!result.ok)
            return;
        assert.equal(result.value.sub.length, 5);
        assert.equal(result.value.key_state?.length, 20);
        assert.equal(result.value._truncated_sub, true);
        assert.equal(result.value._truncated_key_state, true);
        // First 5 sub IDs preserved in LLM-emitted order
        assert.deepEqual(result.value.sub.map((s) => s.id), ['oauth-redirect', 'cdk-prod', 'efs-mount', 'agent-fleet', 'dns-cleanup']);
    });
});
//# sourceMappingURL=schema-truncate.test.js.map