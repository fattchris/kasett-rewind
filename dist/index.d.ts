/**
 * kasett-rewind — OpenClaw CompactionProvider + orientation hook
 *
 * ## Architecture (OC 4.14+)
 *
 * ### CompactionProvider (`api.registerCompactionProvider`)
 *   OC calls `summarize()` instead of its built-in LLM pipeline when
 *   `session.compaction.provider: "kasett-rewind"` is set in openclaw.json.
 *
 *   `summarize()` receives:
 *     { messages, signal, customInstructions, summarizationInstructions, previousSummary }
 *
 *   `summarize()` must return a string (the compaction summary).
 *
 *   The compaction provider:
 *     a. Reads the last N summaries from the session JSONL (oldest→newest)
 *     b. Pairs them with temporal decay weights (most recent = highest weight)
 *     c. Builds a weighted steering prompt (buildSteeringPrompt)
 *     d. Calls the LLM with the messages + steering
 *     e. Returns the full output (including [THREAD_META]) to OC for storage
 *
 * ### Hot-swap compaction (default, config.hotSwap = true)
 *   Instead of blocking on the LLM call, summarize() returns a stub immediately
 *   (zero LLM delay). The stub contains a [KASETT_STUB::<id>] marker and the
 *   previous [THREAD_META] for minimal orientation. A background worker then
 *   runs the full LLM summarization and atomically rewrites the JSONL entry
 *   during the next inter-turn gap, replacing the stub with the rich summary.
 *
 * ### before_prompt_build hook (MODIFYING)
 *   Fires on every normal agent turn. Reads the last N compaction summaries
 *   (up to windowSize) from the session JSONL, parses [THREAD_META] from each,
 *   and injects a thread trajectory orientation string via { prependContext }.
 *   Shows current thread state + historical trajectory (most-recent-first).
 *   Light — just thread names, no full summaries, no weights.
 *
 *   No sidecar file is used. Thread meta lives inside the compaction summaries
 *   themselves, stored by OC in the session JSONL.
 *
 * ## Key principles
 *   - **Steering (every turn):** before_prompt_build reads last N summaries,
 *     extracts [THREAD_META] from each, shows thread trajectory as orientation.
 *     Light, constant presence. No weights, no full summaries.
 *   - **Blending (compaction only):** summarize() reads last N full summaries,
 *     weights them by recency, feeds them to the LLM for a new summary.
 *     Heavy, runs only when OC triggers compaction.
 *   - These are two SEPARATE concerns — no cross-contamination.
 */
interface SessionStoreEntry {
    sessionId?: string;
    sessionFile?: string;
    updatedAt?: number;
    [key: string]: unknown;
}
interface PluginAPI {
    id: string;
    name: string;
    version: string;
    description: string;
    source: string;
    rootDir: string;
    pluginConfig: Record<string, unknown>;
    /**
     * Plugin registration mode. OC calls register() in multiple modes:
     *   - "full"           — real activation; install hooks and register providers
     *   - "cli-metadata"   — periodic CLI/metadata discovery; OC rolls back any
     *                         registry mutations afterwards. Plugins should NOT
     *                         install hooks or providers in this mode.
     *   - "tool-discovery" — tool inventory pass; same caveats as cli-metadata.
     *   - "discovery"      — channel/contract discovery pass.
     *
     * Plugins that ignore this and always register cause noisy log churn
     * (and can confuse operators trying to debug provider lifecycle).
     */
    registrationMode?: 'full' | 'cli-metadata' | 'tool-discovery' | 'discovery' | string;
    logger: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
        debug(msg: string): void;
    };
    on(hookName: string, handler: (...args: any[]) => any, opts?: unknown): void;
    registerCompactionProvider(provider: CompactionProvider): void;
    runtime: {
        agent: {
            session: {
                resolveStorePath(store: unknown, opts?: {
                    agentId?: string;
                }): string;
                loadSessionStore(storePath: string): Record<string, SessionStoreEntry>;
            };
        };
        state: {
            resolveStateDir(): string;
        };
    };
    config: Record<string, unknown>;
}
/**
 * CompactionProvider interface — matches what OC expects.
 * Source: loader-DYJR63Q1.js registerCompactionProvider, model-context-tokens-CwcLB3PA.js tryProviderSummarize
 */
interface CompactionProvider {
    id: string;
    summarize(params: SummarizeParams): Promise<string | undefined>;
}
/**
 * Params passed to summarize() by OC.
 * Source: model-context-tokens-CwcLB3PA.js compactionSafeguardExtension, tryProviderSummarize
 */
interface SummarizeParams {
    /** Conversation messages to summarize (OpenAI role/content format) */
    messages: Array<{
        role: string;
        content: unknown;
    }>;
    /** AbortSignal — must be respected for cancellation */
    signal?: AbortSignal;
    /** Combined custom + structure instructions from OC config */
    customInstructions?: string;
    /** Identifier policy configuration */
    summarizationInstructions?: {
        identifierPolicy?: string;
        identifierInstructions?: string;
    };
    /** Previous compaction summary for continuity (provided by OC) */
    previousSummary?: string;
}
export declare function register(api: PluginAPI): void;
export { SessionReader, KasettError } from './storage/reader.js';
export { weightSummaries } from './threads/weight.js';
export type { WeightedSummary } from './threads/weight.js';
export { buildSteeringPrompt, buildOrientationPrompt } from './threads/steering.js';
export { parseCompactionOutput } from './threads/parser.js';
export type { ParseResult } from './threads/parser.js';
export { emptyThreadMeta, isValidThreadMeta } from './threads/meta.js';
export { CompactionWindow } from './compaction/window.js';
export { generateConfig } from './cli/generate-config.js';
export type { GenerateConfigOptions } from './cli/generate-config.js';
export { generateStub } from './hotswap/stub.js';
export { runHotSwapWorker } from './hotswap/worker.js';
export { acquireLock, waitForLockAbsent } from './hotswap/lock.js';
export { writeSidecarEntry, readSidecar, findEntryForCompaction, sidecarPathFor, sidecarExists, } from './storage/sidecar.js';
export type { SidecarEntry } from './storage/sidecar.js';
export type { KasettConfig, CompactionEvent, ThreadMeta, ConversationTurn, } from './types.js';
export { DEFAULT_CONFIG } from './types.js';
//# sourceMappingURL=index.d.ts.map