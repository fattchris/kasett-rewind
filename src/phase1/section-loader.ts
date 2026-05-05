import type { CompactionSummary, KasettConfig } from '../types.js';
import { SessionReader } from '../storage/reader.js';
import { KasettError } from './instructions.js';

/**
 * Result of loading sections for post-compaction context injection.
 */
export interface LoadedSections {
  /** Formatted text block ready for context injection */
  readonly content: string;
  /** Number of summaries included */
  readonly summaryCount: number;
  /** Whether any summaries were truncated */
  readonly wasTruncated: boolean;
}

/**
 * Provides post-compaction sections for OC context injection.
 * Reads previous compaction summaries from the session JSONL and
 * formats them for re-injection into the agent's context.
 *
 * Respects windowSize and budget split to control how much
 * historical context is loaded.
 */
export class SectionLoader {
  private readonly config: KasettConfig;
  private readonly reader: SessionReader;

  constructor(config: KasettConfig) {
    this.config = config;
    this.reader = new SessionReader();
  }

  /**
   * Load previous compaction summaries and format them for injection.
   * The current (most recent) summary is NOT included — OC handles
   * that via its normal path. This loads N-1 older summaries.
   *
   * @param sessionFilePath - Path to the session .jsonl file
   * @param budgetChars - Maximum character budget for the output
   * @returns Formatted sections ready for injection
   */
  async loadSections(
    sessionFilePath: string,
    budgetChars: number,
  ): Promise<LoadedSections> {
    if (this.config.windowSize <= 1) {
      // No previous summaries to load in single-window mode
      return { content: '', summaryCount: 0, wasTruncated: false };
    }

    const summaries = await this.reader.readLastN(
      sessionFilePath,
      this.config.windowSize,
    );

    if (summaries.length <= 1) {
      // Only have 0-1 summaries, nothing to inject (OC handles current)
      return { content: '', summaryCount: 0, wasTruncated: false };
    }

    // Exclude the most recent summary (OC already loads it)
    const previousSummaries = summaries.slice(0, -1);

    // Compute per-summary character budgets from windowBudgetSplit
    const perSummaryBudgets = this.computePerSummaryBudgets(
      budgetChars,
      previousSummaries.length,
    );

    // Format with truncation
    const { content, wasTruncated } = this.formatSummaries(
      previousSummaries,
      perSummaryBudgets,
    );

    return {
      content,
      summaryCount: previousSummaries.length,
      wasTruncated,
    };
  }

  /**
   * Compute character budgets for each previous summary slot.
   * Uses the windowBudgetSplit proportions for summary slots only
   * (excludes the last element which is for recent turns).
   */
  private computePerSummaryBudgets(
    totalBudget: number,
    summaryCount: number,
  ): readonly number[] {
    const split = this.config.windowBudgetSplit;
    // Summary slots are all but the last element (recent turns)
    const summarySlots = split.slice(0, -1);

    if (summaryCount >= summarySlots.length) {
      // Distribute evenly if we have more summaries than slots
      const perSlot = Math.floor(totalBudget / summaryCount);
      return Array.from({ length: summaryCount }, () => perSlot);
    }

    // Use the configured split for available slots (oldest first)
    const budgets: number[] = [];
    const usedSlots = summarySlots.slice(0, summaryCount);
    const slotSum = usedSlots.reduce((a, b) => a + b, 0);

    for (const slot of usedSlots) {
      budgets.push(Math.floor(totalBudget * (slot / slotSum)));
    }

    return budgets;
  }

  /**
   * Format summaries for context injection with budget-aware truncation.
   *
   * Truncation priority (what gets cut first):
   * 1. Thread snapshot / thread history (least critical for older summaries)
   * 2. Narrative summary text (truncated from the end)
   * 3. Key state (survives longest — most valuable for recall)
   */
  private formatSummaries(
    summaries: readonly CompactionSummary[],
    budgets: readonly number[],
  ): { content: string; wasTruncated: boolean } {
    const parts: string[] = [];
    let anyTruncated = false;

    parts.push('<!-- kasett-rewind: previous compaction window -->');

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      const budget = budgets[i] ?? 500;
      const label = summaries.length === 1
        ? 'Previous Compaction'
        : `Previous Compaction ${i + 1}/${summaries.length}`;

      const { text, truncated } = this.formatOneSummary(summary, budget, label);
      parts.push(text);
      if (truncated) anyTruncated = true;
    }

