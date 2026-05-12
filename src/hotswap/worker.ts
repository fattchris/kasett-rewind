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
import { basename, dirname } from 'node:path';
import { writeSidecarEntry, sidecarPathFor, readSidecar, type SidecarEntry } from '../storage/sidecar.js';
import { parseCompactionOutputBestEffort } from '../threads/parser.js';
import { detectCandidateKeyState } from '../keystate/detector.js';
import type { KeyStateEntry, ThreadMetaV2, ThreadMetaV3, ThreadSubV2 } from '../threads/schema.js';
import { matchAllThreads } from '../threads/identity.js';
import { detectLifecycleEvents, type LifecycleEvent } from '../threads/lifecycle.js';
import { appendGlobalRecord, readGlobalRecords } from '../global/index-writer.js';
import { findCanonicalThread } from '../global/matcher.js';
import { refreshSnapshot } from '../global/snapshot.js';
import type { GlobalThreadRecord } from '../global/types.js';

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
   * Agent identifier (e.g. "main", "alpha"). Used for the cross-session
   * global index records. When absent, global index writes are skipped
   * (per-session sidecar still works).
   */
  agentId?: string;
  /**
   * Human-readable topic/session name (e.g. "topic-20751"). Optional;
   * surfaces in cross-session orientation when present.
   */
  topicName?: string;
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
   *
   * `schemaVersion` indicates which parser produced the entry's thread meta:
   *   - 'v2' — LLM emitted valid v2 JSON (preferred path)
   *   - 'v1' — fell back to legacy [THREAD_META] markdown sentinel
   *   - 'none' — neither succeeded; entry written without parsed meta
   */
  onSidecarWritten?: (info: {
    sidecarPath: string;
    summaryChars: number;
    metaMain: string | null;
    schemaVersion: 'v1' | 'v2' | 'v3' | 'none';
    keyStateCount: number;
    keyStateDetectedCount: number;
  }) => void;
  /**
   * Optional callback invoked on sidecar pipeline failure (LLM empty, write
   * error, etc.). Mirrors onSidecarWritten for observability.
   */
  onSidecarFailed?: (info: { reason: string; detail?: string }) => void;
  /**
   * Optional callback invoked after a global-index write. Used by the hook
   * logger to track cross-session indexing health. Phase E.
   */
  onGlobalIndexed?: (info: {
    recordsWritten: number;
    threadsResolved: number;
  }) => void;
  /**
   * Optional callback invoked on global-index write failure. Failures here
   * MUST NOT block the per-session sidecar write. Phase E.
   */
  onGlobalIndexFailed?: (info: { reason: string; detail?: string }) => void;
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

    // Phase C: detect candidate key-state values from the conversation. The
    // detector is heuristic / advisory — result is stored on the sidecar so
    // KSSR measurement can compare detected vs preserved. We re-detect here
    // (rather than receive from the steering builder) so this stays robust
    // even if the steering hook didn't run.
    let keyStateCandidates: KeyStateEntry[] = [];
    try {
      keyStateCandidates = detectCandidateKeyState(
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
    } catch (e) {
      logger.debug(`[kasett-rewind:sidecar] keystate detector threw: ${String(e)}`);
      keyStateCandidates = [];
    }

    // Parse the LLM output to extract structured thread meta.
    //
    // Phase C: try v3 (v2 + optional key_state) first, then v2, then v1.
    // Records which schema produced the parse so the hook log can track
    // v1/v2/v3 distribution over time.
    const parsed = parseCompactionOutputBestEffort(fullSummary);
    const schemaVersion: 'v1' | 'v2' | 'v3' | 'none' = parsed.version;

    const keyStateCount = parsed.metaV3?.key_state?.length ?? 0;
    const keyStateDetectedCount = keyStateCandidates.length;

    if (schemaVersion === 'none' && parsed.errors.length > 0) {
      await diag(
        `PARSE_NONE stub=${stubId} v3_errors=${parsed.errors.slice(0, 2).join('; ').slice(0, 200)}`,
      );
    } else if (schemaVersion === 'v1') {
      await diag(`PARSE_V1_FALLBACK stub=${stubId} reason=${parsed.errors.slice(0, 1).join('|').slice(0, 150)}`);
    } else if (schemaVersion === 'v2') {
      await diag(`PARSE_V2 stub=${stubId} subs=${parsed.metaV2?.sub.length ?? 0}`);
    } else if (schemaVersion === 'v3') {
      await diag(
        `PARSE_V3 stub=${stubId} subs=${parsed.metaV3?.sub.length ?? 0} key_state=${keyStateCount} detected=${keyStateDetectedCount}`,
      );
    }

    const sessionId = basename(sessionFile, '.jsonl');
    const sidecarSchemaVersion: 'v1' | 'v2' | 'v3' =
      schemaVersion === 'v3' ? 'v3' : schemaVersion === 'v2' ? 'v2' : 'v1';

    // Phase D — lifecycle event detection against the previous compaction.
    // Advisory only: failure here MUST NOT stop the sidecar write.
    let lifecycleEvents: LifecycleEvent[] | undefined;
    try {
      const currentMeta: ThreadMetaV3 | ThreadMetaV2 | undefined =
        parsed.metaV3 ?? parsed.metaV2 ?? undefined;
      if (currentMeta && currentMeta.sub.length > 0) {
        const existing = readSidecar(sessionFile);
        let prevMeta: ThreadMetaV3 | ThreadMetaV2 | undefined;
        for (let i = existing.length - 1; i >= 0; i--) {
          const e = existing[i];
          if (e.thread_meta_v3) {
            prevMeta = e.thread_meta_v3;
            break;
          }
          if (e.thread_meta_v2) {
            prevMeta = e.thread_meta_v2;
            break;
          }
        }
        if (prevMeta && prevMeta.sub.length > 0) {
          const matches = matchAllThreads(currentMeta.sub, prevMeta.sub);
          const events = detectLifecycleEvents(
            prevMeta.sub,
            currentMeta.sub,
            matches,
          );
          if (events.length > 0) lifecycleEvents = events;
        }
      }
    } catch (err) {
      // Advisory — swallow and log only.
      await diag(
        `LIFECYCLE_DETECT_FAIL stub=${stubId} err=${String(err).slice(0, 200)}`,
      );
    }

    const entry: SidecarEntry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      compaction_id: stubId,
      stub_id: stubId,
      summary_rich: fullSummary,
      summary_chars: fullSummary.length,
      schema_version: sidecarSchemaVersion,
      ...(parsed.metaV1 ? { thread_meta: parsed.metaV1 } : {}),
      ...(parsed.metaV2 ? { thread_meta_v2: parsed.metaV2 } : {}),
      ...(parsed.metaV3 ? { thread_meta_v3: parsed.metaV3 } : {}),
      ...(keyStateCandidates.length > 0
        ? { key_state_candidates: keyStateCandidates }
        : {}),
      ...(lifecycleEvents ? { lifecycle_events: lifecycleEvents } : {}),
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

    const metaMain =
      parsed.metaV3?.main ?? parsed.metaV2?.main ?? parsed.metaV1?.main ?? null;
    logger.info(
      `[kasett-rewind:sidecar] Sidecar entry written for stub ${stubId} (${fullSummary.length} chars, schema=${schemaVersion}, meta_main=${metaMain ?? 'null'}, key_state=${keyStateCount}/${keyStateDetectedCount})`,
    );
    await diag(
      `SIDECAR_WRITTEN stub=${stubId} path=${sidecarPath} chars=${fullSummary.length} schema=${schemaVersion} meta_main=${metaMain ?? 'null'} key_state=${keyStateCount} detected=${keyStateDetectedCount}`,
    );
    onSidecarWritten?.({
      sidecarPath,
      summaryChars: fullSummary.length,
      metaMain,
      schemaVersion,
      keyStateCount,
      keyStateDetectedCount,
    });

    // Phase E: cross-session global index. Best-effort; never blocks the
    // per-session sidecar (which has already been written above).
    if (params.agentId) {
      try {
        const sessionsDir = dirname(sessionFile);
        const agentRoot = dirname(sessionsDir); // .../agents/<agent>/
        const currentMeta: ThreadMetaV3 | ThreadMetaV2 | undefined =
          parsed.metaV3 ?? parsed.metaV2 ?? undefined;

        let recordsWritten = 0;
        let threadsResolved = 0;

        if (currentMeta && currentMeta.sub.length > 0) {
          const existingRecords = readGlobalRecords(agentRoot);
          const ts = entry.ts;

          // Sub-threads first.
          const recordsForThisCompaction: GlobalThreadRecord[] = [];
          for (const sub of currentMeta.sub as ReadonlyArray<ThreadSubV2>) {
            const candidate = { thread_id: sub.id, label: sub.label };
            const seedRecords = [
              ...existingRecords,
              ...recordsForThisCompaction,
            ];
            const m = findCanonicalThread(candidate, seedRecords);
            const canonical = m.canonical_id ?? sub.id;
            const tsFirstSeen =
              m.contributing_record?.ts_first_seen ??
              m.contributing_record?.ts;
            if (m.canonical_id) threadsResolved += 1;

            const rec: GlobalThreadRecord = {
              ts,
              agent_id: params.agentId,
              session_id: sessionId,
              ...(params.topicName ? { topic_name: params.topicName } : {}),
              thread_id: sub.id,
              canonical_id: canonical,
              label: sub.label,
              status: sub.status,
              schema_version: sidecarSchemaVersion,
              ...(tsFirstSeen ? { ts_first_seen: tsFirstSeen } : {}),
            };
            const result = appendGlobalRecord(agentRoot, rec);
            if (result.written) {
              recordsWritten += 1;
              recordsForThisCompaction.push(rec);
            } else {
              await diag(
                `GLOBAL_INDEX_FAIL stub=${stubId} reason=${result.error ?? 'unknown'}`,
              );
            }
          }

          // Main thread as a synthetic record (is_main=true). Lifts the
          // session's `main` into cross-session visibility.
          if (currentMeta.main) {
            const mainCandidate = {
              thread_id: `${sessionId}::main`,
              label: currentMeta.main,
            };
            const m = findCanonicalThread(
              mainCandidate,
              [...existingRecords, ...recordsForThisCompaction],
            );
            const canonical = m.canonical_id ?? mainCandidate.thread_id;
            const tsFirstSeen =
              m.contributing_record?.ts_first_seen ??
              m.contributing_record?.ts;
            const rec: GlobalThreadRecord = {
              ts,
              agent_id: params.agentId,
              session_id: sessionId,
              ...(params.topicName ? { topic_name: params.topicName } : {}),
              thread_id: mainCandidate.thread_id,
              canonical_id: canonical,
              label: currentMeta.main,
              status: 'active',
              schema_version: sidecarSchemaVersion,
              is_main: true,
              ...(tsFirstSeen ? { ts_first_seen: tsFirstSeen } : {}),
            };
            const result = appendGlobalRecord(agentRoot, rec);
            if (result.written) {
              recordsWritten += 1;
              if (m.canonical_id) threadsResolved += 1;
            } else {
              await diag(
                `GLOBAL_INDEX_FAIL stub=${stubId} reason=${result.error ?? 'unknown'} (main)`,
              );
            }
          }

          // Refresh the snapshot so cross-session orientation reads see the
          // new state. This is not on the hot path of the agent's response
          // (we're already past the stub return), so the cost is acceptable.
          if (recordsWritten > 0) {
            try {
              refreshSnapshot(agentRoot);
            } catch (err) {
              await diag(
                `GLOBAL_SNAPSHOT_FAIL stub=${stubId} err=${String(err).slice(0, 150)}`,
              );
            }
          }
        }

        await diag(
          `GLOBAL_INDEX_WRITTEN stub=${stubId} records=${recordsWritten} resolved=${threadsResolved}`,
        );
        params.onGlobalIndexed?.({
          recordsWritten,
          threadsResolved,
        });
      } catch (err) {
        await diag(
          `GLOBAL_INDEX_ERROR stub=${stubId} err=${String(err).slice(0, 200)}`,
        );
        params.onGlobalIndexFailed?.({
          reason: 'global_index_threw',
          detail: String(err).slice(0, 200),
        });
      }
    }
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
