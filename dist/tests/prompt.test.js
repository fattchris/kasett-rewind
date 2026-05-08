import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCustomInstructions, KasettError } from '../phase1/instructions.js';
import { generateConfig } from '../cli/generate-config.js';
import { DEFAULT_CONFIG } from '../types.js';
describe('generateCustomInstructions', () => {
    test('generates full instructions with default config', () => {
        const result = generateCustomInstructions(DEFAULT_CONFIG);
        assert.ok(result.includes('IMPORTANT'));
        assert.ok(result.includes('Main Thread'));
        assert.ok(result.includes('Active Sub-threads'));
        assert.ok(result.includes('Thread History'));
        assert.ok(result.includes('Key State'));
        assert.ok(result.includes('Unresolved'));
        assert.ok(result.includes('Summary'));
        assert.ok(result.includes('RULES:'));
        assert.ok(result.includes('Threads CANNOT silently disappear'));
    });
    test('generates minimal instructions when thread tracking off and window=1', () => {
        const config = {
            windowSize: 1,
            windowBudgetSplit: [0.6, 0.4],
            threadTracking: false,
        };
        const result = generateCustomInstructions(config);
        assert.ok(!result.includes('Main Thread'));
        assert.ok(!result.includes('Active Sub-threads'));
        assert.ok(!result.includes('Thread History'));
        assert.ok(result.includes('Key State'));
        assert.ok(result.includes('Summary'));
    });
    test('includes thread tracking rules when enabled', () => {
        const config = {
            windowSize: 2,
            windowBudgetSplit: [0.3, 0.3, 0.4],
            threadTracking: true,
        };
        const result = generateCustomInstructions(config);
        assert.ok(result.includes('silently disappear'));
        assert.ok(result.includes('Main Thread'));
        assert.ok(result.includes('Active Sub-threads'));
    });
    test('excludes thread sections when tracking disabled (but window > 1)', () => {
        const config = {
            windowSize: 2,
            windowBudgetSplit: [0.3, 0.3, 0.4],
            threadTracking: false,
        };
        const result = generateCustomInstructions(config);
        // Should NOT include thread-specific sections
        assert.ok(!result.includes('Main Thread'));
        assert.ok(!result.includes('Active Sub-threads'));
        assert.ok(!result.includes('Thread History'));
        // But should still include general structure
        assert.ok(result.includes('Key State'));
        assert.ok(result.includes('Unresolved'));
        assert.ok(result.includes('Summary'));
    });
    test('mentions rolling window when windowSize > 1', () => {
        const config = {
            windowSize: 3,
            windowBudgetSplit: [0.2, 0.2, 0.2, 0.4],
            threadTracking: true,
        };
        const result = generateCustomInstructions(config);
        assert.ok(result.includes('rolling window of 3'));
    });
    test('does not mention rolling window when windowSize = 1', () => {
        const config = {
            windowSize: 1,
            windowBudgetSplit: [0.6, 0.4],
            threadTracking: true,
        };
        const result = generateCustomInstructions(config);
        assert.ok(!result.includes('rolling window'));
    });
});
describe('generateConfig', () => {
    test('generates config with defaults', () => {
        const result = generateConfig({});
        assert.ok(result.includes('✓ Generated'));
        assert.ok(result.includes('"customInstructions"'));
        assert.ok(result.includes('"maxHistoryShare"'));
        assert.ok(result.includes('"kasett-rewind"'));
        assert.ok(result.includes('"windowSize": 2'));
        assert.ok(result.includes('"threadTracking": true'));
    });
    test('generates config with custom window size', () => {
        const result = generateConfig({ windowSize: 3 });
        assert.ok(result.includes('"windowSize": 3'));
    });
    test('generates config with thread tracking disabled', () => {
        const result = generateConfig({ threadTracking: false });
        assert.ok(result.includes('"threadTracking": false'));
    });
    test('generates config with custom budget split', () => {
        const result = generateConfig({
            windowSize: 2,
            budgetSplit: [0.25, 0.25, 0.5],
        });
        assert.ok(result.includes('0.25'));
        assert.ok(result.includes('0.5'));
    });
    test('throws on invalid window size (too high)', () => {
        assert.throws(() => generateConfig({ windowSize: 10 }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.equal(err.code, 'INVALID_CONFIG');
            return true;
        });
    });
    test('throws on invalid window size (zero)', () => {
        assert.throws(() => generateConfig({ windowSize: 0 }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.equal(err.code, 'INVALID_CONFIG');
            return true;
        });
    });
    test('throws on budget split length mismatch', () => {
        assert.throws(() => generateConfig({ windowSize: 2, budgetSplit: [0.5, 0.5] }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.ok(err.message.includes('length'));
            return true;
        });
    });
    test('throws on budget split not summing to 1.0', () => {
        assert.throws(() => generateConfig({ windowSize: 2, budgetSplit: [0.3, 0.3, 0.3] }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.ok(err.message.includes('sum to 1.0'));
            return true;
        });
    });
    test('computes correct maxHistoryShare', () => {
        const result = generateConfig({
            windowSize: 2,
            budgetSplit: [0.3, 0.3, 0.4],
        });
        assert.ok(result.includes('"maxHistoryShare": 0.6'));
    });
    test('auto-generates budget split for non-default window sizes', () => {
        const result = generateConfig({ windowSize: 4 });
        // Should contain a valid split (4 summaries + recent turns = 5 elements)
        assert.ok(result.includes('"windowBudgetSplit"'));
        assert.ok(result.includes('"windowSize": 4'));
    });
});
//# sourceMappingURL=prompt.test.js.map