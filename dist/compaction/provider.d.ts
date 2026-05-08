import type { CompactionContext, CompactionSummary, KasettConfig } from '../types.js';
/**
 * Core compaction provider.
 * Replaces the OC built-in summarizer when registered as compaction.provider.
 *
 * Responsibilities:
 * 1. Build structured compaction prompts with thread tracking
 * 2. Manage the rolling window of N summaries
 * 3. Validate thread evolution across compactions
 * 4. Parse structured output from the LLM into CompactionSummary
 */
export declare class CompactionProvider {
    private window;
    private config;
    constructor(config: KasettConfig);
    /** Initialize from existing session data (called on session load) */
    loadWindow(existingSummaries: CompactionSummary[]): void;
    /**
     * Main entry point — called by OC when compaction is triggered.
     * Takes the conversation context and produces a structured summary.
     *
     * @param context - Full conversation context from OC
     * @param llmCall - Function to call the LLM (injected by OC runtime)
     * @returns The new CompactionSummary to store
     */
    summarize(context: CompactionContext, llmCall: (systemPrompt: string, userContent: string) => Promise<string>): Promise<CompactionSummary>;
    /** Get the full context block to inject into the agent's prompt */
    getContextBlock(): string;
    /** Expose window state for external inspection */
    getWindowState(): {
        size: number;
        summaries: CompactionSummary[];
    };
}
//# sourceMappingURL=provider.d.ts.map