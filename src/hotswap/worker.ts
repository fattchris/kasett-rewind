/**
 * worker.ts — Background LLM call + hot-swap file rewrite logic.
 *
 * After summarize() returns the stub immediately, this module runs the FULL
 * LLM summarization in the background, then waits for the inter-turn gap
 * (OC's session write lock to be absent) and atomically rewrites the JSONL,
 * replacing the stub compaction entry with the full LLM-generated summary.
 *
 * ## Atomic rewrite pattern (matches OC's own pattern):
 *   1. Read current JSONL content
 *   2. Parse all lines, find the stub compaction entry by stubId
 *   3. Replace its summary field with the full LLM summary
 *   4. Write to `${sessionFile}.kasett-swap-tmp`
 *   5. `fs.rename(tmp, sessionFile)` — atomic on POSIX
 *   6. Release the lock
 *
 * ## Stale result handling:
 *   If ANOTHER compaction fires before this hot-swap completes, the stub
 *   entry will have been replaced or truncated by OC's own compaction
 *   machinery. In that case, the stub ID will no longer be found in the
 *   JSONL and the background result is silently discarded.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { acquireLock, waitForLockAbsent } from './lock.js';
import { KASETT_STUB_REGEX } from './constants.js';

export interface WorkerParams {
  /** Absolute path to the session `.jsonl` file to rewrite */
  sessionFile: string;
  /** The stub ID embedded in the compaction entry to replace */
  stubId: string;
  /** Messages passed to summarize() — forwarded to the LLM */
  messages: Array<{ role: string; content: unknown }>;
  /** Previous summary text for continuity blending */
  previousSummaries: string[];
  /** Steering prompt already built for this compaction */
  steeringPrompt: string;
  /** OC custom instructions (passed through to LLM) */
  customInstructions?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Model identifier override */
  compactionModel?: string;
  /**
   * Maximum time (ms) to wait for the session lock to be absent before
   * attempting the swap. Default: 30_000
   */
  hotSwapTimeoutMs?: number;
  /** Logger (plugin API logger) */
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
  /** The callLLMForCompaction function — injected to avoid circular deps */
  callLLM: (params: CallLLMParams) => Promise<string | undefined>;
}

