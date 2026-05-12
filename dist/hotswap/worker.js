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
import { writeSidecarEntry, sidecarPathFor, readSidecar } from '../storage/sidecar.js';
import { parseCompactionOutputBestEffort } from '../threads/parser.js';
import { detectCandidateKeyState } from '../keystate/detector.js';
import { matchAllThreads } from '../threads/identity.js';
import { detectLifecycleEvents } from '../threads/lifecycle.js';
const DIAG_LOG = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/hotswap-diag.log';
async function diag(msg) {
    const ts = new Date().toISOString();
    await appendFile(DIAG_LOG, `[${ts}] ${msg}\n`).catch(() => { });
}
/**
 * Run the background sidecar pipeline.
 *
 * Fire-and-forget — call WITHOUT await from summarize() so the stub is
 * returned to OC first. All errors are logged and swallowed.
 */
export async function runHotSwapWorker(params) {
    const { sessionFile, stubId, messages, steeringPrompt, customInstructions, signal, compactionModel, logger, callLLM, onSidecarWritten, onSidecarFailed, } = params;
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
            logger.warn(`[kasett-rewind:sidecar] LLM returned empty summary for stub ${stubId} — sidecar not written`);
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
        let keyStateCandidates = [];
        try {
            keyStateCandidates = detectCandidateKeyState(messages.map((m) => ({ role: m.role, content: m.content })));
        }
        catch (e) {
            logger.debug(`[kasett-rewind:sidecar] keystate detector threw: ${String(e)}`);
            keyStateCandidates = [];
        }
        // Parse the LLM output to extract structured thread meta.
        //
        // Phase C: try v3 (v2 + optional key_state) first, then v2, then v1.
        // Records which schema produced the parse so the hook log can track
        // v1/v2/v3 distribution over time.
        const parsed = parseCompactionOutputBestEffort(fullSummary);
        const schemaVersion = parsed.version;
        const keyStateCount = parsed.metaV3?.key_state?.length ?? 0;
        const keyStateDetectedCount = keyStateCandidates.length;
        if (schemaVersion === 'none' && parsed.errors.length > 0) {
            await diag(`PARSE_NONE stub=${stubId} v3_errors=${parsed.errors.slice(0, 2).join('; ').slice(0, 200)}`);
        }
        else if (schemaVersion === 'v1') {
            await diag(`PARSE_V1_FALLBACK stub=${stubId} reason=${parsed.errors.slice(0, 1).join('|').slice(0, 150)}`);
        }
        else if (schemaVersion === 'v2') {
            await diag(`PARSE_V2 stub=${stubId} subs=${parsed.metaV2?.sub.length ?? 0}`);
        }
        else if (schemaVersion === 'v3') {
            await diag(`PARSE_V3 stub=${stubId} subs=${parsed.metaV3?.sub.length ?? 0} key_state=${keyStateCount} detected=${keyStateDetectedCount}`);
        }
        const sessionId = basename(sessionFile, '.jsonl');
        const sidecarSchemaVersion = schemaVersion === 'v3' ? 'v3' : schemaVersion === 'v2' ? 'v2' : 'v1';
        // Phase D — lifecycle event detection against the previous compaction.
        // Advisory only: failure here MUST NOT stop the sidecar write.
        let lifecycleEvents;
        try {
            const currentMeta = parsed.metaV3 ?? parsed.metaV2 ?? undefined;
            if (currentMeta && currentMeta.sub.length > 0) {
                const existing = readSidecar(sessionFile);
                let prevMeta;
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
                    const events = detectLifecycleEvents(prevMeta.sub, currentMeta.sub, matches);
                    if (events.length > 0)
                        lifecycleEvents = events;
                }
            }
        }
        catch (err) {
            // Advisory — swallow and log only.
            await diag(`LIFECYCLE_DETECT_FAIL stub=${stubId} err=${String(err).slice(0, 200)}`);
        }
        const entry = {
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
        let sidecarPath;
        try {
            sidecarPath = writeSidecarEntry(sessionFile, entry);
        }
        catch (err) {
            logger.error(`[kasett-rewind:sidecar] Sidecar write failed for stub ${stubId}: ${String(err)}`);
            await diag(`SIDECAR_WRITE_FAIL stub=${stubId} err=${String(err).slice(0, 200)}`);
            onSidecarFailed?.({ reason: 'write_failed', detail: String(err).slice(0, 200) });
            return;
        }
        const metaMain = parsed.metaV3?.main ?? parsed.metaV2?.main ?? parsed.metaV1?.main ?? null;
        logger.info(`[kasett-rewind:sidecar] Sidecar entry written for stub ${stubId} (${fullSummary.length} chars, schema=${schemaVersion}, meta_main=${metaMain ?? 'null'}, key_state=${keyStateCount}/${keyStateDetectedCount})`);
        await diag(`SIDECAR_WRITTEN stub=${stubId} path=${sidecarPath} chars=${fullSummary.length} schema=${schemaVersion} meta_main=${metaMain ?? 'null'} key_state=${keyStateCount} detected=${keyStateDetectedCount}`);
        onSidecarWritten?.({
            sidecarPath,
            summaryChars: fullSummary.length,
            metaMain,
            schemaVersion,
            keyStateCount,
            keyStateDetectedCount,
        });
    }
    catch (err) {
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
function isAbortError(err) {
    if (err instanceof Error) {
        return (err.name === 'AbortError' ||
            err.message?.includes('aborted') ||
            err.message?.includes('abort'));
    }
    return false;
}
//# sourceMappingURL=worker.js.map