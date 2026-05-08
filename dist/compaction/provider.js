import { buildCompactionPrompt } from './prompt.js';
import { ThreadTracker } from './threads.js';
import { CompactionWindow } from './window.js';
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
export class CompactionProvider {
    window;
    config;
    constructor(config) {
        this.config = config;
        this.window = new CompactionWindow({ windowSize: config.windowSize });
    }
    /** Initialize from existing session data (called on session load) */
    loadWindow(existingSummaries) {
        this.window.load(existingSummaries);
    }
    /**
     * Main entry point — called by OC when compaction is triggered.
     * Takes the conversation context and produces a structured summary.
     *
     * @param context - Full conversation context from OC
     * @param llmCall - Function to call the LLM (injected by OC runtime)
     * @returns The new CompactionSummary to store
     */
    async summarize(context, llmCall) {
        const previousSummaries = this.window.getAll();
        const { summaryBudgets, recentTurnsBudget } = this.window.computeBudgets(context.tokenBudget, this.config.windowBudgetSplit);
        // Build the prompt that enforces structured output
        const systemPrompt = buildCompactionPrompt(previousSummaries, recentTurnsBudget);
        // Format recent turns as the user content
        const userContent = formatTurnsForSummarization(context.turns);
        // Call the LLM to produce the structured summary
        const rawOutput = await llmCall(systemPrompt, userContent);
        // Parse the structured output
        const threadSnapshot = this.config.threadTracking
            ? ThreadTracker.parse(rawOutput)
            : emptyThreadSnapshot();
        // Validate thread evolution
        const prevSummary = this.window.getLatest();
        if (this.config.threadTracking && prevSummary) {
            const violations = ThreadTracker.validate(threadSnapshot, prevSummary.threadSnapshot);
            if (violations.length > 0) {
                // Log violations — in production this could trigger a retry
                console.warn('[kasett-rewind] Thread evolution violations:', violations);
            }
            // Merge history from previous
            ThreadTracker.mergeHistory(threadSnapshot, prevSummary);
        }
        // Create the summary object
        const summary = {
            summary: rawOutput,
            windowIndex: 0, // Will be set by window.push()
            windowTotal: this.config.windowSize,
            threadSnapshot,
            timestamp: new Date().toISOString(),
            tokenCount: estimateTokens(rawOutput),
        };
        // Push into window (may drop oldest)
        const dropped = this.window.push(summary);
        return summary;
    }
    /** Get the full context block to inject into the agent's prompt */
    getContextBlock() {
        const summaries = this.window.getAll();
        if (summaries.length === 0)
            return '';
        const parts = ['<!-- kasett-rewind: rolling compaction window -->'];
        for (let i = 0; i < summaries.length; i++) {
            const s = summaries[i];
            const label = i === summaries.length - 1 ? 'Most Recent' : `Previous (${i + 1})`;
            parts.push(`\n## Compaction: ${label}\n`);
            parts.push(s.summary);
        }
        parts.push('\n<!-- /kasett-rewind -->');
        return parts.join('\n');
    }
    /** Expose window state for external inspection */
    getWindowState() {
        return {
            size: this.window.size,
            summaries: this.window.serialize(),
        };
    }
}
// --- Helpers ---
function formatTurnsForSummarization(turns) {
    return turns
        .map((t) => {
        const prefix = t.role === 'user' ? 'Human' : t.role === 'assistant' ? 'Assistant' : t.role;
        const toolInfo = t.toolCalls && t.toolCalls.length > 0
            ? `\n[Tools used: ${t.toolCalls.map((tc) => tc.name).join(', ')}]`
            : '';
        return `${prefix}: ${t.content}${toolInfo}`;
    })
        .join('\n\n');
}
function emptyThreadSnapshot() {
    return {
        mainThread: 'Unknown',
        subThreads: [],
        keyState: {},
        unresolved: [],
        threadHistory: [],
    };
}
function estimateTokens(text) {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
}
//# sourceMappingURL=provider.js.map