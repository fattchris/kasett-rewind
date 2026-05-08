import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateConfig } from '../cli/generate-config.js';
import { KasettError } from '../storage/reader.js';
describe('generateConfig', () => {
    test('generates config with defaults', () => {
        const result = generateConfig({});
        assert.ok(result.includes('✓ Generated'));
        assert.ok(result.includes('"kasett-rewind"'));
        // Nested structure: compaction group
        assert.ok(result.includes('"compaction"'));
        assert.ok(result.includes('"windowSize": 3'));
        // Nested structure: steering group
        assert.ok(result.includes('"steering"'));
        assert.ok(result.includes('"threadTracking": true'));
        assert.ok(result.includes('1'));
        assert.ok(result.includes('0.6'));
        assert.ok(result.includes('0.3'));
    });
    test('generates config with custom window size', () => {
        const result = generateConfig({ windowSize: 4 });
        assert.ok(result.includes('"windowSize": 4'));
        // Should auto-generate 4 weights
        assert.ok(result.includes('"weights"'));
    });
    test('generates config with thread tracking disabled', () => {
        const result = generateConfig({ threadTracking: false });
        assert.ok(result.includes('"threadTracking": false'));
    });
    test('generates config with custom weights', () => {
        const result = generateConfig({
            windowSize: 3,
            weights: [1.0, 0.8, 0.5],
        });
        assert.ok(result.includes('0.8'));
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
    test('throws on weights length mismatch', () => {
        assert.throws(() => generateConfig({ windowSize: 3, weights: [1.0, 0.6] }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.ok(err.message.includes('length'));
            return true;
        });
    });
    test('throws on weight value out of range', () => {
        assert.throws(() => generateConfig({ windowSize: 3, weights: [1.5, 0.6, 0.3] }), (err) => {
            assert.ok(err instanceof KasettError);
            assert.ok(err.message.includes('between 0 and 1'));
            return true;
        });
    });
    test('auto-generates decay weights for non-default window sizes', () => {
        const result = generateConfig({ windowSize: 5 });
        assert.ok(result.includes('"windowSize": 5'));
        assert.ok(result.includes('"weights"'));
        // First weight should be 1.0
        assert.ok(result.includes('1'));
    });
    test('summary line shows correct values', () => {
        const result = generateConfig({
            windowSize: 2,
            weights: [1.0, 0.5],
            threadTracking: true,
        });
        assert.ok(result.includes('Window size: 2'));
        assert.ok(result.includes('Thread tracking: ON'));
        assert.ok(result.includes('Weights: [1, 0.5]'));
    });
});
//# sourceMappingURL=config.test.js.map