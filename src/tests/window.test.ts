import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CompactionWindow } from '../compaction/window.js';
import type { CompactionSummary, ThreadSnapshot } from '../types.js';

function makeSummary(overrides: Partial<CompactionSummary> = {}): CompactionSummary {
  return {
    summary: 'Test summary content',
    windowIndex: 0,
    windowTotal: 2,
    threadSnapshot: makeThreadSnapshot(),
    timestamp: new Date().toISOString(),
    tokenCount: 100,
    ...overrides,
  };
}

function makeThreadSnapshot(): ThreadSnapshot {
  return {
    mainThread: 'Test main thread',
    subThreads: [],
    keyState: {},
    unresolved: [],
    threadHistory: [],
  };
}

describe('CompactionWindow', () => {
  describe('constructor', () => {
    test('creates empty window with configured size', () => {
      const window = new CompactionWindow({ windowSize: 3 });
      assert.equal(window.size, 0);
      assert.deepEqual(window.getAll(), []);
    });
  });

  describe('push', () => {
    test('adds summary to empty window', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      const summary = makeSummary();
      const dropped = window.push(summary);

      assert.equal(dropped, undefined);
      assert.equal(window.size, 1);
      assert.equal(window.getAll()[0].windowIndex, 0);
      assert.equal(window.getAll()[0].windowTotal, 2);
    });

    test('adds multiple summaries within window size', () => {
      const window = new CompactionWindow({ windowSize: 3 });
      window.push(makeSummary({ summary: 'first' }));
      window.push(makeSummary({ summary: 'second' }));

      assert.equal(window.size, 2);
      assert.equal(window.getAll()[0].summary, 'first');
      assert.equal(window.getAll()[1].summary, 'second');
      assert.equal(window.getAll()[0].windowIndex, 0);
      assert.equal(window.getAll()[1].windowIndex, 1);
    });

    test('drops oldest when window is full', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      window.push(makeSummary({ summary: 'first' }));
      window.push(makeSummary({ summary: 'second' }));
      const dropped = window.push(makeSummary({ summary: 'third' }));

      assert.equal(window.size, 2);
      assert.equal(dropped?.summary, 'first');
      assert.equal(window.getAll()[0].summary, 'second');
      assert.equal(window.getAll()[1].summary, 'third');
    });

    test('re-indexes all summaries after push', () => {
      const window = new CompactionWindow({ windowSize: 3 });
      window.push(makeSummary({ summary: 'a' }));
      window.push(makeSummary({ summary: 'b' }));
      window.push(makeSummary({ summary: 'c' }));

      const all = window.getAll();
      assert.equal(all[0].windowIndex, 0);
      assert.equal(all[1].windowIndex, 1);
      assert.equal(all[2].windowIndex, 2);
      assert.equal(all[0].windowTotal, 3);
      assert.equal(all[1].windowTotal, 3);
      assert.equal(all[2].windowTotal, 3);
    });

    test('window size 1 always drops oldest', () => {
      const window = new CompactionWindow({ windowSize: 1 });
      window.push(makeSummary({ summary: 'first' }));
      const dropped = window.push(makeSummary({ summary: 'second' }));

      assert.equal(window.size, 1);
      assert.equal(dropped?.summary, 'first');
      assert.equal(window.getAll()[0].summary, 'second');
    });
  });

  describe('load', () => {
    test('loads summaries and trims to window size', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      const summaries = [
        makeSummary({ summary: 'old' }),
        makeSummary({ summary: 'middle' }),
        makeSummary({ summary: 'recent' }),
      ];

      window.load(summaries);
      assert.equal(window.size, 2);
      assert.equal(window.getAll()[0].summary, 'middle');
      assert.equal(window.getAll()[1].summary, 'recent');
    });

    test('loads fewer summaries than window size', () => {
      const window = new CompactionWindow({ windowSize: 5 });
      const summaries = [makeSummary({ summary: 'only one' })];

      window.load(summaries);
      assert.equal(window.size, 1);
      assert.equal(window.getAll()[0].summary, 'only one');
    });

    test('loads empty array', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      window.load([]);
      assert.equal(window.size, 0);
    });
  });

  describe('getLatest', () => {
    test('returns undefined for empty window', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      assert.equal(window.getLatest(), undefined);
    });

    test('returns most recent summary', () => {
      const window = new CompactionWindow({ windowSize: 3 });
      window.push(makeSummary({ summary: 'old' }));
      window.push(makeSummary({ summary: 'new' }));

      assert.equal(window.getLatest()?.summary, 'new');
    });
  });

  describe('computeBudgets', () => {
    test('computes budgets with default split', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      const result = window.computeBudgets(10000, [0.3, 0.3, 0.4]);

      assert.equal(result.summaryBudgets.length, 2);
      assert.equal(result.summaryBudgets[0], 3000);
      assert.equal(result.summaryBudgets[1], 3000);
      assert.equal(result.recentTurnsBudget, 4000);
    });

    test('computes budgets with asymmetric split', () => {
      const window = new CompactionWindow({ windowSize: 3 });
      const result = window.computeBudgets(10000, [0.2, 0.2, 0.2, 0.4]);

      assert.equal(result.summaryBudgets.length, 3);
      assert.equal(result.summaryBudgets[0], 2000);
      assert.equal(result.summaryBudgets[1], 2000);
      assert.equal(result.summaryBudgets[2], 2000);
      assert.equal(result.recentTurnsBudget, 4000);
    });

    test('handles small budgets with floor rounding', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      const result = window.computeBudgets(100, [0.3, 0.3, 0.4]);

      assert.equal(result.summaryBudgets[0], 30);
      assert.equal(result.summaryBudgets[1], 30);
      assert.equal(result.recentTurnsBudget, 40);
    });

    test('window size 1 gives single summary budget', () => {
      const window = new CompactionWindow({ windowSize: 1 });
      const result = window.computeBudgets(10000, [0.6, 0.4]);

      assert.equal(result.summaryBudgets.length, 1);
      assert.equal(result.summaryBudgets[0], 6000);
      assert.equal(result.recentTurnsBudget, 4000);
    });
  });

  describe('serialize', () => {
    test('returns copies of summaries', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      window.push(makeSummary({ summary: 'test' }));

      const serialized = window.serialize();
      assert.equal(serialized.length, 1);
      assert.equal(serialized[0].summary, 'test');

      // Verify it's a copy (not a reference)
      serialized[0].summary = 'modified';
      assert.equal(window.getAll()[0].summary, 'test');
    });
  });

  describe('getAll', () => {
    test('returns copy of summaries array', () => {
      const window = new CompactionWindow({ windowSize: 2 });
      window.push(makeSummary({ summary: 'test' }));

      const all = window.getAll();
      all.push(makeSummary({ summary: 'injected' }));

      assert.equal(window.size, 1);
    });
  });
});
