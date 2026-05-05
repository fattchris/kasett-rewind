/**
 * Steering prompt builder.
 *
 * Builds prompts for two hooks:
 * 1. Pre-compaction: instructs the LLM to produce a summary + thread meta
 * 2. Context load: short orientation string from most recent thread meta
 */

import type { ThreadMeta } from '../types.js';
import type { WeightedThreadAnalysis } from './weight.js';

/**
 * Build the short orientation string for context load (after compaction).
 * Injected at session start so the agent knows what it was working on.
 */
export function buildOrientationPrompt(meta: ThreadMeta): string {
  return `You are currently working on: ${meta.main}.\nActive sub-threads: ${meta.sub[0]}, ${meta.sub[1]}, ${meta.sub[2]}`;
}

/**
 * Build the pre-compaction steering prompt.
 * Tells the LLM what the thread history has been, what's core/new/fading,
 * and instructs it to produce both a narrative summary AND thread meta output.
 */
export function buildSteeringPrompt(
  analysis: WeightedThreadAnalysis,
  previousMetas: ThreadMeta[],
): string {
  const sections: string[] = [];

  sections.push('## Thread-Aware Compaction Instructions');
  sections.push('');

  // Show thread history context
  if (previousMetas.length > 0) {
    sections.push('### Recent Thread History');
    for (let i = 0; i < previousMetas.length; i++) {
      const meta = previousMetas[i];
      const label = i === 0 ? '(most recent)' : `(${i + 1} compactions ago)`;
      sections.push(`${label} Main: ${meta.main}`);
      sections.push(`  Subs: ${meta.sub.join(' | ')}`);
    }
    sections.push('');
  }

  // Show weighted analysis
  if (analysis.core.length > 0) {
    sections.push('### Core Threads (consistent across compactions)');
    for (const thread of analysis.core) {
      sections.push(`- ${thread}`);
    }
    sections.push('');
  }

  if (analysis.fresh.length > 0) {
    sections.push('### New Threads (just appeared)');
    for (const thread of analysis.fresh) {
      sections.push(`- ${thread}`);
    }
    sections.push('');
  }

  if (analysis.fading.length > 0) {
    sections.push('### Fading Threads (were active, no longer in recent)');
    for (const thread of analysis.fading) {
      sections.push(`- ${thread}`);
    }
    sections.push('');
  }

  // Output format instructions
  sections.push('### Your Task');
  sections.push('');
  sections.push('Produce a compaction summary that:');
  sections.push('1. Captures what happened in this conversation segment (decisions, actions, state changes)');
  sections.push('2. Maintains continuity with core threads');
  sections.push('3. Acknowledges new threads that emerged');
  sections.push('4. Notes any fading threads if they were intentionally completed or abandoned');
  sections.push('');
  sections.push('After your narrative summary, output the current thread meta in this EXACT format:');
  sections.push('');
  sections.push('[THREAD_META]');
  sections.push('main: <one line describing the primary focus>');
  sections.push('sub1: <one line for sub-thread 1>');
  sections.push('sub2: <one line for sub-thread 2>');
  sections.push('sub3: <one line for sub-thread 3>');
  sections.push('[/THREAD_META]');
  sections.push('');
  sections.push('Rules:');
  sections.push('- Always output exactly 1 main + 3 subs. No more, no less.');
  sections.push('- If fewer than 3 sub-threads exist, describe the next likely focus or use "no active sub-thread" as placeholder.');
  sections.push('- Thread descriptions should be natural language, concise, and capture current state.');
  sections.push('- The [THREAD_META] block MUST be at the end of your output.');

  return sections.join('\n');
}
