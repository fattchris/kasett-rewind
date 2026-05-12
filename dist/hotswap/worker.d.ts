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
import { sidecarPathFor } from '../storage/sidecar.js';
export interface WorkerParams {
    /** Absolute path to the session `.jsonl` file. The sidecar is derived from this. */
    sessionFile: string;
    /** The stub ID — used as compaction_id in the sidecar entry */
    stubId: string;
    /** Messages passed to summarize() — forwarded to the LLM */
    messages: Array<{
        role: string;
        content: unknown;
    }>;
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
        schemaVersion: 'v1' | 'v2' | 'none';
    }) => void;
    /**
     * Optional callback invoked on sidecar pipeline failure (LLM empty, write
     * error, etc.). Mirrors onSidecarWritten for observability.
     */
    onSidecarFailed?: (info: {
        reason: string;
        detail?: string;
    }) => void;
}
export interface CallLLMParams {
    messages: Array<{
        role: string;
        content: unknown;
    }>;
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
 * Run the background sidecar pipeline.
 *
 * Fire-and-forget — call WITHOUT await from summarize() so the stub is
 * returned to OC first. All errors are logged and swallowed.
 */
export declare function runHotSwapWorker(params: WorkerParams): Promise<void>;
/**
 * Re-export for back-compat: the sidecar path helper.
 * Some integration code references this from the worker module.
 */
export { sidecarPathFor };
//# sourceMappingURL=worker.d.ts.map