export interface CallLLMParams {
  messages: Array<{ role: string; content: unknown }>;
  signal?: AbortSignal;
  customInstructions?: string;
  steeringPrompt: string;
  compactionModel?: string;
  logger: {
    debug(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
}

/**
 * Run the hot-swap background pipeline.
 *
 * This function is fire-and-forget — it should be called WITHOUT await
 * from summarize() so it runs after the stub has been returned to OC.
 *
 * All errors are caught and logged; they never propagate to the caller.
 */
export async function runHotSwapWorker(params: WorkerParams): Promise<void> {
  const {
    sessionFile,
    stubId,
    messages,
    previousSummaries,
    steeringPrompt,
    customInstructions,
    signal,
    compactionModel,
    hotSwapTimeoutMs = 30_000,
    logger,
    callLLM,
  } = params;

  try {
    logger.debug(`[kasett-rewind:hotswap] Background worker started for stub ${stubId}`);

    // Step 1: Call the LLM for the full summary
    if (signal?.aborted) {
      logger.debug('[kasett-rewind:hotswap] Aborted before LLM call');
      return;
    }

    const fullSummary = await callLLM({
      messages,
      signal,
      customInstructions,
      steeringPrompt,
      compactionModel,
      logger,
    });

    if (!fullSummary) {
      logger.warn(
        `[kasett-rewind:hotswap] LLM returned empty summary for stub ${stubId} — stub remains in place`,
      );
      return;
    }

    if (signal?.aborted) {
      logger.debug('[kasett-rewind:hotswap] Aborted after LLM call, before file swap');
      return;
    }

    // Step 2: Wait for the inter-turn gap (lock file absent)
    logger.debug(`[kasett-rewind:hotswap] LLM done. Waiting for inter-turn gap (timeout: ${hotSwapTimeoutMs}ms)`);
    const lockCleared = await waitForLockAbsent(sessionFile, hotSwapTimeoutMs);
    if (!lockCleared) {
      logger.warn(
        `[kasett-rewind:hotswap] Timed out waiting for session lock to clear for stub ${stubId} — stub remains`,
      );
      return;
    }

    if (signal?.aborted) {
      logger.debug('[kasett-rewind:hotswap] Aborted after lock wait');
      return;
    }

    // Step 3: Acquire the lock ourselves before rewriting
    let lockHandle;
    try {
      lockHandle = await acquireLock(sessionFile, { timeoutMs: hotSwapTimeoutMs });
    } catch (err) {
      logger.warn(`[kasett-rewind:hotswap] Could not acquire lock for swap: ${String(err)} — stub remains`);
      return;
    }

    try {
      // Step 4: Atomic file rewrite
      await performAtomicSwap({
        sessionFile,
        stubId,
        fullSummary,
        logger,
      });
    } finally {
      await lockHandle.release();
    }

    logger.info(`[kasett-rewind:hotswap] Hot-swap complete for stub ${stubId}`);
  } catch (err: unknown) {
    if (isAbortError(err)) {
      logger.debug(`[kasett-rewind:hotswap] Worker aborted for stub ${stubId}`);
      return;
    }
    logger.error(`[kasett-rewind:hotswap] Worker failed for stub ${stubId}: ${String(err)}`);
  }
}

/**
 * Perform the atomic JSONL rewrite.
 *
 * Reads the current JSONL, finds the stub entry by stubId, replaces its
 * summary field with `fullSummary`, writes to a temp file, then renames
 * atomically over the original.
 *
 * If the stub entry is not found (e.g., another compaction already fired),
 * the swap is silently aborted (stale result).
 */
async function performAtomicSwap(params: {
  sessionFile: string;
  stubId: string;
  fullSummary: string;
  logger: { debug(msg: string): void; warn(msg: string): void; info(msg: string): void };
}): Promise<void> {
  const { sessionFile, stubId, fullSummary, logger } = params;

  // Read current JSONL
  let rawContent: string;
  try {
    rawContent = await readFile(sessionFile, 'utf-8');
  } catch (err) {
    logger.warn(`[kasett-rewind:hotswap] Could not read session file for swap: ${String(err)}`);
    return;
  }

  const lines = rawContent.split('\n');
  let found = false;
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      newLines.push(line);
      continue;
    }

    // Try to parse as a compaction entry and check for our stub ID
    if (trimmed.includes('compaction') && trimmed.includes(stubId)) {
      try {
        const entry = JSON.parse(trimmed) as Record<string, unknown>;
        if (
          entry.type === 'compaction' &&
          typeof entry.data === 'object' &&
          entry.data !== null
        ) {
          const data = entry.data as Record<string, unknown>;
          if (typeof data.summary === 'string' && containsStubId(data.summary, stubId)) {
            // Replace the summary with the full LLM output
            data.summary = fullSummary;
            found = true;
            newLines.push(JSON.stringify(entry));
            continue;
          }
        }
      } catch {
        // Not valid JSON or not what we're looking for — keep as-is
      }
    }

    newLines.push(line);
  }

  if (!found) {
    // The stub entry is gone — another compaction fired and rewrote the file.
    // Discard the background result silently (it's stale).
    logger.debug(
      `[kasett-rewind:hotswap] Stub ${stubId} not found in JSONL — ` +
        'another compaction may have fired. Discarding stale result.',
    );
    return;
  }

  // Write to temp file, then rename atomically
  const tmpFile = `${sessionFile}.kasett-swap-tmp`;
  const newContent = newLines.join('\n');

  await writeFile(tmpFile, newContent, 'utf-8');
  await rename(tmpFile, sessionFile);

  logger.debug(`[kasett-rewind:hotswap] Atomic swap complete — stub ${stubId} replaced with full summary`);
}

/**
 * Check if a summary string contains the given stub ID marker.
 */
function containsStubId(summary: string, stubId: string): boolean {
  const match = summary.match(KASETT_STUB_REGEX);
  return match !== null && match[1] === stubId;
}

/**
 * Detect abort errors from various sources.
 */
function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === 'AbortError' ||
      err.message?.includes('aborted') ||
      err.message?.includes('abort')
    );
  }
  return false;
}
