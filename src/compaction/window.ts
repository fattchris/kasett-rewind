import type { CompactionSummary, KasettConfig } from '../types.js';

/**
 * Manages the rolling window of compaction summaries.
 * Handles storage, retrieval, and rotation of N summaries.
 */
export class CompactionWindow {
  private summaries: CompactionSummary[] = [];
  private readonly windowSize: number;

  constructor(config: Pick<KasettConfig, 'windowSize'>) {
    this.windowSize = config.windowSize;
  }

  /** Load existing summaries (called on init from session JSONL) */
  load(summaries: CompactionSummary[]): void {
    // Keep only the most recent windowSize summaries
    this.summaries = summaries.slice(-this.windowSize);
  }

  /** Get all summaries in the window (oldest first) */
  getAll(): CompactionSummary[] {
    return [...this.summaries];
  }

  /** Get the most recent summary */
  getLatest(): CompactionSummary | undefined {
    return this.summaries[this.summaries.length - 1];
  }

  /**
   * Push a new summary into the window.
   * If window is full, the oldest summary is dropped (rolled off).
   * Returns the dropped summary (if any) for archival/ALLM extraction.
   */
  push(summary: CompactionSummary): CompactionSummary | undefined {
    let dropped: CompactionSummary | undefined;

    if (this.summaries.length >= this.windowSize) {
      dropped = this.summaries.shift();
    }

    // Update window indices
    summary.windowIndex = this.summaries.length;
    summary.windowTotal = this.windowSize;
    this.summaries.push(summary);

    // Re-index all
    this.summaries.forEach((s, i) => {
      s.windowIndex = i;
      s.windowTotal = this.windowSize;
    });

    return dropped;
  }

  /** Compute token budgets for each slot based on split config */
  computeBudgets(
    totalBudget: number,
    budgetSplit: number[],
  ): { summaryBudgets: number[]; recentTurnsBudget: number } {
    // budgetSplit length should be windowSize + 1
    // Last element is for recent turns
    const recentTurnsBudget = Math.floor(
      totalBudget * budgetSplit[budgetSplit.length - 1],
    );

    const summaryBudgets = budgetSplit
      .slice(0, -1)
      .map((split) => Math.floor(totalBudget * split));

    return { summaryBudgets, recentTurnsBudget };
  }

  /** Get current window size (actual, not max) */
  get size(): number {
    return this.summaries.length;
  }

  /** Serialize for session JSONL storage */
  serialize(): CompactionSummary[] {
    return this.summaries.map((s) => ({ ...s }));
  }
}
