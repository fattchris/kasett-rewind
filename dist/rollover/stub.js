/**
 * rollover/stub.ts — Cheap synchronous stub for the cold-start path.
 *
 * Called on the first `before_prompt_build` of a brand-new session when the
 * detector says Tier 3 should fire. Produces a small `[ROLLOVER_CONTEXT]`
 * block with the last user + last assistant turn from the sibling. No LLM
 * call. Returns in milliseconds.
 *
 * Format (visible to the agent on first turn):
 *
 *     [ROLLOVER_CONTEXT — stub]
 *     The prior session for this topic ended ~Xh ago.
 *     Last user turn:
 *       "..."
 *     Last assistant turn:
 *       "..."
 *     A richer summary is being generated in the background and will be
 *     available from the next turn onward.
 *     [/ROLLOVER_CONTEXT]
 */
import { extractTextContent } from '../index.js';
export function buildRolloverStub(params) {
    const { siblingTurns, siblingFile, siblingMtimeMs } = params;
    const maxChars = params.maxChars ?? 400;
    const lastUser = findLastNonEmptyByRole(siblingTurns, 'user');
    const lastAssistant = findLastNonEmptyByRole(siblingTurns, 'assistant');
    const idleMs = Math.max(0, Date.now() - siblingMtimeMs);
    const idleHours = idleMs / (3600 * 1000);
    const lines = [];
    lines.push('[ROLLOVER_CONTEXT — stub]');
    lines.push(`The prior session for this topic ended ~${formatIdle(idleHours)} ago.`);
    if (lastUser) {
        lines.push('');
        lines.push('Last user turn:');
        lines.push(quote(extractTextContent(lastUser.content), maxChars));
    }
    if (lastAssistant) {
        lines.push('');
        lines.push('Last assistant turn:');
        lines.push(quote(extractTextContent(lastAssistant.content), maxChars));
    }
    if (!lastUser && !lastAssistant) {
        lines.push('');
        lines.push('(No user/assistant turns recoverable from sibling — empty fallback.)');
    }
    lines.push('');
    lines.push('A richer summary is being generated in the background and will be ' +
        'available from the next turn onward.');
    lines.push('[/ROLLOVER_CONTEXT]');
    const summary = lines.join('\n');
    return {
        schemaVersion: 1,
        sourceSessionFile: siblingFile,
        sourceSessionMtimeMs: siblingMtimeMs,
        generatedAtMs: Date.now(),
        turnsConsumed: siblingTurns.length,
        threadMeta: null,
        summary,
        stub: true,
        stubReason: 'synchronous_cold_start',
    };
}
/**
 * Find the last turn for a role that has non-empty extracted text content.
 * Fixes the "Last user turn: \"\"" stub-empty-quote bug observed in
 * production v0.3.0 where heartbeat-only or content-filtered turns produced
 * blank quotes in the stub.
 */
function findLastNonEmptyByRole(turns, role) {
    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].role !== role)
            continue;
        const text = extractTextContent(turns[i].content).trim();
        if (text.length > 0)
            return turns[i];
    }
    return null;
}
function quote(text, maxChars) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const truncated = cleaned.length > maxChars ? cleaned.slice(0, maxChars) + '…' : cleaned;
    return `  "${truncated}"`;
}
function formatIdle(hours) {
    if (hours < 1) {
        const minutes = Math.max(1, Math.round(hours * 60));
        return `${minutes}m`;
    }
    if (hours < 48) {
        return `${Math.round(hours)}h`;
    }
    const days = Math.round(hours / 24);
    return `${days}d`;
}
//# sourceMappingURL=stub.js.map