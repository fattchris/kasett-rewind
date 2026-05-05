/**
 * Parser for [THREAD_META]...[/THREAD_META] blocks in compaction output.
 *
 * Extracts the thread meta, parses it into a ThreadMeta object,
 * and strips it from the summary so the stored summary is clean narrative.
 */

import type { ThreadMeta } from '../types.js';

/**
 * Result of parsing a compaction output.
 */
export interface ParseResult {
  /** The narrative summary with thread meta block removed */
  summary: string;
  /** The extracted thread meta, or null if not found/invalid */
  meta: ThreadMeta | null;
}

/**
 * The regex that matches the [THREAD_META]...[/THREAD_META] block.
 */
const THREAD_META_REGEX = /\[THREAD_META\]\s*\n([\s\S]*?)\n?\s*\[\/THREAD_META\]/;

/**
 * Parse a compaction output string, extracting thread meta and clean summary.
 *
 * @param raw - Raw compaction LLM output containing both narrative and thread meta
 * @returns ParseResult with clean summary and extracted meta
 */
export function parseCompactionOutput(raw: string): ParseResult {
  const match = raw.match(THREAD_META_REGEX);

  if (!match) {
    // No thread meta block found — return raw as summary, null meta
    return { summary: raw.trim(), meta: null };
  }

  // Extract the meta block content
  const metaBlock = match[1];
  const meta = parseMetaBlock(metaBlock);

  // Strip the entire [THREAD_META]...[/THREAD_META] block from the summary
  const summary = raw.replace(THREAD_META_REGEX, '').trim();

  return { summary, meta };
}

/**
 * Parse the inner content of a [THREAD_META] block into a ThreadMeta object.
 *
 * Expected format:
 *   main: <text>
 *   sub1: <text>
 *   sub2: <text>
 *   sub3: <text>
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

  // Validate: must have main + exactly 3 subs
  if (!main || subs.length !== 3) {
    return null;
  }

  return {
    main,
    sub: [subs[0], subs[1], subs[2]] as [string, string, string],
  };
}
