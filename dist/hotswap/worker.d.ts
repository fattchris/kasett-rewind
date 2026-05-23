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
     * Maximum output tokens for the compaction LLM call. Phase F: defaults
     * to 32000 in the resolved config; Sonnet 4.5 supports up to 64k.
     * Truncation around 14k chars (Phase F live evidence) breaks the
     * structured JSON output, so we want comfortable headroom here.
     */
    compactionMaxTokens?: number;
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
    onSidecarFailed?: (info: {
        reason: string;
        detail?: string;
    }) => void;
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
    onGlobalIndexFailed?: (info: {
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
    /** Maximum output tokens; forwarded to the LLM provider. Phase F. */
    maxTokens?: number;
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
 * Minimal hook event shape used for JSONL rewrite observability.
 * Mirrors the HookEvent interface in index.ts (kept local to avoid circular deps).
 */
export interface HookEvent {
    ts?: string;
    hook?: string;
    action: string;
    detail?: Record<string, unknown>;
}
/**
 * After the sidecar is written, scan the parent JSONL for a compaction record
 * whose summary field contains `[KASETT_STUB::<stubId>]` and atomically
 * replace it with `richSummary`. Handles both:
 *   - Top-level `summary` field: `{ type: "compaction", summary: "..." }`
 *   - Nested `data.summary` field: `{ type: "compaction", data: { summary: "..." } }`
 *
 * Writes to `<jsonlPath>.kasett-rewrite.tmp` then renames atomically.
 *
 * Edge cases:
 *   - Empty richSummary → STUB_REWRITE_SKIP empty_sidecar, return early
 *   - Stub not found → STUB_REWRITE_NOT_FOUND, return early
 *   - Multiple stubs → all replaced
 *   - File read/write error → logged, returned as { ok: false }
 */
export declare function rewriteJsonlStub(jsonlPath: string, stubId: string, richSummary: string, logger: {
    info(msg: string): void;
    warn(msg: string): void;
    debug(msg: string): void;
}, hookEmitter: (event: HookEvent) => void): Promise<{
    ok: boolean;
    reason?: string;
    bytesWritten?: number;
}>;
/**
 * Re-export for back-compat: the sidecar path helper.
 * Some integration code references this from the worker module.
 */
export { sidecarPathFor };
//# sourceMappingURL=worker.d.ts.map