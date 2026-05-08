import type { KasettConfig } from '../types.js';
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
export declare class SectionLoader {
    private readonly config;
    private readonly reader;
    constructor(config: KasettConfig);
    /**
     * Load previous compaction summaries and format them for injection.
     * The current (most recent) summary is NOT included — OC handles
     * that via its normal path. This loads N-1 older summaries.
     *
     * @param sessionFilePath - Path to the session .jsonl file
     * @param budgetChars - Maximum character budget for the output
     * @returns Formatted sections ready for injection
     */
    loadSections(sessionFilePath: string, budgetChars: number): Promise<LoadedSections>;
    /**
     * Compute character budgets for each previous summary slot.
     * Uses the windowBudgetSplit proportions for summary slots only
     * (excludes the last element which is for recent turns).
     */
    private computePerSummaryBudgets;
    /**
     * Format summaries for context injection with budget-aware truncation.
     *
     * Truncation priority (what gets cut first):
     * 1. Thread snapshot / thread history (least critical for older summaries)
     * 2. Narrative summary text (truncated from the end)
     * 3. Key state (survives longest — most valuable for recall)
     */
    private formatSummaries;
    /**
     * Format a single summary within its character budget.
     * Applies truncation in priority order.
     */
    private formatOneSummary;
    /**
     * Build the full untruncated summary text.
     */
    private buildFullSummaryText;
    /**
     * Build a truncated summary text that fits within budget.
     * Truncation order:
     * 1. Remove thread history
     * 2. Truncate narrative from end
     * 3. Last resort: trim key state values
     */
    private buildTruncatedSummaryText;
}
//# sourceMappingURL=section-loader.d.ts.map