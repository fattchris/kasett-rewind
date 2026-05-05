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
import { THREAD_META_REGEX } from './constants.js';
import type { ThreadMeta } from '../types.js';

/**
 * A generated stub result.
 */
export interface StubResult {
  /** The full stub string to return from summarize() */
  stub: string;
  /** Unique ID embedded in the stub for later hot-swap identification */
  stubId: string;
}

/**
 * Generate a stub compaction summary.
 *
 * @param previousSummary - Previous compaction summary from OC params (may be undefined)
 * @param messages - The conversation messages being compacted (for fallback heuristic)
 * @returns StubResult with the stub string and its unique ID
 */
export function generateStub(
  previousSummary: string | undefined,
  messages: Array<{ role: string; content: unknown }>,
): StubResult {
  const stubId = randomUUID();

  // Extract thread meta from the previous summary if available
  const threadMeta = extractThreadMeta(previousSummary) ?? buildHeuristicThreadMeta(messages);

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
 * Returns null if the summary is absent or contains no valid thread meta block.
 */
function extractThreadMeta(previousSummary: string | undefined): ThreadMeta | null {
  if (!previousSummary?.trim()) return null;

  const match = previousSummary.match(THREAD_META_REGEX);
  if (!match) return null;

  const metaBlock = match[1];
  return parseMetaBlock(metaBlock);
}

/**
 * Parse a raw [THREAD_META] inner content into a ThreadMeta.
 */
function parseMetaBlock(block: string): ThreadMeta | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

  let main = '';
  const subs: string[] = [];

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

  if (!main || subs.length !== 3) return null;

  return {
    main,
    sub: [subs[0], subs[1], subs[2]] as [string, string, string],
  };
}

/**
 * Build a heuristic thread meta from the last few messages when no previous
 * summary is available. Uses a keyword scan — no LLM call.
 */
function buildHeuristicThreadMeta(
  messages: Array<{ role: string; content: unknown }>,
): ThreadMeta {
  // Take the last 6 messages for context
  const recent = messages.slice(-6);
  const recentText = recent
    .map((m) => extractTextContent(m.content))
    .filter(Boolean)
    .join(' ');

  // Try to infer a main topic from the content
  const main = inferMainThread(recentText) || 'Ongoing conversation';

  return {
    main,
    sub: ['idle', 'idle', 'idle'],
  };
}

/**
 * Infer a brief main-thread description from raw text.
 * This is intentionally simple — just grabs up to the first sentence of
 * the most recent assistant or user message.
 */
function inferMainThread(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Grab first sentence (up to 80 chars)
  const sentence = cleaned.split(/[.!?]/)[0] ?? '';
  const trimmed = sentence.trim();
  if (trimmed.length > 80) return trimmed.slice(0, 77) + '...';
  return trimmed;
}

/**
 * Format a ThreadMeta into the [THREAD_META]...[/THREAD_META] block string.
 */
function formatThreadMeta(meta: ThreadMeta): string {
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
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (p['type'] === 'text' && typeof p['text'] === 'string') return p['text'];
          if (typeof p['text'] === 'string') return p['text'];
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c['text'] === 'string') return c['text'];
  }
  return '';
}
