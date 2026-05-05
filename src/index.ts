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
 *     a. Reads previous thread metas from the sidecar (if any)
 *     b. Builds a thread-aware steering prompt (buildSteeringPrompt)
 *     c. Calls Anthropic claude-haiku-3-5 with the messages + steering
 *     d. Parses [THREAD_META] from the output
 *     e. Stores the parsed meta in a per-session sidecar file
 *     f. Returns the clean summary text to OC
 *
 * ### before_prompt_build hook (MODIFYING)
 *   Fires on every normal agent turn. Reads the sidecar and injects
 *   a brief orientation string via { prependContext } so the agent
 *   knows what it was working on after a compaction.
 *
 * ### before_compaction hook (VOID)
 *   Used as a lightweight "session context capture" — stores the
 *   current sessionKey/sessionId into `pendingCompactionCtx` so the
 *   stateless `summarize()` method knows which sidecar to write.
 *
 * ## Why not the old after_compaction hook?
 *   summarize() itself now owns the full pipeline, so after_compaction
 *   is unnecessary — we write the sidecar inside summarize() before returning.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SessionReader, KasettError } from './storage/reader.js';
import { analyzeThreads } from './threads/weight.js';
import { buildSteeringPrompt, buildOrientationPrompt } from './threads/steering.js';
import { parseCompactionOutput } from './threads/parser.js';
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
  /** Previous compaction summary for continuity */
  previousSummary?: string;
}

// ---------------------------------------------------------------------------
// Module-level session context capture
// ---------------------------------------------------------------------------

