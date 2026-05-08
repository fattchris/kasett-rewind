/**
 * stub.ts — Generates the hot-swap stub compaction summary.
 *
 * The stub is returned immediately from summarize() with zero LLM calls.
 * It contains a unique marker ([KASETT_STUB::<id>]) so the background
 * worker can find and replace it in the JSONL once the full LLM summary
 * is ready.
 *
 * Thread meta in the stub is extracted from the PREVIOUS compaction's
 * [THREAD_META] block (supplied via previousSummary), or derived from a
 * lightweight heuristic over the last few messages if no prior summary exists.
 */
import { randomUUID } from 'node:crypto';
import { THREAD_META_REGEX, KASETT_STUB_PREFIX } from './constants.js';
/**
 * Generate a stub compaction summary.
 *
 * @param previousSummary - Previous compaction summary from OC params (may be undefined)
 * @param messages - The conversation messages being compacted (for fallback heuristic)
 * @returns StubResult with the stub string and its unique ID
 */
export function generateStub(previousSummary, messages) {
    const stubId = randomUUID();
    // Extract thread meta from the previous summary if available.
    // IMPORTANT: if previousSummary is itself a stub (hot-swap failed last time),
    // don't extract meta from it — that would perpetuate the "Ongoing work" cascade.
    // Instead fall through to the heuristic.
    const isPreviousStub = previousSummary ? previousSummary.includes(KASETT_STUB_PREFIX) : false;
    const threadMeta = (!isPreviousStub && extractThreadMeta(previousSummary)) ||
        buildHeuristicThreadMeta(messages);
    const threadMetaBlock = formatThreadMeta(threadMeta);
    const stub = [
        `[KASETT_STUB::${stubId}]`,
        '',
        'Session compaction in progress. Thread state:',
        '',
        threadMetaBlock,
    ].join('\n');
    return { stub, stubId };
}
/**
 * Extract [THREAD_META] from a previous compaction summary string.
 * Returns null if the summary is absent, is a kasett stub, or contains no valid thread meta block.
 *
 * NOTE: callers should check `previousSummary.includes(KASETT_STUB_PREFIX)` before calling
 * this function to avoid cascading stale "Ongoing work" meta from failed hot-swaps.
 */
function extractThreadMeta(previousSummary) {
    if (!previousSummary?.trim())
        return null;
    const match = previousSummary.match(THREAD_META_REGEX);
    if (!match)
        return null;
    const metaBlock = match[1];
    return parseMetaBlock(metaBlock);
}
/**
 * Parse a raw [THREAD_META] inner content into a ThreadMeta.
 */
function parseMetaBlock(block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let main = '';
    const subs = [];
    for (const line of lines) {
        const mainMatch = line.match(/^main:\s*(.+)/i);
        if (mainMatch) {
            main = mainMatch[1].trim();
            continue;
        }
        const subMatch = line.match(/^sub[123]:\s*(.+)/i);
        if (subMatch) {
            subs.push(subMatch[1].trim());
        }
    }
    if (!main || subs.length !== 3)
        return null;
    return {
        main,
        sub: [subs[0], subs[1], subs[2]],
    };
}
/**
 * Returns true if a message text looks like tool/command output rather than
 * natural language. We filter these out so thread labels don't become garbage
 * like "total 8 drwxr-xr-x" when an ls/pwd result is the most recent message.
 */
function looksLikeToolOutput(text) {
    const t = text.trimStart();
    // Unix file listing (ls -l)
    if (/^total \d+/m.test(t))
        return true;
    if (/^[d\-lrwxst]{10}\s+\d+/m.test(t))
        return true;
    // JSON blobs
    if (t.startsWith('{') || t.startsWith('['))
        return true;
    // Base64-encoded data
    if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(t.split('\n')[0] ?? ''))
        return true;
    // Hex dumps
    if (/^[0-9a-f]{8}:\s+[0-9a-f ]{24}/.test(t))
        return true;
    // Very short fragments that can't be meaningful labels
    if (t.replace(/\s+/g, ' ').trim().length < 4)
        return true;
    return false;
}
/**
 * Build a heuristic thread meta from the last few messages when no previous
 * summary is available. Uses a keyword scan — no LLM call.
 *
 * Only considers user and assistant messages (not tool results), and skips
 * any message whose content looks like raw tool/command output.
 */
function buildHeuristicThreadMeta(messages) {
    // Take the last 6 messages for context
    const recent = messages.slice(-6);
    // Filter: only human/assistant turns, skip tool output
    const usableMessages = recent.filter((m) => {
        const role = m.role?.toLowerCase();
        if (role !== 'user' && role !== 'assistant')
            return false;
        const text = extractTextContent(m.content);
        if (!text.trim())
            return false;
        if (looksLikeToolOutput(text))
            return false;
        return true;
    });
    // Prefer the LAST user message as the thread source
    const lastUserMsg = [...usableMessages].reverse().find((m) => m.role?.toLowerCase() === 'user');
    const sourceText = lastUserMsg
        ? extractTextContent(lastUserMsg.content)
        : usableMessages.length > 0
            ? extractTextContent(usableMessages[usableMessages.length - 1].content)
            : '';
    const main = inferMainThread(sourceText) || 'Ongoing work';
    return {
        main,
        sub: ['idle', 'idle', 'idle'],
    };
}
/**
 * Infer a brief main-thread description from raw text.
 * This is intentionally simple — just grabs up to the first sentence of
 * the most recent user message.
 */
function inferMainThread(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return '';
    // Grab first sentence (up to 80 chars)
    const sentence = cleaned.split(/[.!?]/)[0] ?? '';
    const trimmed = sentence.trim();
    if (trimmed.length > 80)
        return trimmed.slice(0, 77) + '...';
    return trimmed;
}
/**
 * Format a ThreadMeta into the [THREAD_META]...[/THREAD_META] block string.
 */
function formatThreadMeta(meta) {
    return [
        '[THREAD_META]',
        `main: ${meta.main}`,
        `sub1: ${meta.sub[0]}`,
        `sub2: ${meta.sub[1]}`,
        `sub3: ${meta.sub[2]}`,
        '[/THREAD_META]',
    ].join('\n');
}
/**
 * Extract text content from a message's content field.
 * Handles string, array-of-parts, and object formats.
 */
function extractTextContent(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === 'string')
                return part;
            if (part && typeof part === 'object') {
                const p = part;
                if (p['type'] === 'text' && typeof p['text'] === 'string')
                    return p['text'];
                if (typeof p['text'] === 'string')
                    return p['text'];
            }
            return '';
        })
            .filter(Boolean)
            .join(' ');
    }
    if (content && typeof content === 'object') {
        const c = content;
        if (typeof c['text'] === 'string')
            return c['text'];
    }
    return '';
}
//# sourceMappingURL=stub.js.map