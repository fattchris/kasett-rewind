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

import { join } from 'node:path';
import { readdir, appendFile } from 'node:fs/promises';
import { SessionReader, KasettError } from './storage/reader.js';
import { weightSummaries } from './threads/weight.js';
import { buildSteeringPrompt, buildOrientationPrompt } from './threads/steering.js';
import { parseCompactionOutput, parseCompactionOutputBestEffort } from './threads/parser.js';
import { generateStub } from './hotswap/stub.js';
import { runHotSwapWorker } from './hotswap/worker.js';
import { detectCandidateKeyState } from './keystate/detector.js';
import type { KeyStateEntry } from './threads/schema.js';
import type { LifecycleEvent } from './threads/lifecycle.js';
import type { KasettConfig, ThreadMeta } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// OC Plugin hook event types (verified from OC 4.14 source)
// ---------------------------------------------------------------------------

interface BeforePromptBuildEvent {
  prompt: string;
  messages: unknown[];
}

interface BeforePromptBuildResult {
  prependContext?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
  systemPrompt?: string;
}

interface BeforeCompactionEvent {
  messageCount: number;
  tokenCount?: number;
  sessionFile?: string;
  messages?: unknown[];
}

interface AfterCompactionEvent {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
  sessionFile?: string;
}

interface HookContext {
  sessionId: string;
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
  runId?: string;
  modelProviderId?: string;
  modelId?: string;
  trigger?: string;
  channelId?: string;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(hookName: string, handler: (...args: any[]) => any, opts?: unknown): void;
  registerCompactionProvider(provider: CompactionProvider): void;
  runtime: {
    agent: {
      session: {
        resolveStorePath(store: unknown, opts?: { agentId?: string }): string;
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
  messages: Array<{ role: string; content: unknown }>;
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

// ---------------------------------------------------------------------------
// Hook diagnostic logger (Phase A, 2026-05-12)
// ---------------------------------------------------------------------------
//
// Append-only structured log of every kasett hook invocation. Lets us answer
// "is the hook firing in production at all?" without having to instrument OC.
// Path is fixed (env override allowed) so the daily-review tooling can pick it
// up without reading kasett config. JSONL: one event per line.
// ---------------------------------------------------------------------------

const HOOK_LOG_PATH =
  process.env['KASETT_HOOK_LOG'] ||
  '/home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl';

interface HookEvent {
  ts?: string;
  hook: string;
  sessionId?: string;
  agentId?: string;
  action?: string;
  parsed?: boolean;
  charCount?: number;
  metaMain?: string | null;
  error?: string;
  detail?: Record<string, unknown>;
}

async function logHookEvent(ev: HookEvent): Promise<void> {
  try {
    const enriched: HookEvent = { ts: new Date().toISOString(), ...ev };
    await appendFile(HOOK_LOG_PATH, JSON.stringify(enriched) + '\n');
  } catch {
    // never throw from logging
  }
}

// ---------------------------------------------------------------------------
// Module-level session context capture
// ---------------------------------------------------------------------------

/**
 * Populated by before_compaction hook so summarize() knows which session to read.
 * before_compaction fires immediately before summarize() is called.
 * Reset to null after summarize() consumes it.
 */
let pendingCompactionCtx: {
  sessionKey: string;
  agentId: string;
  stateDir: string;
} | null = null;

// ---------------------------------------------------------------------------
// Plugin Registration
// ---------------------------------------------------------------------------

export function register(api: PluginAPI): void {
  // Short-circuit non-full registration modes. OC calls register() in
  // "cli-metadata" / "tool-discovery" / "discovery" passes for plugin
  // inventory, then rolls back any registry mutations. Doing real work in
  // those modes is wasted (and creates noisy duplicate "Registering..." log
  // lines that look like the plugin is re-initializing in a loop).
  const mode = api.registrationMode ?? 'full';
  if (mode !== 'full') {
    api.logger.debug(`[kasett-rewind] register(mode=${mode}) — skipping (metadata-only pass)`);
    return;
  }

  const config = resolveConfig(api);

  if (!config.enabled) {
    api.logger.info('[kasett-rewind] Plugin disabled via config — skipping registration');
    return;
  }

  api.logger.info(
    `[kasett-rewind] Registering CompactionProvider + orientation hook — window=${config.compaction.windowSize}, threads=${config.steering.threadTracking}, hotSwap=${config.compaction.hotSwap}`,
  );

  const reader = new SessionReader();

  // ─────────────────────────────────────────────────────────────────────────
  // Hook 1: before_compaction (VOID)
  //
  // Captures session context into pendingCompactionCtx so summarize() can
  // find the right session JSONL. Runs just before the compaction starts.
  // ─────────────────────────────────────────────────────────────────────────
  api.on('before_compaction', async (event: BeforeCompactionEvent, ctx: HookContext) => {
    // NOTE: Do NOT guard on config.steering.threadTracking here.
    // The hot-swap worker needs the ctx regardless of whether steering is enabled —
    // it requires the session file path to perform the atomic rewrite.

    const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
    const agentId = ctx.agentId?.trim() || 'main';
    const stateDir = api.runtime.state.resolveStateDir();

    pendingCompactionCtx = { sessionKey, agentId, stateDir };
    api.logger.debug(`[kasett-rewind] before_compaction: captured ctx for ${sessionKey}`);
    void logHookEvent({
      hook: 'before_compaction',
      sessionId: sessionKey,
      agentId,
      action: 'captured_ctx',
      detail: {
        messageCount: event?.messageCount,
        tokenCount: event?.tokenCount,
      },
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Hook 1b: after_compaction (VOID, observability only)
  // ───────────────────────────────────────────────────────────────────────
  api.on('after_compaction', async (event: AfterCompactionEvent, ctx: HookContext) => {
    const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
    const agentId = ctx.agentId?.trim() || 'main';
    void logHookEvent({
      hook: 'after_compaction',
      sessionId: sessionKey,
      agentId,
      action: 'fired',
      detail: {
        messageCount: event?.messageCount,
        tokenCount: event?.tokenCount,
        compactedCount: event?.compactedCount,
        sessionFile: event?.sessionFile ?? null,
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hook 2: before_prompt_build (MODIFYING — return values ARE merged)
  //
  // Fires on every normal agent turn (not during compaction).
  // Reads the last N compaction summaries from the session JSONL (up to
  // windowSize), extracts [THREAD_META] from each, and injects a thread
  // trajectory orientation string via prependContext. This is LIGHT —
  // just thread names showing trajectory, no full summaries, no weights.
  // No sidecar file — thread meta lives inside the compaction summaries.
  // ─────────────────────────────────────────────────────────────────────────
  api.on(
    'before_prompt_build',
    async (
      _event: BeforePromptBuildEvent,
      ctx: HookContext,
    ): Promise<BeforePromptBuildResult | undefined> => {
      if (!config.steering.threadTracking) {
        void logHookEvent({
          hook: 'before_prompt_build',
          sessionId: ctx.sessionKey?.trim() || ctx.sessionId,
          agentId: ctx.agentId?.trim() || 'main',
          action: 'skip_disabled',
        });
        return;
      }

      const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
      const agentId = ctx.agentId?.trim() || 'main';
      const stateDir = api.runtime.state.resolveStateDir();

      try {
        const sessionFile = await resolveSessionFile(api, ctx, agentId, sessionKey, stateDir);
        if (sessionFile) {
          // Read last N summaries (windowSize), oldest first
          const recentSummaries = await reader.readLastNSummaries(sessionFile, config.compaction.windowSize);

          if (recentSummaries.length > 0) {
            // Parse [THREAD_META] from each, collect valid ones
            // Reverse so most-recent-first for trajectory display
            const metas: ThreadMeta[] = recentSummaries
              .slice()
              .reverse()
              .map((s) => parseCompactionOutput(s).meta)
              .filter((m): m is ThreadMeta => m !== null);

            if (metas.length > 0) {
              const orientation = buildOrientationPrompt(metas);
              if (orientation) {
                api.logger.debug(
                  `[kasett-rewind] Injecting thread trajectory orientation (${metas.length} compaction(s))`,
                );
                void logHookEvent({
                  hook: 'before_prompt_build',
                  sessionId: sessionKey,
                  agentId,
                  action: 'inject_orientation',
                  parsed: true,
                  charCount: orientation.length,
                  metaMain: metas[0]?.main ?? null,
                  detail: { metaCount: metas.length, summaryCount: recentSummaries.length },
                });
                return { prependContext: orientation };
              }
            }
            void logHookEvent({
              hook: 'before_prompt_build',
              sessionId: sessionKey,
              agentId,
              action: 'no_meta_parsed',
              parsed: false,
              detail: { summaryCount: recentSummaries.length, metaCount: metas.length },
            });
          } else {
            void logHookEvent({
              hook: 'before_prompt_build',
              sessionId: sessionKey,
              agentId,
              action: 'no_summaries',
              parsed: false,
            });
          }
        } else {
          void logHookEvent({
            hook: 'before_prompt_build',
            sessionId: sessionKey,
            agentId,
            action: 'no_session_file',
            parsed: false,
          });
        }
      } catch (err) {
        const msg = err instanceof KasettError ? err.message : String(err);
        api.logger.warn(`[kasett-rewind] before_prompt_build failed: ${msg}`);
        void logHookEvent({
          hook: 'before_prompt_build',
          sessionId: sessionKey,
          agentId,
          action: 'error',
          error: msg,
        });
      }

      return;
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CompactionProvider registration
  //
  // OC calls summarize() instead of its built-in LLM pipeline when
  // session.compaction.provider = "kasett-rewind" is set.
  // ─────────────────────────────────────────────────────────────────────────
  api.registerCompactionProvider({
    id: 'kasett-rewind',

    async summarize(params: SummarizeParams): Promise<string | undefined> {
      if (!config.steering.threadTracking) {
        void logHookEvent({
          hook: 'summarize',
          sessionId: pendingCompactionCtx?.sessionKey,
          agentId: pendingCompactionCtx?.agentId,
          action: 'skip_disabled',
        });
        return undefined;
      }

      // Consume the pending context captured by before_compaction
      const capturedCtx = pendingCompactionCtx;
      pendingCompactionCtx = null;

      api.logger.info('[kasett-rewind] summarize() called — building thread-aware compaction');
      void logHookEvent({
        hook: 'summarize',
        sessionId: capturedCtx?.sessionKey,
        agentId: capturedCtx?.agentId,
        action: 'invoked',
        detail: {
          messageCount: params.messages?.length ?? 0,
          hasPreviousSummary: Boolean(params.previousSummary?.trim()),
          hotSwap: config.compaction.hotSwap,
        },
      });

      // ─────────────────────────────────────────────────────────────────────
      // HOT-SWAP PATH (default, config.hotSwap = true)
      //
      // 1. Build the compaction context (previous summaries + steering prompt)
      // 2. Generate a stub summary immediately (no LLM call)
      // 3. Return the stub to OC (zero delay)
      // 4. Fire-and-forget: background worker runs full LLM + atomic swap
      // ─────────────────────────────────────────────────────────────────────
      if (config.compaction.hotSwap) {
        return await summarizeWithHotSwap({
          params,
          capturedCtx,
          config,
          api,
          reader,
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // LEGACY SYNCHRONOUS PATH (config.hotSwap = false)
      // Blocks until the LLM returns the full summary.
      // ─────────────────────────────────────────────────────────────────────
      try {
        const { steeringPrompt, lifecycleCount, coreSubIdCount } = await buildCompactionContext({
          params,
          capturedCtx,
          config,
          api,
          reader,
        });
        void logHookEvent({
          hook: 'before_compaction',
          sessionId: capturedCtx?.sessionKey,
          agentId: capturedCtx?.agentId,
          action: 'context_built',
          detail: {
            mode: 'sync',
            lifecycle_count: lifecycleCount,
            core_sub_id_count: coreSubIdCount,
          },
        });

        const summary = await callLLMForCompaction({
          messages: params.messages,
          signal: params.signal,
          customInstructions: params.customInstructions,
          steeringPrompt,
          compactionModel: config.compaction.model,
          maxTokens: config.compaction.compactionMaxTokens,
          logger: api.logger,
        });

        if (!summary) {
          api.logger.warn('[kasett-rewind] LLM returned empty summary — falling back to OC built-in');
          return undefined;
        }

        // Validate structured thread meta was produced (v2 first, then v1).
        const parsed = parseCompactionOutputBestEffort(summary);
        if (parsed.metaV1 || parsed.metaV2) {
          const main = parsed.metaV2?.main ?? parsed.metaV1?.main ?? '';
          api.logger.info(
            `[kasett-rewind] Extracted thread meta (schema=${parsed.version}): main="${main}"`,
          );
          void logHookEvent({
            hook: 'summarize',
            sessionId: capturedCtx?.sessionKey,
            agentId: capturedCtx?.agentId,
            action: 'sync_summary_returned',
            parsed: true,
            charCount: summary.length,
            metaMain: main,
            detail: { schemaVersion: parsed.version },
          });
        } else {
          api.logger.warn(
            '[kasett-rewind] No structured thread meta found in LLM output (neither v2 JSON nor v1 [THREAD_META]). ' +
            'The steering prompt instructs the LLM to include it — check model compliance.',
          );
          void logHookEvent({
            hook: 'summarize',
            sessionId: capturedCtx?.sessionKey,
            agentId: capturedCtx?.agentId,
            action: 'sync_summary_no_meta',
            parsed: false,
            charCount: summary.length,
            detail: { v2_errors: parsed.errors.slice(0, 3) },
          });
        }

        // Return full output (with [THREAD_META]) to OC.
        // OC stores this as the compaction entry in the session JSONL.
        return summary;
      } catch (err) {
        if (isAbortError(err)) {
          api.logger.info('[kasett-rewind] summarize() aborted via signal');
          throw err;
        }
        api.logger.warn(`[kasett-rewind] summarize() failed: ${String(err)} — returning undefined to trigger OC fallback`);
        return undefined;
      }
    },
  });

  api.logger.info('[kasett-rewind] CompactionProvider registered as "kasett-rewind"');
}

// ---------------------------------------------------------------------------
// Hot-swap summarize implementation
// ---------------------------------------------------------------------------

interface SummarizeWithHotSwapParams {
  params: SummarizeParams;
  capturedCtx: { sessionKey: string; agentId: string; stateDir: string } | null;
  config: KasettConfig & { enabled: boolean };
  api: PluginAPI;
  reader: SessionReader;
}

/**
 * Hot-swap summarize: return a stub immediately, then run the full LLM
 * summarization in the background and atomically replace the stub in the JSONL.
 */
async function summarizeWithHotSwap(p: SummarizeWithHotSwapParams): Promise<string | undefined> {
  const { params, capturedCtx, config, api, reader } = p;

  try {
    // Step 1: Build compaction context (previous summaries + steering prompt)
    // This is fast — just file reads and string ops, no LLM call.
    const { previousSummaries, steeringPrompt, sessionFile, lifecycleCount, coreSubIdCount } =
      await buildCompactionContext({
        params,
        capturedCtx,
        config,
        api,
        reader,
      });
    void logHookEvent({
      hook: 'before_compaction',
      sessionId: capturedCtx?.sessionKey,
      agentId: capturedCtx?.agentId,
      action: 'context_built',
      detail: {
        mode: 'hotswap',
        lifecycle_count: lifecycleCount,
        core_sub_id_count: coreSubIdCount,
      },
    });

    // Step 2: Generate stub immediately (no LLM call)
    const { stub, stubId } = generateStub(params.previousSummary, params.messages);

    api.logger.info(`[kasett-rewind] Hot-swap: returning stub ${stubId} immediately`);
    void logHookEvent({
      hook: 'summarize',
      sessionId: capturedCtx?.sessionKey,
      agentId: capturedCtx?.agentId,
      action: 'hotswap_stub_returned',
      charCount: stub.length,
      detail: {
        stubId,
        sessionFile: sessionFile ?? null,
        lifecycle_count: lifecycleCount,
        core_sub_id_count: coreSubIdCount,
      },
    });

    // Step 3: Fire-and-forget the background worker
    // IMPORTANT: do NOT await this. The stub is returned first.
    if (sessionFile) {
      // NOTE: Do NOT pass params.signal to the worker.
      // OC aborts that signal once summarize() returns the stub,
      // which would kill the background LLM call immediately.
      const sessionKey = capturedCtx?.sessionKey;
      const agentId = capturedCtx?.agentId;
      runHotSwapWorker({
        sessionFile,
        stubId,
        messages: params.messages,
        previousSummaries,
        steeringPrompt,
        customInstructions: params.customInstructions,
        signal: undefined,
        compactionModel: config.compaction.model,
        compactionMaxTokens: config.compaction.compactionMaxTokens,
        hotSwapTimeoutMs: config.compaction.hotSwapTimeoutMs,
        logger: api.logger,
        callLLM: callLLMForCompaction,
        agentId: agentId ?? undefined,
        topicName: typeof sessionKey === 'string' ? sessionKey : undefined,
        onSidecarWritten: (info) => {
          void logHookEvent({
            hook: 'after_compaction',
            sessionId: sessionKey,
            agentId,
            action: 'sidecar_written',
            parsed: true,
            charCount: info.summaryChars,
            metaMain: info.metaMain,
            detail: {
              stubId,
              sidecarPath: info.sidecarPath,
              sidecarWritten: true,
              schemaVersion: info.schemaVersion,
              keyStateCount: info.keyStateCount,
              keyStateDetectedCount: info.keyStateDetectedCount,
            },
          });
        },
        onSidecarFailed: (info) => {
          void logHookEvent({
            hook: 'after_compaction',
            sessionId: sessionKey,
            agentId,
            action: 'sidecar_failed',
            parsed: false,
            error: info.reason,
            detail: {
              stubId,
              sidecarWritten: false,
              ...(info.detail ? { detail: info.detail } : {}),
            },
          });
        },
      }).catch((err: unknown) => {
        // Background errors are logged but never propagate
        api.logger.error(`[kasett-rewind] Sidecar worker threw: ${String(err)}`);
      });
    } else {
      api.logger.warn(
        '[kasett-rewind] Hot-swap: no session file path — background worker skipped. ' +
        'Stub will remain in place until next compaction.',
      );
    }

    // Step 4: Return the stub to OC immediately
    return stub;
  } catch (err) {
    if (isAbortError(err)) {
      api.logger.info('[kasett-rewind] Hot-swap summarize() aborted via signal');
      throw err;
    }
    api.logger.warn(
      `[kasett-rewind] Hot-swap stub generation failed: ${String(err)} — ` +
      'returning undefined to trigger OC fallback',
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared compaction context builder
// ---------------------------------------------------------------------------

/**
 * Phase G: aggregate continuity hints across a window of previous compaction
 * summary texts. Walks every summary in the window (not just the most recent)
 * and builds:
 *   - `previousSubIds`: every sub-thread id seen, sorted by recurrence
 *     frequency descending (most-recurring first — "core" threads bubble up).
 *   - `coreSubIds`: subset of `previousSubIds` with frequency >= 2 (i.e.
 *     appeared in at least 2 of the windowed summaries).
 *   - `previousKeyState`: deduped key_state entries across all summaries,
 *     keyed by `${kind}::${value}`. First-seen wins; since `summaries` is
 *     most-recent-first, the most recent entry for a given (kind, value)
 *     pair is preserved.
 *
 * Pure function — no I/O, side-effect-free, suitable for unit tests.
 *
 * @param summaries - Previous compaction summary texts, MOST RECENT FIRST.
 */
export function aggregateContinuityHints(summaries: ReadonlyArray<string>): {
  previousSubIds?: string[];
  coreSubIds?: string[];
  previousKeyState?: KeyStateEntry[];
} {
  if (summaries.length === 0) return {};

  const idFrequency = new Map<string, number>();
  const keyStateByKey = new Map<string, KeyStateEntry>();

  for (const summaryText of summaries) {
    if (!summaryText) continue;
    const parsed = parseCompactionOutputBestEffort(summaryText);
    if (parsed.metaV2 && parsed.metaV2.sub.length > 0) {
      for (const s of parsed.metaV2.sub) {
        if (!s.id) continue;
        idFrequency.set(s.id, (idFrequency.get(s.id) ?? 0) + 1);
      }
    }
    if (parsed.metaV3?.key_state && parsed.metaV3.key_state.length > 0) {
      for (const k of parsed.metaV3.key_state) {
        const key = `${k.kind}::${k.value}`;
        if (!keyStateByKey.has(key)) {
          keyStateByKey.set(key, k);
        }
      }
    }
  }

  const result: {
    previousSubIds?: string[];
    coreSubIds?: string[];
    previousKeyState?: KeyStateEntry[];
  } = {};

  if (idFrequency.size > 0) {
    const sorted = Array.from(idFrequency.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    result.previousSubIds = sorted.map(([id]) => id);
    const core = sorted.filter(([, freq]) => freq >= 2).map(([id]) => id);
    if (core.length > 0) result.coreSubIds = core;
  }
  if (keyStateByKey.size > 0) {
    result.previousKeyState = Array.from(keyStateByKey.values());
  }
  return result;
}

interface CompactionContext {
  previousSummaries: string[];
  steeringPrompt: string;
  sessionFile: string | null;
  /**
   * Phase G: number of lifecycle events (renames/merges/splits) re-surfaced
   * from the prior compaction's sidecar into the steering prompt. 0 means
   * either no prior compactions, no lifecycle events were detected, or the
   * sidecar read failed (non-blocking). Logged via hook events for
   * observability.
   */
  lifecycleCount: number;
  /**
   * Phase G: number of "core" sub-thread IDs (appeared in 2+ previous
   * compactions in the window). 0 if no recurrence detected.
   */
  coreSubIdCount: number;
}

interface BuildCompactionContextParams {
  params: SummarizeParams;
  capturedCtx: { sessionKey: string; agentId: string; stateDir: string } | null;
  config: KasettConfig;
  api: PluginAPI;
  reader: SessionReader;
}

/**
 * Build the compaction context: gather previous summaries, weight them,
 * and build the steering prompt. Returns the context along with the
 * resolved session file path (for hot-swap worker).
 *
 * This is fast (file reads + string ops, no LLM call).
 */
async function buildCompactionContext(
  p: BuildCompactionContextParams,
): Promise<CompactionContext> {
  const { params, capturedCtx, config, api, reader } = p;

  // --- 1. Collect previous summaries ---
  // OC provides previousSummary directly — use that as most recent,
  // then supplement with older ones from the JSONL for the window.
  let previousSummaries: string[] = [];
  let sessionFile: string | null = null;

  if (params.previousSummary?.trim()) {
    previousSummaries = [params.previousSummary.trim()];
  }

  if (capturedCtx && previousSummaries.length < config.compaction.windowSize) {
    try {
      sessionFile = await resolveSessionFileFromState(
        api,
        capturedCtx.stateDir,
        capturedCtx.agentId,
        capturedCtx.sessionKey,
      );
      if (sessionFile) {
        const needed = config.compaction.windowSize - previousSummaries.length;
        // Read last N+1 to avoid duplication with previousSummary
        const events = await reader.readLastNSummaries(sessionFile, needed + 1);
        // events are oldest-first; reverse to most-recent-first
        const fromJsonl = [...events].reverse();

        if (
          previousSummaries.length > 0 &&
          fromJsonl.length > 0 &&
          fromJsonl[0].trim() === previousSummaries[0]
        ) {
          previousSummaries = [...previousSummaries, ...fromJsonl.slice(1).slice(0, needed)];
        } else {
          previousSummaries = [...previousSummaries, ...fromJsonl.slice(0, needed)];
        }
      }
    } catch (err) {
      api.logger.warn(`[kasett-rewind] Could not load previous summaries: ${String(err)}`);
    }
  } else if (!capturedCtx) {
    api.logger.warn('[kasett-rewind] No session context captured — summarizing without full history');
  }

  // --- 2. Weight summaries by recency ---
  const weighted = weightSummaries(previousSummaries, config.compaction.weights);

  // --- 3. Extract previous v2 sub-thread ids and v3 key_state (continuity) ---
  // Phase G: aggregate across the FULL window (not just the latest summary).
  const aggregated = aggregateContinuityHints(previousSummaries);
  const previousSubIds: string[] | undefined = aggregated.previousSubIds;
  const previousKeyState: KeyStateEntry[] | undefined = aggregated.previousKeyState;
  const coreSubIds: string[] | undefined = aggregated.coreSubIds;

  // --- 3b. Detect candidate key state values from the conversation (Phase C) ---
  // The detector is heuristic / advisory — we surface candidates to the LLM
  // as hints but the LLM decides what to actually preserve.
  let candidateKeyState: KeyStateEntry[] = [];
  try {
    candidateKeyState = detectCandidateKeyState(
      params.messages.map((m) => ({ role: m.role, content: m.content })),
    );
  } catch (err) {
    api.logger.debug(`[kasett-rewind] keystate detector failed: ${String(err)}`);
  }

  // --- 3c. Read lifecycle events from the prior compaction's sidecar (Phase G) ---
  // The prior compaction's worker may have detected renames/merges/splits
  // and stored them on the sidecar. Surfacing them here lets the LLM keep
  // IDs stable after a rename, instead of re-detecting it via fuzzy match.
  // Failures are non-blocking — if the sidecar can't be read, we just
  // proceed without lifecycle hints.
  let recentLifecycle: LifecycleEvent[] | undefined;
  if (sessionFile) {
    try {
      const events = await reader.readLatestLifecycleEvents(sessionFile);
      if (events.length > 0) recentLifecycle = events;
    } catch (err) {
      api.logger.debug(
        `[kasett-rewind] readLatestLifecycleEvents failed (non-blocking): ${String(err)}`,
      );
    }
  }

  // --- 4. Build thread-aware steering prompt (v3/json by default) ---
  const steeringPrompt = buildSteeringPrompt(weighted, {
    structuredOutput: 'json',
    ...(previousSubIds ? { previousSubIds } : {}),
    ...(coreSubIds ? { coreSubIds } : {}),
    ...(previousKeyState ? { previousKeyState } : {}),
    ...(candidateKeyState.length > 0 ? { candidateKeyState } : {}),
    ...(recentLifecycle ? { recentLifecycle } : {}),
  });

  return {
    previousSummaries,
    steeringPrompt,
    sessionFile,
    lifecycleCount: recentLifecycle?.length ?? 0,
    coreSubIdCount: coreSubIds?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

interface LLMCallParams {
  messages: Array<{ role: string; content: unknown }>;
  signal?: AbortSignal;
  customInstructions?: string;
  steeringPrompt: string;
  /**
   * Model override from plugin config.
   * Undefined or "default" = use the environment's default model.
   * Any other value = passed directly to the API as the model identifier.
   */
  compactionModel?: string;
  /**
   * Maximum output tokens. When unset, falls back to a conservative default
   * (8192) for backward compat. Phase F: callers should pass
   * config.compaction.compactionMaxTokens (default 32000).
   */
  maxTokens?: number;
  logger: {
    debug(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
}

/**
 * Resolve the model identifier to use for a given API provider.
 */
function resolveModel(
  compactionModel: string | undefined,
  provider: 'anthropic' | 'openrouter',
  defaultModel: string,
): string {
  if (!compactionModel || compactionModel === 'default') {
    return defaultModel;
  }
  return compactionModel;
}

async function callLLMForCompaction(params: LLMCallParams): Promise<string | undefined> {
  const { messages, signal, customInstructions, steeringPrompt, compactionModel, maxTokens, logger } = params;
  const effectiveMaxTokens = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 8192;

  // Build system prompt: steering + OC custom instructions
  const systemParts: string[] = [steeringPrompt];

  if (customInstructions?.trim()) {
    systemParts.push('\n\n---\n\n## Additional Instructions from OpenClaw\n\n' + customInstructions.trim());
  }

  const systemPrompt = systemParts.join('');

  // Convert messages to text for summarization
  const historyText = messagesToText(messages);

  const userPrompt =
    'Please produce a compaction summary of the following conversation. ' +
    'Follow the thread meta instructions in your system prompt exactly.\n\n' +
    '---\n\n' +
    historyText;

  // Diagnostic log file
  const diagLog = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/hotswap-diag.log';
  const diagWrite = async (msg: string) => {
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(diagLog, `[${new Date().toISOString()}] LLM_DIAG ${msg}\n`);
    } catch { /* ignore */ }
  };

  // Try OpenRouter first (preferred — unified model routing, fallbacks, logging)
  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) {
    const model = resolveModel(compactionModel, 'openrouter', 'anthropic/claude-sonnet-4-5');
    logger.debug(`[kasett-rewind] Using model for OpenRouter: ${model}`);
    await diagWrite(`openrouter_start model=${model} prompt_chars=${systemPrompt.length}+${userPrompt.length} max_tokens=${effectiveMaxTokens}`);
    try {
      const result = await callOpenRouter({
        apiKey: openrouterKey,
        model,
        systemPrompt,
        userPrompt,
        signal,
        maxTokens: effectiveMaxTokens,
      });
      await diagWrite(`openrouter_result length=${result?.length ?? 0} empty=${!result} preview=${JSON.stringify((result ?? '').slice(0, 120))}`);
      if (result) {
        logger.debug('[kasett-rewind] LLM call succeeded via OpenRouter API');
        return result;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      await diagWrite(`openrouter_error ${String(err).slice(0, 500)}`);
      logger.warn(`[kasett-rewind] OpenRouter API call failed: ${String(err)}`);
    }
  } else {
    await diagWrite('openrouter_skip no_api_key');
  }

  // Fallback: Anthropic direct API
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    const model = resolveModel(compactionModel, 'anthropic', 'claude-sonnet-4-5');
    logger.debug(`[kasett-rewind] Using model for Anthropic: ${model}`);
    await diagWrite(`anthropic_fallback_start model=${model} max_tokens=${effectiveMaxTokens}`);
    try {
      const result = await callAnthropic({
        apiKey: anthropicKey,
        model,
        systemPrompt,
        userPrompt,
        signal,
        maxTokens: effectiveMaxTokens,
      });
      await diagWrite(`anthropic_fallback_result length=${result?.length ?? 0} empty=${!result}`);
      if (result) {
        logger.debug('[kasett-rewind] LLM call succeeded via Anthropic fallback');
        return result;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      await diagWrite(`anthropic_fallback_error ${String(err).slice(0, 500)}`);
      logger.warn(`[kasett-rewind] Anthropic fallback failed: ${String(err)}`);
    }
  } else {
    await diagWrite('anthropic_fallback_skip no_api_key');
  }

  logger.warn('[kasett-rewind] No LLM API available (no OPENROUTER_API_KEY or ANTHROPIC_API_KEY)');
  return undefined;
}

/**
 * Call Anthropic Messages API directly.
 */
async function callAnthropic(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<string | undefined> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
      messages: [{ role: 'user', content: params.userPrompt }],
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content?.find((b) => b.type === 'text');
  return textBlock?.text ?? undefined;
}

/**
 * Call OpenRouter API (OpenAI-compat) as fallback.
 */
async function callOpenRouter(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<string | undefined> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? undefined;
}

/**
 * Convert OC messages (OpenAI role/content format) to a flat text representation
 * suitable for passing to the compaction LLM.
 */
function messagesToText(messages: Array<{ role: string; content: unknown }>): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role?.toUpperCase() ?? 'UNKNOWN';
    const content = extractTextContent(msg.content);
    if (content.trim()) {
      lines.push(`[${role}]: ${content}`);
    }
  }

  return lines.join('\n\n');
}

/**
 * Extract text from various OC content formats:
 * - string: return as-is
 * - array: join text parts
 * - object with text: return text
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (p['type'] === 'text' && typeof p['text'] === 'string') return p['text'];
          if (typeof p['text'] === 'string') return p['text'];
          if (typeof p['content'] === 'string') return p['content'];
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c['text'] === 'string') return c['text'];
    if (typeof c['content'] === 'string') return c['content'];
  }
  return '';
}

// ---------------------------------------------------------------------------
// Session file resolution
// ---------------------------------------------------------------------------

async function resolveSessionFile(
  api: PluginAPI,
  ctx: HookContext,
  agentId: string,
  sessionKey: string,
  stateDir: string,
): Promise<string | null> {
  // Strategy 1: session store lookup
  try {
    const storePath = api.runtime.agent.session.resolveStorePath(
      api.config?.session,
      { agentId },
    );
    const store = api.runtime.agent.session.loadSessionStore(storePath);
    const entry = resolveStoreEntry(store, sessionKey);
    if (entry?.sessionFile) return entry.sessionFile;
  } catch {
    // Fall through
  }

  // Strategy 2: derive path from state dir
  const sessionId = ctx.sessionId?.trim();
  if (sessionId) {
    try {
      return join(stateDir, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
    } catch {
      // Fall through
    }
  }

  return null;
}

async function resolveSessionFileFromState(
  api: PluginAPI,
  stateDir: string,
  agentId: string,
  sessionKey: string,
): Promise<string | null> {
  // Strategy 1: session store lookup
  try {
    const storePath = api.runtime.agent.session.resolveStorePath(
      api.config?.session,
      { agentId },
    );
    const store = api.runtime.agent.session.loadSessionStore(storePath);
    const entry = resolveStoreEntry(store, sessionKey);
    if (entry?.sessionFile) return entry.sessionFile;
  } catch {
    // Fall through
  }

  // Strategy 2: scan the sessions directory for a file matching the sessionKey
  // OC session files are named <sessionId>-topic-<topicId>.jsonl or <sessionId>.jsonl
  // The sessionKey may be the full filename stem or match as a substring.
  const sessionsDir = join(stateDir, 'agents', agentId, 'sessions');
  try {
    const files = await readdir(sessionsDir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && !f.endsWith('.lock'));

    // Exact stem match first
    const exactMatch = jsonlFiles.find(
      (f) => f === `${sessionKey}.jsonl` || f.replace(/\.jsonl$/, '') === sessionKey,
    );
    if (exactMatch) return join(sessionsDir, exactMatch);

    // Substring match (sessionKey is a prefix or substring of the filename)
    const safeKey = sessionKey.replace(/[^a-z0-9_\-:.]/gi, '_');
    const partialMatch = jsonlFiles.find(
      (f) => f.includes(sessionKey) || f.includes(safeKey),
    );
    if (partialMatch) return join(sessionsDir, partialMatch);

    // Strategy 3: find the lock file — the session that triggered compaction holds a write lock.
    // The lock filename is <sessionFile>.lock, so we can derive the session file from it.
    const lockFiles = files.filter((f) => f.endsWith('.jsonl.lock'));
    if (lockFiles.length === 1) {
      // Only one session locked — that must be our compaction target
      const sessionFilename = lockFiles[0].replace(/\.lock$/, '');
      return join(sessionsDir, sessionFilename);
    }
  } catch {
    // Directory doesn't exist or is unreadable — fall through
  }

  // Strategy 4: derive a candidate path from stateDir (best guess, may not exist yet)
  const safeName = sessionKey.replace(/[^a-z0-9_\-:.]/gi, '_');
  const candidate = join(stateDir, 'agents', agentId, 'sessions', `${safeName}.jsonl`);
  return candidate;
}

function resolveStoreEntry(
  store: Record<string, SessionStoreEntry>,
  sessionKey: string,
): SessionStoreEntry | undefined {
  if (store[sessionKey]) return store[sessionKey];
  const lower = sessionKey.toLowerCase();
  for (const [k, v] of Object.entries(store)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Abort error detection
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(api: PluginAPI): KasettConfig & { enabled: boolean } {
  try {
    const raw = (api.pluginConfig ?? {}) as Record<string, unknown> & { enabled?: boolean };

    // Support nested structure (new) and flat structure (legacy backward compat)
    const rawCompaction = (raw['compaction'] as Record<string, unknown> | undefined) ?? {};
    const rawSteering = (raw['steering'] as Record<string, unknown> | undefined) ?? {};

    // Backward compat: flat keys map to nested structure if nested keys not present
    const windowSize =
      (rawCompaction['windowSize'] as number | undefined) ??
      (raw['windowSize'] as number | undefined) ??
      DEFAULT_CONFIG.compaction.windowSize;
    const weights =
      (rawCompaction['weights'] as number[] | undefined) ??
      (raw['weights'] as number[] | undefined) ??
      DEFAULT_CONFIG.compaction.weights;
    const model =
      (rawCompaction['model'] as string | undefined) ??
      (raw['compactionModel'] as string | undefined) ??
      DEFAULT_CONFIG.compaction.model;
    const hotSwap =
      (rawCompaction['hotSwap'] as boolean | undefined) ??
      (raw['hotSwap'] as boolean | undefined) ??
      DEFAULT_CONFIG.compaction.hotSwap;
    const hotSwapTimeoutMs =
      (rawCompaction['hotSwapTimeoutMs'] as number | undefined) ??
      (raw['hotSwapTimeoutMs'] as number | undefined) ??
      DEFAULT_CONFIG.compaction.hotSwapTimeoutMs;
    const compactionMaxTokens =
      (rawCompaction['compactionMaxTokens'] as number | undefined) ??
      (raw['compactionMaxTokens'] as number | undefined) ??
      DEFAULT_CONFIG.compaction.compactionMaxTokens;
    const threadTracking =
      (rawSteering['threadTracking'] as boolean | undefined) ??
      (raw['threadTracking'] as boolean | undefined) ??
      DEFAULT_CONFIG.steering.threadTracking;

    return {
      enabled: raw['enabled'] as boolean ?? true,
      compaction: { model, hotSwap, hotSwapTimeoutMs, windowSize, weights, compactionMaxTokens },
      steering: { threadTracking },
    };
  } catch {
    return { enabled: true, ...DEFAULT_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Public API Exports
// ---------------------------------------------------------------------------

export { SessionReader, KasettError } from './storage/reader.js';
export {
  weightSummaries,
  classifyThreadsV2,
  classifyThreadsV1Fallback,
} from './threads/weight.js';
export type {
  WeightedSummary,
  ClassifiedThread,
  ThreadContinuityClass,
} from './threads/weight.js';
export {
  buildSteeringPrompt,
  buildOrientationPrompt,
  buildOrientationPromptV2,
} from './threads/steering.js';
export type {
  StructuredOutputMode,
  SteeringOptions,
} from './threads/steering.js';
export {
  parseCompactionOutput,
  parseCompactionOutputV2,
  parseCompactionOutputBestEffort,
} from './threads/parser.js';
export type {
  ParseResult,
  ParseResultV2,
  BestEffortParseResult,
} from './threads/parser.js';
export {
  THREAD_META_SCHEMA_V2,
  THREAD_STATUS_VALUES,
  validateThreadMetaV2,
  projectV2ToV1,
  schemaAsPromptString,
} from './threads/schema.js';
export type {
  ThreadMetaV2,
  ThreadSubV2,
  ThreadStatus,
  ValidateResult,
} from './threads/schema.js';
export { emptyThreadMeta, isValidThreadMeta } from './threads/meta.js';
export { CompactionWindow } from './compaction/window.js';
export { generateConfig } from './cli/generate-config.js';
export type { GenerateConfigOptions } from './cli/generate-config.js';
export { generateStub } from './hotswap/stub.js';
export { runHotSwapWorker } from './hotswap/worker.js';
export { acquireLock, waitForLockAbsent } from './hotswap/lock.js';
export {
  writeSidecarEntry,
  readSidecar,
  findEntryForCompaction,
  sidecarPathFor,
  sidecarExists,
} from './storage/sidecar.js';
export type { SidecarEntry } from './storage/sidecar.js';

export type {
  KasettConfig,
  CompactionEvent,
  ThreadMeta,
  ConversationTurn,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