    parts.push('<!-- /kasett-rewind -->');

    return { content: parts.join('\n\n'), wasTruncated: anyTruncated };
  }

  /**
   * Format a single summary within its character budget.
   * Applies truncation in priority order.
   */
  private formatOneSummary(
    summary: CompactionSummary,
    budget: number,
    label: string,
  ): { text: string; truncated: boolean } {
    const ts = summary.threadSnapshot;
    const header = `## ${label} (${summary.timestamp})`;

    // Build sections from most expendable to most valuable
    // We'll try the full version first, then truncate

    const fullText = this.buildFullSummaryText(summary, header);

    if (fullText.length <= budget) {
      return { text: fullText, truncated: false };
    }

    // Need to truncate. Priority: keep key state, truncate narrative
    return { text: this.buildTruncatedSummaryText(summary, header, budget), truncated: true };
  }

  /**
   * Build the full untruncated summary text.
   */
  private buildFullSummaryText(summary: CompactionSummary, header: string): string {
    const ts = summary.threadSnapshot;
    const sections: string[] = [header];

    // Thread info (if present)
    if (ts.mainThread && ts.mainThread !== 'Unknown') {
      sections.push(`**Main:** ${ts.mainThread}`);
    }

    if (ts.subThreads.length > 0) {
      const threads = ts.subThreads
        .map((t) => `- ${t.name} [${t.status}]${t.detail ? ` — ${t.detail}` : ''}`)
        .join('\n');
      sections.push(threads);
    }

    if (ts.threadHistory.length > 0) {
      const history = ts.threadHistory
        .map((h) => `- ~${h.thread}~ [${h.status}]`)
        .join('\n');
      sections.push(`**History:** ${history}`);
    }

    // Key state (high value)
    if (Object.keys(ts.keyState).length > 0) {
      const state = Object.entries(ts.keyState)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      sections.push(`**Key State:**\n${state}`);
    }

    // Unresolved
    if (ts.unresolved.length > 0) {
      const items = ts.unresolved.map((u) => `- ${u}`).join('\n');
      sections.push(`**Unresolved:**\n${items}`);
    }

    // Narrative
    sections.push(`**Summary:** ${summary.summary}`);

    return sections.join('\n');
  }

  /**
   * Build a truncated summary text that fits within budget.
   * Truncation order:
   * 1. Remove thread history
   * 2. Truncate narrative from end
   * 3. Last resort: trim key state values
   */
  private buildTruncatedSummaryText(
    summary: CompactionSummary,
    header: string,
    budget: number,
  ): string {
    const ts = summary.threadSnapshot;
    const sections: string[] = [header];

    // Always include key state (highest priority)
    if (Object.keys(ts.keyState).length > 0) {
      const state = Object.entries(ts.keyState)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      sections.push(`**Key State:**\n${state}`);
    }

    // Include unresolved (high priority)
    if (ts.unresolved.length > 0) {
      const items = ts.unresolved.map((u) => `- ${u}`).join('\n');
      sections.push(`**Unresolved:**\n${items}`);
    }

    // Include main thread (medium priority)
    if (ts.mainThread && ts.mainThread !== 'Unknown') {
      sections.push(`**Main:** ${ts.mainThread}`);
    }

    // Include sub-threads briefly (medium priority)
    if (ts.subThreads.length > 0) {
      const threads = ts.subThreads
        .map((t) => `- ${t.name} [${t.status}]`)
        .join('\n');
      sections.push(threads);
    }

    // Thread history is SKIPPED in truncated mode

    // Calculate remaining budget for narrative
    const structuredContent = sections.join('\n');
    const narrativeBudget = budget - structuredContent.length - 20; // 20 for label

    if (narrativeBudget > 50) {
      const narrativeLabel = '**Summary:** ';
      const maxNarrative = narrativeBudget - narrativeLabel.length;
      const truncatedNarrative = summary.summary.length > maxNarrative
        ? summary.summary.slice(0, maxNarrative - 3) + '...'
        : summary.summary;
      sections.push(`${narrativeLabel}${truncatedNarrative}`);
    }

    return sections.join('\n');
  }
}
