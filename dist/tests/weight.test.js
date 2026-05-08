import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { weightSummaries } from '../threads/weight.js';
describe('weightSummaries', () => {
    test('returns empty array for no summaries', () => {
        const result = weightSummaries([], [1.0, 0.6, 0.3]);
        assert.deepEqual(result, []);
    });
    test('pairs each summary with its decay weight, most recent first', () => {
        const summaries = [
            'Most recent summary with [THREAD_META]',
            'Earlier summary',
            'Oldest summary',
        ];
        const result = weightSummaries(summaries, [1.0, 0.6, 0.3]);
        assert.equal(result.length, 3);
        assert.equal(result[0].summary, 'Most recent summary with [THREAD_META]');
        assert.equal(result[0].weight, 1.0);
        assert.equal(result[1].summary, 'Earlier summary');
        assert.equal(result[1].weight, 0.6);
        assert.equal(result[2].summary, 'Oldest summary');
        assert.equal(result[2].weight, 0.3);
    });
    test('label for most recent includes "most recent" marker', () => {
        const result = weightSummaries(['summary A'], [1.0]);
        assert.ok(result[0].label.includes('most recent'));
        assert.ok(result[0].label.includes('1'));
    });
    test('label for older summaries does not say most recent', () => {
        const result = weightSummaries(['A', 'B'], [1.0, 0.6]);
        assert.ok(!result[1].label.includes('most recent'));
    });
    test('truncates to weights length when more summaries than weights', () => {
        const summaries = ['A', 'B', 'C', 'D'];
        const result = weightSummaries(summaries, [1.0, 0.6]);
        // Only 2 weights → only 2 summaries returned
        assert.equal(result.length, 2);
        assert.equal(result[0].summary, 'A');
        assert.equal(result[1].summary, 'B');
    });
    test('handles fewer summaries than weights gracefully', () => {
        const summaries = ['only one'];
        const result = weightSummaries(summaries, [1.0, 0.6, 0.3]);
        assert.equal(result.length, 1);
        assert.equal(result[0].weight, 1.0);
    });
    test('weight values are preserved exactly', () => {
        const result = weightSummaries(['X', 'Y', 'Z'], [1.0, 0.6, 0.3]);
        assert.equal(result[0].weight, 1.0);
        assert.equal(result[1].weight, 0.6);
        assert.equal(result[2].weight, 0.3);
    });
});
//# sourceMappingURL=weight.test.js.map