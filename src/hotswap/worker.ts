/**
 * worker.ts — Background LLM call + sidecar write logic.
 *
 * After summarize() returns the stub immediately, this module runs the FULL
 * LLM summarization in the background, then appends the rich summary to the
 * session's sidecar file (`<session>.jsonl.kasett-meta.jsonl`).
 *
 * ## Why a sidecar (vs. atomic JSONL rewrite)
 *
 * The previous design called `waitForLockAbsent(sessionFile, 30_000ms)` then
 * `acquireLock` to perform an atomic rewrite of the OC session JSONL. In
 * production this failed on every active session — OC holds the session
 * write lock continuously while the user keeps working, so no 30s gap ever
 * opens. Production compliance was 0% over 7 days (Phase A finding).
 *
 * The sidecar lives next to the session file and is written by kasett ONLY.
 * Append-only — no rewrites — POSIX `O_APPEND` is atomic for short writes,
 * and we never have concurrent writers anyway. We never fight OC's lock.
 *
 * The OC-stored stub remains in place in the JSONL. Reads prefer the sidecar
 * (rich), fall back to the JSONL for legacy entries.
 */

import { appendFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { writeSidecarEntry, sidecarPathFor, type SidecarEntry } from '../storage/sidecar.js';
import { parseCompactionOutput } from '../threads/parser.js';

export interface WorkerParams {
  /** Absolute path to the session `.jsonl` file. The sidecar is derived from this. */
  sessionFile: string;
  /** The stub ID — used as compaction_id in the sidecar entry */
  stubId: string;
  /** Messages passed to summarize() — forwarded to the LLM */
  messages: Array<{ role: string; content: unknown }>;
  /** Previous summary text for continuity blending (currently unused at this layer) */
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
   * Maximum time (ms) to wait for the session lock to be absent. Retained for
   * backward compatibility with config; the sidecar path does NOT need it.
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
  /**
   * Optional callback invoked after a successful sidecar write. Used by the
   * Phase A hook logger to record success/failure of the sidecar pipeline.
   */
  onSidecarWritten?: (info: {
    sidecarPath: string;
    summaryChars: number;
    metaMain: string | null;
  }) => void;
  /**
   * Optional callback invoked on sidecar pipeline failure (LLM empty, write
   * error, etc.). Mirrors onSidecarWritten for observability.
   */
  onSidecarFailed?: (info: { reason: string; detail?: string }) => void;
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

const DIAG_LOG = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/hotswap-diag.log';

async function diag(msg: string): Promise<void> {
  const ts = new Date().toISOString();
  await appendFile(DIAG_LOG, `[${ts}] ${msg}\n`).catch(() => {});
}

/**
 * Run the background sidecar pipeline.
 *
 * Fire-and-forget — call WITHOUT await from summarize() so the stub is
 * returned to OC first. All errors are logged and swallowed.
 */
export async function runHotSwapWorker(params: WorkerParams): Promise<void> {
  const {
    sessionFile,
    stubId,
    messages,
    steeringPrompt,
    customInstructions,
    signal,
    compactionModel,
    logger,
    callLLM,
    onSidecarWritten,
    onSidecarFailed,
  } = params;

  try {
    logger.debug(`[kasett-rewind:sidecar] Background worker started for stub ${stubId}`);
    await diag(`WORKER_START stub=${stubId} sessionFile=${sessionFile} signal_aborted=${signal?.aborted}`);

    if (signal?.aborted) {
      logger.debug('[kasett-rewind:sidecar] Aborted before LLM call');
      await diag(`ABORT_BEFORE_LLM stub=${stubId}`);
      onSidecarFailed?.({ reason: 'aborted_before_llm' });
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
      logger.warn(
        `[kasett-rewind:sidecar] LLM returned empty summary for stub ${stubId} — sidecar not written`,
      );
      await diag(`LLM_EMPTY stub=${stubId}`);
      onSidecarFailed?.({ reason: 'llm_empty' });
      return;
    }
    await diag(`LLM_DONE stub=${stubId} summary_len=${fullSummary.length}`);

    if (signal?.aborted) {
      logger.debug('[kasett-rewind:sidecar] Aborted after LLM call');
      await diag(`ABORT_AFTER_LLM stub=${stubId}`);
      onSidecarFailed?.({ reason: 'aborted_after_llm' });
      return;
    }

    // Parse the LLM output to extract structured thread meta.
    // The summary text itself is stored verbatim in `summary_rich`; the
    // parsed meta is denormalized into `thread_meta` for cheap reads.
    const parsed = parseCompactionOutput(fullSummary);

    const sessionId = basename(sessionFile, '.jsonl');
    const entry: SidecarEntry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      compaction_id: stubId,
      stub_id: stubId,
      summary_rich: fullSummary,
      summary_chars: fullSummary.length,
      ...(parsed.meta ? { thread_meta: parsed.meta } : {}),
      ...(compactionModel ? { model: compactionModel } : {}),
    };

    let sidecarPath: string;
    try {
      sidecarPath = writeSidecarEntry(sessionFile, entry);
    } catch (err) {
      logger.error(
        `[kasett-rewind:sidecar] Sidecar write failed for stub ${stubId}: ${String(err)}`,
      );
      await diag(`SIDECAR_WRITE_FAIL stub=${stubId} err=${String(err).slice(0, 200)}`);
      onSidecarFailed?.({ reason: 'write_failed', detail: String(err).slice(0, 200) });
      return;
    }

    logger.info(
      `[kasett-rewind:sidecar] Sidecar entry written for stub ${stubId} (${fullSummary.length} chars, meta_main=${parsed.meta?.main ?? 'null'})`,
    );
    await diag(
      `SIDECAR_WRITTEN stub=${stubId} path=${sidecarPath} chars=${fullSummary.length} meta_main=${parsed.meta?.main ?? 'null'}`,
    );
    onSidecarWritten?.({
      sidecarPath,
      summaryChars: fullSummary.length,
      metaMain: parsed.meta?.main ?? null,
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      logger.debug(`[kasett-rewind:sidecar] Worker aborted for stub ${stubId}`);
      await diag(`ABORT_ERROR stub=${stubId} err=${String(err)}`);
      onSidecarFailed?.({ reason: 'aborted' });
      return;
    }
    logger.error(`[kasett-rewind:sidecar] Worker failed for stub ${stubId}: ${String(err)}`);
    await diag(`WORKER_ERROR stub=${stubId} err=${String(err)}`);
    onSidecarFailed?.({ reason: 'worker_error', detail: String(err).slice(0, 200) });
  }
}

/**
 * Re-export for back-compat: the sidecar path helper.
 * Some integration code references this from the worker module.
 */
export { sidecarPathFor };

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
