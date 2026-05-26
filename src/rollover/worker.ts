/**
 * rollover/worker.ts — Background full-summary worker for the cold-start path.
 *
 * Runs after the synchronous stub has already been injected for the current
 * turn. Reads the sibling session, calls the LLM to produce a rich rollover
 * summary, parses out [THREAD_META] if present, and overwrites the rollover
 * sidecar with the rich entry. The NEXT `before_prompt_build` call will pick
 * up the rich version.
 *
 * Failure handling:
 *   - LLM timeout / abort: leave stub in place, write `.rollover.failed.json`
 *     marker so we don't retry storms.
 *   - LLM returns empty: same as timeout.
 *   - Write succeeds: replaces the stub atomically. Detector path on the next
 *     turn reads it; before_prompt_build consumes (renames to .consumed).
 *
 * No locks needed — only this worker writes the rollover sidecar, and the
 * sidecar's atomic rename is the synchronization point.
 */

import { SessionReader } from '../storage/reader.js';
import {
  writeRolloverSidecar,
  markRolloverFailed,
  type RolloverSidecarEntry,
} from './sidecar.js';
import { parseCompactionOutputBestEffort } from '../threads/parser.js';
import { callLLMForCompaction, messagesToText } from '../index.js';
import type { ThreadMeta } from '../types.js';

