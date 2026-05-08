/**
 * Builds the compaction prompt that enforces structured thread tracking.
 * This prompt is injected via compaction.customInstructions or used by the
 * full compaction.provider when registered.
 */
export function buildCompactionPrompt(previousSummaries, tokenBudget) {
    const prevContext = previousSummaries.length > 0
        ? formatPreviousSummaries(previousSummaries)
        : '';
    return `You are summarizing a conversation for context continuity. Your summary will be injected into future context so the agent can maintain awareness of what happened.

${prevContext}

## OUTPUT FORMAT (MANDATORY)

Your summary MUST follow this exact structure:

### Main Thread
[One sentence: the primary task/topic being worked on]

### Active Sub-threads (max 3)
1. [Sub-thread name] — [current status/state]
2. [Sub-thread name] — [current status/state]
3. [Sub-thread name] — [current status/state]

### Thread History
[Threads from previous compaction(s) that are now completed/backgrounded]
- [Thread name]: [completed|blocked|backgrounded] — [one-line outcome]

### Key State
[Critical values, decisions, or facts that MUST survive compaction]
- [key]: [value]

### Unresolved
[Items the user is waiting on or expects follow-up for]
- [item]

### Narrative Summary
[Free-form summary of what happened, max ${Math.floor(tokenBudget * 0.4)} tokens. Focus on WHAT HAPPENED and DECISIONS MADE, not just topics discussed.]

## RULES
- Every thread from the previous compaction MUST appear either in Active Sub-threads OR Thread History with an explicit status. Threads CANNOT silently disappear.
- Max 3 active sub-threads. If a 4th emerges, background the lowest-activity one.
- Key State should contain specific values (URLs, IDs, versions, config values) not just topic labels.
- The Narrative Summary is for context the structured fields don't capture.
- Total output must fit within ~${tokenBudget} tokens.`;
}
function formatPreviousSummaries(summaries) {
    if (summaries.length === 0)
        return '';
    const parts = summaries.map((s, i) => {
        const age = i === 0 ? '(oldest retained)' : '(most recent)';
        const threads = formatThreadSnapshot(s.threadSnapshot);
        return `## Previous Compaction ${i + 1} ${age}
${threads}

### Narrative
${s.summary}`;
    });
    return `## CONTEXT FROM PREVIOUS COMPACTIONS
The following summaries are from earlier in this session. Your job is to produce the NEXT summary that continues the thread evolution.

${parts.join('\n\n---\n\n')}

---
## YOUR TASK: Summarize the conversation below, continuing the thread evolution from the compactions above.
`;
}
function formatThreadSnapshot(ts) {
    const lines = [];
    lines.push(`**Main Thread:** ${ts.mainThread}`);
    if (ts.subThreads.length > 0) {
        lines.push('**Sub-threads:**');
        for (const st of ts.subThreads) {
            lines.push(`- ${st.name} [${st.status}]${st.detail ? ` — ${st.detail}` : ''}`);
        }
    }
    if (ts.keyState && Object.keys(ts.keyState).length > 0) {
        lines.push('**Key State:**');
        for (const [k, v] of Object.entries(ts.keyState)) {
            lines.push(`- ${k}: ${v}`);
        }
    }
    if (ts.unresolved && ts.unresolved.length > 0) {
        lines.push('**Unresolved:**');
        for (const item of ts.unresolved) {
            lines.push(`- ${item}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=prompt.js.map