/**
 * Populated by before_compaction hook so summarize() knows which sidecar to write.
 * before_compaction fires immediately before summarize() is called, in the same
 * event loop tick sequence. We use a simple object to capture the context.
 *
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
  const config = resolveConfig(api);

  if (!config.enabled) {
    api.logger.info('[kasett-rewind] Plugin disabled via config — skipping registration');
    return;
  }

  api.logger.info(
    `[kasett-rewind] Registering CompactionProvider + orientation hook — window=${config.windowSize}, threads=${config.threadTracking}`,
  );

  const reader = new SessionReader();

  // ─────────────────────────────────────────────────────────────────────────
  // Hook 1: before_compaction (VOID)
  //
  // Captures session context into pendingCompactionCtx so summarize() can
  // find the right sidecar path. Runs just before the compaction starts.
  // ─────────────────────────────────────────────────────────────────────────
  api.on('before_compaction', async (_event: BeforeCompactionEvent, ctx: HookContext) => {
    if (!config.threadTracking) return;

    const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
    const agentId = ctx.agentId?.trim() || 'main';
    const stateDir = api.runtime.state.resolveStateDir();

    pendingCompactionCtx = { sessionKey, agentId, stateDir };
    api.logger.debug(`[kasett-rewind] before_compaction: captured ctx for ${sessionKey}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hook 2: before_prompt_build (MODIFYING — return values ARE merged)
  //
  // Fires on every normal agent turn (not during compaction).
  // Reads the sidecar and injects thread orientation via prependContext.
  // ─────────────────────────────────────────────────────────────────────────
  api.on(
    'before_prompt_build',
    async (
      _event: BeforePromptBuildEvent,
      ctx: HookContext,
    ): Promise<BeforePromptBuildResult | undefined> => {
      if (!config.threadTracking) return;

      const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
      const agentId = ctx.agentId?.trim() || 'main';
      const stateDir = api.runtime.state.resolveStateDir();

      try {
        // Fast path: check sidecar first
        const sidecarMeta = await readSidecarMeta(stateDir, sessionKey);
        if (sidecarMeta) {
          const orientation = buildOrientationPrompt(sidecarMeta);
          api.logger.debug(`[kasett-rewind] Injecting orientation from sidecar: "${sidecarMeta.main}"`);
          return { prependContext: orientation };
        }

        // Slow path: scan session JSONL for latest compaction with meta
        const sessionFile = await resolveSessionFile(api, ctx, agentId, sessionKey);
        if (sessionFile) {
          const latestMeta = await reader.readLatestMeta(sessionFile);
          if (latestMeta) {
            const orientation = buildOrientationPrompt(latestMeta);
            api.logger.debug(`[kasett-rewind] Injecting orientation from session JSONL: "${latestMeta.main}"`);
            return { prependContext: orientation };
          }
        }
      } catch (err) {
        const msg = err instanceof KasettError ? err.message : String(err);
        api.logger.warn(`[kasett-rewind] before_prompt_build failed: ${msg}`);
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
      if (!config.threadTracking) return undefined;

      // Consume the pending context captured by before_compaction
      const capturedCtx = pendingCompactionCtx;
      pendingCompactionCtx = null;

      api.logger.info('[kasett-rewind] summarize() called — building thread-aware compaction');

      try {
        // --- 1. Read previous thread metas from sidecar or session JSONL ---
        let previousMetas: ThreadMeta[] = [];

        if (capturedCtx) {
          try {
            // Try sidecar first (fast path)
            const sidecarMeta = await readSidecarMeta(capturedCtx.stateDir, capturedCtx.sessionKey);
            if (sidecarMeta) {
              previousMetas = [sidecarMeta];
            } else {
              // Fall back to session JSONL
              const sessionFile = await resolveSessionFileFromState(
                api,
                capturedCtx.stateDir,
                capturedCtx.agentId,
                capturedCtx.sessionKey,
              );
              if (sessionFile) {
                const events = await reader.readLastNWithMeta(sessionFile, config.windowSize);
                previousMetas = events
                  .filter((e) => e.data.kaspiett != null)
                  .map((e) => e.data.kaspiett!)
                  .reverse(); // most recent first
              }
            }
          } catch (err) {
            api.logger.warn(`[kasett-rewind] Could not load previous metas: ${String(err)}`);
          }
        } else {
          api.logger.warn('[kasett-rewind] No session context captured — summarizing without thread history');
        }

        // --- 2. Build thread-aware steering prompt ---
        const analysis = analyzeThreads(previousMetas, config.weights);
        const steeringPrompt = buildSteeringPrompt(analysis, previousMetas);

        // --- 3. Call LLM with steering injection ---
        const summary = await callLLMForCompaction({
          messages: params.messages,
          signal: params.signal,
          customInstructions: params.customInstructions,
          previousSummary: params.previousSummary,
          steeringPrompt,
          compactionModel: config.compactionModel,
          logger: api.logger,
        });

        if (!summary) {
          api.logger.warn('[kasett-rewind] LLM returned empty summary — falling back to OC built-in');
          return undefined;
        }

        // --- 4. Parse [THREAD_META] from output ---
        const parsed = parseCompactionOutput(summary);

        if (parsed.meta && capturedCtx) {
          api.logger.info(`[kasett-rewind] Extracted thread meta: main="${parsed.meta.main}"`);
          // --- 5. Store meta in sidecar ---
          try {
            await writeSidecarMeta(capturedCtx.stateDir, capturedCtx.sessionKey, parsed.meta);
            api.logger.debug('[kasett-rewind] Sidecar written successfully');
          } catch (err) {
            api.logger.warn(`[kasett-rewind] Failed to write sidecar: ${String(err)}`);
          }
        } else if (!parsed.meta) {
          api.logger.warn(
            '[kasett-rewind] No [THREAD_META] block found in LLM output. ' +
            'The steering prompt instructs the LLM to include it — check model compliance.',
          );
        }

        // --- 6. Return clean summary text to OC ---
        // Return the FULL output (with [THREAD_META]) as the summary.
        // OC stores this as the compaction entry. The [THREAD_META] block is
        // preserved for future reference and can be re-parsed by before_prompt_build.
        // We also return parsed.summary (without the block) so OC's context is clean.
        // Return the FULL output including [THREAD_META] block.
        // OC stores this as the compaction entry in the session JSONL.
        // The meta block persists for future orientation injection.
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
// LLM call
// ---------------------------------------------------------------------------

interface LLMCallParams {
  messages: Array<{ role: string; content: unknown }>;
  signal?: AbortSignal;
  customInstructions?: string;
  previousSummary?: string;
  steeringPrompt: string;
  /**
   * Model override from plugin config.
   * Undefined or "default" = use the environment's default model.
   * Any other value = passed directly to the API as the model identifier.
   */
  compactionModel?: string;
  logger: {
    debug(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
}

/**
 * Calls the LLM (Anthropic claude-haiku-3-5 via direct API, or OpenRouter fallback)
 * to produce a thread-aware compaction summary.
 *
 * The steering prompt is injected as system context so the LLM knows to output
 * [THREAD_META] in addition to the narrative summary.
 */
/**
 * Resolve the model identifier to use for a given API provider.
 *
 * When `compactionModel` is unset or "default", we fall back to the
 * provider's own default (claude-sonnet-4-20250514 for Anthropic direct,
 * anthropic/claude-sonnet-4-20250514 for OpenRouter) — i.e. the same
 * behaviour as before this option was added.
 *
 * When an explicit model string is provided, it is used as-is for both
 * providers. Users are responsible for ensuring the model string is valid
 * for their chosen provider.
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
  const { messages, signal, customInstructions, previousSummary, steeringPrompt, compactionModel, logger } = params;

  // Build system prompt: steering + OC custom instructions + previous summary context
  const systemParts: string[] = [steeringPrompt];

  if (customInstructions?.trim()) {
    systemParts.push('\n\n---\n\n## Additional Instructions from OpenClaw\n\n' + customInstructions.trim());
  }

  if (previousSummary?.trim()) {
    systemParts.push('\n\n---\n\n## Previous Compaction Summary\n\n' + previousSummary.trim());
  }

  const systemPrompt = systemParts.join('');

  // Convert messages to text for summarization
  // Messages are in OpenAI role/content format; extract text content
  const historyText = messagesToText(messages);

  const userPrompt =
    'Please produce a compaction summary of the following conversation. ' +
    'Follow the thread meta instructions in your system prompt exactly.\n\n' +
    '---\n\n' +
    historyText;

  // Try Anthropic direct API first (fast, reliable)
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    const model = resolveModel(compactionModel, 'anthropic', 'claude-sonnet-4-20250514');
    logger.debug(`[kasett-rewind] Using model for Anthropic: ${model}`);
    try {
      const result = await callAnthropic({
        apiKey: anthropicKey,
        model,
        systemPrompt,
        userPrompt,
        signal,
      });
      if (result) {
        logger.debug('[kasett-rewind] LLM call succeeded via Anthropic API');
        return result;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.warn(`[kasett-rewind] Anthropic API call failed: ${String(err)}`);
    }
  }

  // Fallback: OpenRouter API
  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) {
    const model = resolveModel(compactionModel, 'openrouter', 'anthropic/claude-sonnet-4-20250514');
    logger.debug(`[kasett-rewind] Using model for OpenRouter: ${model}`);
    try {
      const result = await callOpenRouter({
        apiKey: openrouterKey,
        model,
        systemPrompt,
        userPrompt,
        signal,
      });
      if (result) {
        logger.debug('[kasett-rewind] LLM call succeeded via OpenRouter API');
        return result;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.warn(`[kasett-rewind] OpenRouter API call failed: ${String(err)}`);
    }
  }

  logger.warn('[kasett-rewind] No LLM API available (no ANTHROPIC_API_KEY or OPENROUTER_API_KEY)');
  return undefined;
}

/**
 * Call Anthropic Messages API directly.
 * Uses claude-haiku-3-5 for cost efficiency.
 */
async function callAnthropic(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
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
      max_tokens: 4096,
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
 * Uses claude-haiku-3-5 via openrouter.
 */
async function callOpenRouter(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
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
// Sidecar state helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the kasett sidecar JSON file for a given session.
 * Stored under <stateDir>/plugins/kasett-rewind/meta/<sessionKey-safe>.json
 */
function resolveSidecarPath(stateDir: string, sessionKey: string): string {
  const safeName = sessionKey.replace(/[^a-z0-9_\-:.]/gi, '_');
  return join(stateDir, 'plugins', 'kasett-rewind', 'meta', `${safeName}.json`);
}

async function readSidecarMeta(stateDir: string, sessionKey: string): Promise<ThreadMeta | null> {
  try {
    const sidecarPath = resolveSidecarPath(stateDir, sessionKey);
    const raw = await readFile(sidecarPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'main' in parsed &&
      'sub' in parsed &&
      typeof (parsed as { main: unknown }).main === 'string' &&
      Array.isArray((parsed as { sub: unknown }).sub)
    ) {
      const p = parsed as { main: string; sub: unknown[] };
      if (p.sub.length === 3 && p.sub.every((s) => typeof s === 'string')) {
        return { main: p.main, sub: p.sub as [string, string, string] };
      }
    }
    return null;
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeSidecarMeta(stateDir: string, sessionKey: string, meta: ThreadMeta): Promise<void> {
  const sidecarPath = resolveSidecarPath(stateDir, sessionKey);
  await mkdir(dirname(sidecarPath), { recursive: true });
  await writeFile(sidecarPath, JSON.stringify(meta, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Session file resolution
// ---------------------------------------------------------------------------

async function resolveSessionFile(
  api: PluginAPI,
  ctx: HookContext,
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

  // Strategy 2: derive path from state dir
  const sessionId = ctx.sessionId?.trim();
  if (sessionId) {
    try {
      const stateDir = api.runtime.state.resolveStateDir();
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

  // Strategy 2: derive from stateDir
  // sessionKey might be a full key like "agent:main:telegram:..." — use it as session file name
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
    const raw = (api.pluginConfig ?? {}) as Partial<KasettConfig> & { enabled?: boolean };
    return {
      enabled: raw.enabled ?? true,
      windowSize: raw.windowSize ?? DEFAULT_CONFIG.windowSize,
      weights: raw.weights ?? DEFAULT_CONFIG.weights,
      threadTracking: raw.threadTracking ?? DEFAULT_CONFIG.threadTracking,
      compactionModel: raw.compactionModel ?? DEFAULT_CONFIG.compactionModel,
    };
  } catch {
    return { enabled: true, ...DEFAULT_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Public API Exports
// ---------------------------------------------------------------------------

export { SessionReader, KasettError } from './storage/reader.js';
export { analyzeThreads } from './threads/weight.js';
export type { WeightedThreadAnalysis } from './threads/weight.js';
export { buildSteeringPrompt, buildOrientationPrompt } from './threads/steering.js';
export { parseCompactionOutput } from './threads/parser.js';
export type { ParseResult } from './threads/parser.js';
export { emptyThreadMeta, isValidThreadMeta } from './threads/meta.js';
export { CompactionWindow } from './compaction/window.js';
export { generateConfig } from './cli/generate-config.js';
export type { GenerateConfigOptions } from './cli/generate-config.js';

export type {
  KasettConfig,
  CompactionEvent,
  ThreadMeta,
  ConversationTurn,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
