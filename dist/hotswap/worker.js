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
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { acquireLock, waitForLockAbsent } from './lock.js';
import { KASETT_STUB_REGEX } from './constants.js';
/**
 * Run the hot-swap background pipeline.
 *
 * This function is fire-and-forget — it should be called WITHOUT await
 * from summarize() so it runs after the stub has been returned to OC.
 *
 * All errors are caught and logged; they never propagate to the caller.
 */
const DIAG_LOG = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/hotswap-diag.log';
async function diag(msg) {
    const ts = new Date().toISOString();
    await appendFile(DIAG_LOG, `[${ts}] ${msg}\n`).catch(() => { });
}
export async function runHotSwapWorker(params) {
    const { sessionFile, stubId, messages, previousSummaries, steeringPrompt, customInstructions, signal, compactionModel, hotSwapTimeoutMs = 30_000, logger, callLLM, } = params;
    try {
        logger.debug(`[kasett-rewind:hotswap] Background worker started for stub ${stubId}`);
        await diag(`WORKER_START stub=${stubId} sessionFile=${sessionFile} signal_aborted=${signal?.aborted}`);
        // Step 1: Call the LLM for the full summary
        if (signal?.aborted) {
            logger.debug('[kasett-rewind:hotswap] Aborted before LLM call');
            await diag(`ABORT_BEFORE_LLM stub=${stubId}`);
            return;
        }
        await diag(`LLM_CALL_START stub=${stubId} model=${compactionModel}`);
        const fullSummary = await callLLM({
            messages,
            signal,
            customInstructions,
            steeringPrompt,
            compactionModel,
            logger,
        });
        if (!fullSummary) {
            logger.warn(`[kasett-rewind:hotswap] LLM returned empty summary for stub ${stubId} — stub remains in place`);
            await diag(`LLM_EMPTY stub=${stubId}`);
            return;
        }
        await diag(`LLM_DONE stub=${stubId} summary_len=${fullSummary.length}`);
        if (signal?.aborted) {
            logger.debug('[kasett-rewind:hotswap] Aborted after LLM call, before file swap');
            return;
        }
        // Step 2: Wait for the inter-turn gap (lock file absent)
        logger.debug(`[kasett-rewind:hotswap] LLM done. Waiting for inter-turn gap (timeout: ${hotSwapTimeoutMs}ms)`);
        const lockCleared = await waitForLockAbsent(sessionFile, hotSwapTimeoutMs);
        if (!lockCleared) {
            logger.warn(`[kasett-rewind:hotswap] Timed out waiting for session lock to clear for stub ${stubId} — stub remains`);
            await diag(`LOCK_WAIT_TIMEOUT stub=${stubId} timeoutMs=${hotSwapTimeoutMs}`);
            return;
        }
        if (signal?.aborted) {
            logger.debug('[kasett-rewind:hotswap] Aborted after lock wait');
            await diag(`ABORT_AFTER_LOCK_WAIT stub=${stubId}`);
            return;
        }
        // Step 3: Acquire the lock ourselves before rewriting
        let lockHandle;
        try {
            lockHandle = await acquireLock(sessionFile, { timeoutMs: hotSwapTimeoutMs });
        }
        catch (err) {
            logger.warn(`[kasett-rewind:hotswap] Could not acquire lock for swap: ${String(err)} — stub remains`);
            await diag(`LOCK_ACQUIRE_FAIL stub=${stubId} err=${String(err).slice(0, 200)}`);
            return;
        }
        try {
            // Step 4: Atomic file rewrite
            await performAtomicSwap({
                sessionFile,
                stubId,
                fullSummary,
                logger,
                diag,
            });
        }
        finally {
            await lockHandle.release();
        }
        logger.info(`[kasett-rewind:hotswap] Hot-swap complete for stub ${stubId}`);
        await diag(`SWAP_COMPLETE stub=${stubId}`);
    }
    catch (err) {
        if (isAbortError(err)) {
            logger.debug(`[kasett-rewind:hotswap] Worker aborted for stub ${stubId}`);
            await diag(`ABORT_ERROR stub=${stubId} err=${String(err)}`);
            return;
        }
        logger.error(`[kasett-rewind:hotswap] Worker failed for stub ${stubId}: ${String(err)}`);
        await diag(`WORKER_ERROR stub=${stubId} err=${String(err)}`);
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
async function performAtomicSwap(params) {
    const { sessionFile, stubId, fullSummary, logger, diag } = params;
    // Read current JSONL
    let rawContent;
    try {
        rawContent = await readFile(sessionFile, 'utf-8');
    }
    catch (err) {
        logger.warn(`[kasett-rewind:hotswap] Could not read session file for swap: ${String(err)}`);
        return;
    }
    const lines = rawContent.split('\n');
    let found = false;
    const newLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            newLines.push(line);
            continue;
        }
        // Try to parse as a compaction entry and check for our stub ID
        if (trimmed.includes('compaction') && trimmed.includes(stubId)) {
            try {
                const entry = JSON.parse(trimmed);
                if (entry.type === 'compaction' &&
                    typeof entry.data === 'object' &&
                    entry.data !== null) {
                    const data = entry.data;
                    if (typeof data.summary === 'string' && containsStubId(data.summary, stubId)) {
                        // Replace the summary with the full LLM output
                        data.summary = fullSummary;
                        found = true;
                        newLines.push(JSON.stringify(entry));
                        continue;
                    }
                }
            }
            catch {
                // Not valid JSON or not what we're looking for — keep as-is
            }
        }
        newLines.push(line);
    }
    if (!found) {
        // The stub entry is gone — another compaction fired and rewrote the file.
        // Discard the background result (it's stale).
        logger.debug(`[kasett-rewind:hotswap] Stub ${stubId} not found in JSONL — ` +
            'another compaction may have fired. Discarding stale result.');
        await diag(`STUB_NOT_FOUND stub=${stubId} lines_scanned=${lines.length}`);
        return;
    }
    // Write to temp file, then rename atomically
    const tmpFile = `${sessionFile}.kasett-swap-tmp`;
    const newContent = newLines.join('\n');
    await diag(`ATOMIC_SWAP_START stub=${stubId} lines=${lines.length}`);
    try {
        await writeFile(tmpFile, newContent, 'utf-8');
        await rename(tmpFile, sessionFile);
    }
    catch (err) {
        await diag(`ATOMIC_SWAP_ERROR stub=${stubId} err=${String(err).slice(0, 200)}`);
        throw err;
    }
    logger.debug(`[kasett-rewind:hotswap] Atomic swap complete — stub ${stubId} replaced with full summary`);
}
/**
 * Check if a summary string contains the given stub ID marker.
 */
function containsStubId(summary, stubId) {
    const match = summary.match(KASETT_STUB_REGEX);
    return match !== null && match[1] === stubId;
}
/**
 * Detect abort errors from various sources.
 */
function isAbortError(err) {
    if (err instanceof Error) {
        return (err.name === 'AbortError' ||
            err.message?.includes('aborted') ||
            err.message?.includes('abort'));
    }
    return false;
}
//# sourceMappingURL=worker.js.map