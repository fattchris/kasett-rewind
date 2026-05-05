/**
 * Steering prompt builder.
 *
 * Builds prompts for two hooks:
 * 1. Orientation (before_prompt_build, runs on EVERY turn): shows agent the current
 *    thread state and trajectory across recent compactions — light, names only.
 * 2. Pre-compaction (summarize()): instructs the LLM to produce a new summary
 *    with weighted context from previous summaries for continuity.
 */

import type { ThreadMeta } from '../types.js';
import type { WeightedSummary } from './weight.js';

/**
 * Build the orientation string for the before_prompt_build hook.
 * Runs on every agent turn. Shows current thread state + trajectory over
 * recent compactions so the agent knows what it was working on.
 *
 * Accepts multiple ThreadMeta objects (most recent first) — typically the
 * last 3 compaction summaries' [THREAD_META] blocks. Shows trajectory:
 * the most recent is the "current" state, older ones show where things came from.
 *
 * @param metas - Thread meta objects, most recent FIRST (up to 3)
 * @returns Orientation string, or null if no metas provided or all are empty
 */
export function buildOrientationPrompt(metas: ThreadMeta[]): string | null {
  if (metas.length === 0) return null;

  const current = metas[0];
  if (!current.main?.trim()) return null;

  const lines: string[] = [];

  // Current state (most recent compaction)
  lines.push(`You are currently working on: ${current.main}.`);

  const activeSubs = current.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
  if (activeSubs.length > 0) {
    lines.push(`Active sub-threads: ${activeSubs.join(', ')}`);
  }

  // Thread trajectory (previous compactions), if any
  const older = metas.slice(1);
  if (older.length > 0) {
    lines.push('');
    lines.push('Thread trajectory (previous compactions):');
    older.forEach((meta, i) => {
      const olderSubs = meta.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
      const subsStr = olderSubs.length > 0 ? ` | Subs: ${olderSubs.join(', ')}` : '';
      lines.push(`  -${i + 1}: Main: ${meta.main}${subsStr}`);
    });
  }

  return lines.join('\n');
}

/**
 * Build the pre-compaction steering prompt.
 * Shows previous summaries weighted by recency so the LLM understands
 * how much historical context to carry forward.
 * Also instructs the LLM to produce [THREAD_META] for orientation.
 *
 * @param weightedSummaries - Previous summaries with temporal weights, most recent first
 * @returns Steering prompt string to inject as system context
 */
export function buildSteeringPrompt(
  weightedSummaries: WeightedSummary[],
): string {
  const sections: string[] = [];

  sections.push('## Thread-Aware Compaction Instructions');
  sections.push('');

  // Show weighted previous summaries as context
  if (weightedSummaries.length > 0) {
    sections.push('### Previous Compaction Summaries (for continuity)');
    sections.push('');
    sections.push(
      'These summaries are from previous compactions. ' +
      'Weight indicates how much influence each should have on the new summary: ' +
      '1.0 = most recent (high relevance), lower = older (retain only if still relevant).',
    );
    sections.push('');

    for (const ws of weightedSummaries) {
      sections.push(`#### ${ws.label}`);
      sections.push('');
      sections.push(ws.summary.trim());
      sections.push('');
    }
  }

  // Output format instructions
  sections.push('### Output Requirements');
  sections.push('');
  sections.push(
    'Write a concise compaction summary of the conversation below. ' +
    'Use the previous summaries above as context — higher-weighted summaries describe ' +
    'more recent work and should inform the summary more heavily. ' +
    'Lower-weighted summaries are older background context; include only what remains relevant.',
  );
  sections.push('');
  sections.push(
    'Then IMMEDIATELY after the summary, append this structured block (filled in with real values):',
  );
  sections.push('');
  sections.push('[THREAD_META]');
  sections.push('main: Setting up K8s staging on AWS EKS');
  sections.push('sub1: ArgoCD deployment pipeline configuration');
  sections.push('sub2: Database credential management');
  sections.push('sub3: idle');
  sections.push('[/THREAD_META]');
  sections.push('');
  sections.push(
    'That example shows the format. Replace the values with the ACTUAL thread state from the conversation you are summarizing.',
  );
  sections.push(
    'The [THREAD_META] block describes the current conversation threads for agent orientation — ' +
    'it is NOT a task tracker. Threads reflect what the conversation is actually about right now. ' +
    'They change naturally as conversation topics shift.',
  );
  sections.push(
    'The [THREAD_META] block must appear at the end. Exactly 1 main + 3 subs. ' +
    'Use "idle" for inactive sub-thread slots.',
  );

  return sections.join('\n');
}
