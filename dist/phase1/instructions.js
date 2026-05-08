/**
 * Error class for kasett-rewind operations.
 */
export class KasettError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'KasettError';
        this.code = code;
    }
}
/**
 * Generates the `compaction.customInstructions` string for OpenClaw.
 * This string is injected into OC's existing summarization prompt to
 * enforce structured output with thread tracking.
 *
 * @param config - The kasett-rewind configuration
 * @returns The full instruction string for injection
 */
export function generateCustomInstructions(config) {
    if (!config.threadTracking && config.windowSize === 1) {
        // Minimal mode: just enforce a narrative structure without thread overhead
        return generateMinimalInstructions();
    }
    const sections = [];
    sections.push('IMPORTANT: Your compaction summary MUST follow this exact structure.');
    sections.push('');
    if (config.threadTracking) {
        sections.push('## Main Thread');
        sections.push('[One sentence: the primary task/topic currently active]');
        sections.push('');
        sections.push('## Active Sub-threads (max 3)');
        sections.push('1. [Name] — [status: what\'s happening now]');
        sections.push('2. [Name] — [status]');
        sections.push('3. [Name] — [status]');
        sections.push('');
        sections.push('(If fewer than 3, list only what exists. Never invent threads.)');
        sections.push('');
        sections.push('## Thread History');
        sections.push('(Threads that were previously active but are now resolved. Include ALL threads from the previous compaction that are no longer active, with explicit status.)');
        sections.push('- [Name]: [completed|blocked|backgrounded] — [one-line outcome/reason]');
        sections.push('');
    }
    sections.push('## Key State');
    sections.push('(Specific values that MUST survive compaction. URLs, IDs, file paths, version numbers, config values, names. NOT topic labels — actual values.)');
    sections.push('- [key]: [value]');
    sections.push('- [key]: [value]');
    sections.push('');
    sections.push('## Unresolved');
    sections.push('(Things the user is waiting on, expects follow-up for, or that are blocked on external input.)');
    sections.push('- [item]');
    sections.push('');
    sections.push('## Summary');
    sections.push('[Narrative of what happened, decisions made, and current direction. Focus on trajectory — where we came from, where we are, where we\'re heading. Max 60% of your output budget.]');
    sections.push('');
    // Rules section
    sections.push('RULES:');
    if (config.threadTracking) {
        sections.push('- Every thread from the previous compaction summary MUST appear in your output — either still in Active Sub-threads OR moved to Thread History with explicit status. Threads CANNOT silently disappear.');
    }
    sections.push('- Key State must contain SPECIFIC VALUES, not topic labels. "database" is not key state. "PostgreSQL 15.2 on db.prod.internal:5432" is key state.');
    sections.push('- If this is the first compaction (no previous summary), populate all sections from the conversation. If there was a previous summary, evolve the threads from it.');
    if (config.windowSize > 1) {
        sections.push(`- You are part of a rolling window of ${config.windowSize} compaction summaries. Your summary will be retained alongside ${config.windowSize - 1} previous summaries for context continuity.`);
    }
    return sections.join('\n');
}
/**
 * Generates minimal instructions when thread tracking is disabled
 * and window size is 1 (essentially a slightly structured single summary).
 */
function generateMinimalInstructions() {
    return [
        'Structure your compaction summary with these sections:',
        '',
        '## Key State',
        '(Specific values that MUST survive: URLs, IDs, file paths, version numbers, config values.)',
        '- [key]: [value]',
        '',
        '## Unresolved',
        '(Things awaiting follow-up or blocked on external input.)',
        '- [item]',
        '',
        '## Summary',
        '[Narrative of what happened, decisions made, and current direction.]',
        '',
        'RULES:',
        '- Key State must contain SPECIFIC VALUES, not topic labels.',
        '- Focus on trajectory: where we came from, where we are, where we\'re heading.',
    ].join('\n');
}
//# sourceMappingURL=instructions.js.map