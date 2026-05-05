/**
 * kasett-rewind — OpenClaw Compaction Plugin
 *
 * Simple thread-meta feedback loop:
 * - before_compaction: reads N previous thread metas, weights them,
 *   builds a steering prompt, injects as customInstructions
 * - after_compaction: parses [THREAD_META] from output, stores alongside summary
 * - context_load: injects short orientation string from most recent thread meta
 *
 * The plugin does NOT replace the LLM summarizer. It augments OC's
 * built-in compaction by injecting structured instructions and
 * parsing structured output.
 */

import { SessionReader, KasettError } from './storage/reader.js';
import { analyzeThreads } from './threads/weight.js';
import { buildSteeringPrompt, buildOrientationPrompt } from './threads/steering.js';
import { parseCompactionOutput } from './threads/parser.js';
import type { KasettConfig, ThreadMeta } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- OC Plugin SDK types (structural, not imported at runtime) ---

interface CompactionHookContext {
  messages: unknown[];
  previousSummary?: string;
  customInstructions?: string;
  compressionRatio?: number;
  sessionFilePath?: string;
}

interface CompactionResult {
  summary: string;
}

interface ContextLoadHookContext {
  sessionFilePath?: string;
  additionalContext?: string;
}

interface PluginAPI {
  getConfig<T>(pluginId: string): T;
  hooks: {
    on(event: 'before_compaction', handler: (ctx: CompactionHookContext) => CompactionHookContext | Promise<CompactionHookContext | void> | void): void;
    on(event: 'after_compaction', handler: (result: CompactionResult) => CompactionResult | void): void;
    on(event: 'context_load', handler: (ctx: ContextLoadHookContext) => ContextLoadHookContext | Promise<ContextLoadHookContext | void> | void): void;
  };
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    debug(msg: string): void;
  };
}

// --- Plugin Registration ---

/**
 * Main plugin entry point. Called by the OC plugin loader on startup.
 */
export function register(api: PluginAPI): void {
  const config = resolveConfig(api);

  if (!config.enabled) {
    api.log.info('[kasett-rewind] Plugin disabled via config — skipping registration');
    return;
  }

  api.log.info(
    `[kasett-rewind] Registering — window=${config.windowSize}, threads=${config.threadTracking}`,
  );

  const reader = new SessionReader();

  // Hook 1: Before compaction — inject steering prompt
  api.hooks.on('before_compaction', async (ctx: CompactionHookContext) => {
    if (!config.threadTracking || !ctx.sessionFilePath) {
      return ctx;
    }

    try {
      // Read previous thread metas
      const events = await reader.readLastNWithMeta(ctx.sessionFilePath, config.windowSize);
      const metas: ThreadMeta[] = events
        .filter((e) => e.data.kaspiett != null)
        .map((e) => e.data.kaspiett!)
        .reverse(); // Most recent first for weight analysis

      if (metas.length === 0) {
        // No previous thread metas — still inject basic format instructions
        const basicSteering = buildSteeringPrompt({ core: [], fresh: [], fading: [] }, []);
        const merged = ctx.customInstructions
          ? `${ctx.customInstructions}\n\n${basicSteering}`
          : basicSteering;
        return { ...ctx, customInstructions: merged };
      }

      // Weight and analyze threads
      const analysis = analyzeThreads(metas, config.weights);

      // Build steering prompt
      const steering = buildSteeringPrompt(analysis, metas);

      api.log.debug(
        `[kasett-rewind] Steering: ${analysis.core.length} core, ${analysis.fresh.length} fresh, ${analysis.fading.length} fading`,
      );

      // Inject (merge with existing customInstructions)
      const merged = ctx.customInstructions
        ? `${ctx.customInstructions}\n\n${steering}`
        : steering;

      return { ...ctx, customInstructions: merged };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.log.warn(`[kasett-rewind] Failed to build steering prompt: ${msg}`);
      return ctx;
    }
  });

  // Hook 2: After compaction — parse thread meta from output
  api.hooks.on('after_compaction', (result: CompactionResult) => {
    if (!config.threadTracking) return;

    const parsed = parseCompactionOutput(result.summary);

    if (parsed.meta) {
      api.log.debug(
        `[kasett-rewind] Extracted thread meta: main="${parsed.meta.main}"`,
      );

      // Return modified result with clean summary + kaspiett meta embedded
      // OC will store this in the compaction event
      const enrichedData = {
        summary: parsed.summary,
        kaspiett: parsed.meta,
      };

      return { summary: JSON.stringify(enrichedData) } as CompactionResult;
    } else {
      api.log.warn('[kasett-rewind] No [THREAD_META] block found in compaction output');
    }
  });

  // Hook 3: Context load — inject orientation string
  api.hooks.on('context_load', async (ctx: ContextLoadHookContext) => {
    if (!config.threadTracking || !ctx.sessionFilePath) {
      return ctx;
    }

    try {
      const latestMeta = await reader.readLatestMeta(ctx.sessionFilePath);

      if (latestMeta) {
        const orientation = buildOrientationPrompt(latestMeta);
        api.log.debug(`[kasett-rewind] Injecting orientation: "${latestMeta.main}"`);

        const merged = ctx.additionalContext
          ? `${ctx.additionalContext}\n\n${orientation}`
          : orientation;

        return { ...ctx, additionalContext: merged };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.log.warn(`[kasett-rewind] Failed to load orientation: ${msg}`);
    }

    return ctx;
  });
}

/**
 * Resolve plugin config with defaults.
 */
function resolveConfig(api: PluginAPI): KasettConfig & { enabled: boolean } {
  try {
    const raw = api.getConfig<Partial<KasettConfig> & { enabled?: boolean }>('kasett-rewind');
    return {
      enabled: raw.enabled ?? true,
      windowSize: raw.windowSize ?? DEFAULT_CONFIG.windowSize,
      weights: raw.weights ?? DEFAULT_CONFIG.weights,
      threadTracking: raw.threadTracking ?? DEFAULT_CONFIG.threadTracking,
    };
  } catch {
    return { enabled: true, ...DEFAULT_CONFIG };
  }
}

// --- Public API Exports ---

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