export interface RolloverWorkerParams {
  /** The current session's JSONL path (where the sidecar will be written) */
  currentSessionFile: string;
  /** The sibling session JSONL we're summarizing */
  siblingFile: string;
  /** Sibling file mtime (epoch ms) at the time the work was scheduled */
  siblingMtimeMs: number;
  /** Maximum number of turns from the sibling to feed the LLM */
  maxSourceTurns: number;
  /** Max time (ms) before giving up. Cancels the LLM call. */
  timeoutMs: number;
  /** Model override (passes through to callLLMForCompaction) */
  compactionModel?: string;
  /** Max output tokens for the LLM call */
  maxTokens: number;
  /** Logger — uses the OC plugin logger surface */
  logger: {
    debug(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
  /**
   * Optional: override the LLM function. Tests inject a stub here so we don't
   * make real API calls. When undefined, uses the real callLLMForCompaction.
   */
  callLLM?: typeof callLLMForCompaction;
  /** Optional: AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

export interface RolloverWorkerResult {
  success: boolean;
  reason?: string;
  /** The entry that was written on success */
  entry?: RolloverSidecarEntry;
}

const ROLLOVER_STEERING_PROMPT = `## Rollover Summary Instructions

You are generating a one-shot "rollover" summary for an AI agent that has
just started a brand-new session for a topic where prior work exists.

Your job: write a clear, dense summary of the prior session's conversation
so the agent picks up where it left off. The agent will see this once at
the start of its first turn and then operate from it.

### Output format

\`\`\`
[ROLLOVER_CONTEXT]
[THREAD_META] main: <one-line description of the dominant thread> | sub: <sub1>; <sub2>; <sub3>

## Where things stand
<2-4 paragraphs of dense prose covering: what the user was doing, what
decisions were made, what was completed, what is still open, what is
blocked or waiting on external input>

## Open threads / next likely moves
- <bullet>
- <bullet>
- <bullet>

## Key facts / state the agent should remember
- <bullet>
- <bullet>
[/ROLLOVER_CONTEXT]
\`\`\`

### Rules

- Write the summary as if briefing a colleague who is replacing you. Be
  specific. Name files, decisions, people, blockers.
- The [THREAD_META] line is mandatory. Pick the single dominant theme of
  the prior session as 'main'. Pick up to three secondary themes as
  'sub' (semicolon-separated). If fewer than three secondaries exist,
  pad with 'idle'.
- Do not invent facts. If something is uncertain in the prior turns, mark
  it explicitly: e.g. "unclear whether X was decided".
- Skip pure greetings, system noise, and tool chatter. Focus on substance.
- Keep total length under 1500 words. Brevity over completeness.
`;

export async function runRolloverWorker(
  params: RolloverWorkerParams,
): Promise<RolloverWorkerResult> {
  const {
    currentSessionFile,
    siblingFile,
    siblingMtimeMs,
    maxSourceTurns,
    timeoutMs,
    compactionModel,
    maxTokens,
    logger,
    callLLM,
    signal,
  } = params;

  // Combine external signal with our timeout
  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort('rollover_timeout'), timeoutMs);
  let externalAbortHandler: (() => void) | null = null;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutHandle);
      return { success: false, reason: 'aborted_before_start' };
    }
    externalAbortHandler = () => ac.abort('external_abort');
    signal.addEventListener('abort', externalAbortHandler);
  }

  try {
    const reader = new SessionReader();
    const siblingTurns = await reader.readRawTurns(siblingFile, maxSourceTurns);
    if (siblingTurns.length === 0) {
      logger.warn(
        `[kasett-rewind] rollover worker: sibling has 0 turns (${siblingFile})`,
      );
      await markRolloverFailed(currentSessionFile, 'sibling_empty');
      return { success: false, reason: 'sibling_empty' };
    }

    const llmFn = callLLM ?? callLLMForCompaction;
    const fullSummary = await llmFn({
      messages: siblingTurns,
      signal: ac.signal,
      steeringPrompt: ROLLOVER_STEERING_PROMPT,
      compactionModel,
      maxTokens,
      logger,
    });

    if (!fullSummary || !fullSummary.trim()) {
      logger.warn('[kasett-rewind] rollover worker: LLM returned empty');
      await markRolloverFailed(currentSessionFile, 'llm_empty');
      return { success: false, reason: 'llm_empty' };
    }

    // Try to parse [THREAD_META] out of the result
    let threadMeta: ThreadMeta | null = null;
    try {
      const parsed = parseCompactionOutputBestEffort(fullSummary);
      threadMeta = parsed.metaV1 ?? null;
    } catch {
      threadMeta = null;
    }

    const entry: RolloverSidecarEntry = {
      schemaVersion: 1,
      sourceSessionFile: siblingFile,
      sourceSessionMtimeMs: siblingMtimeMs,
      generatedAtMs: Date.now(),
      turnsConsumed: siblingTurns.length,
      threadMeta,
      summary: ensureWrapped(fullSummary),
      stub: false,
    };

    await writeRolloverSidecar(currentSessionFile, entry);
    logger.info(
      `[kasett-rewind] rollover worker: wrote rich sidecar (${entry.summary.length} chars, ${siblingTurns.length} turns)`,
    );
    return { success: true, entry };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[kasett-rewind] rollover worker failed: ${msg}`);
    // Best-effort marker so we don't retry every turn
    try {
      await markRolloverFailed(currentSessionFile, msg.slice(0, 200));
    } catch {
      /* ignore */
    }
    return { success: false, reason: msg };
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && externalAbortHandler) {
      signal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

/**
 * Ensure the summary is wrapped in [ROLLOVER_CONTEXT] tags so downstream
 * injection is consistent regardless of whether the LLM remembered to add
 * them.
 */
function ensureWrapped(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.startsWith('[ROLLOVER_CONTEXT')) return trimmed;
  // The LLM might have wrapped it in ```...``` fences — strip those first.
  const stripped = trimmed.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  if (stripped.startsWith('[ROLLOVER_CONTEXT')) return stripped;
  return `[ROLLOVER_CONTEXT]\n${stripped}\n[/ROLLOVER_CONTEXT]`;
}

/**
 * Export for tests so they can verify the steering prompt shape.
 */
export const _ROLLOVER_STEERING_PROMPT = ROLLOVER_STEERING_PROMPT;

// Re-export messagesToText so a test of this module doesn't need to dig
// through ../index.js (test-only convenience; not used by production code).
export { messagesToText };
