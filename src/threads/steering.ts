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
  sections.push('### Output Requirements');
  sections.push('');
  sections.push('Write a concise compaction summary of the conversation. Then IMMEDIATELY after the summary, append this structured block (filled in with real values):');
  sections.push('');
  sections.push('[THREAD_META]');
  sections.push('main: Setting up K8s staging on AWS EKS');
  sections.push('sub1: ArgoCD deployment pipeline configuration');
  sections.push('sub2: Database credential management');
  sections.push('sub3: idle');
  sections.push('[/THREAD_META]');
  sections.push('');
  sections.push('That example shows the format. Replace the values with the ACTUAL thread state from the conversation you are summarizing.');
  sections.push('The [THREAD_META] block must appear at the end. Exactly 1 main + 3 subs. Use "idle" for inactive sub-thread slots.');

  return sections.join('\n');
}
