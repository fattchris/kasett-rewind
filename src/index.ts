/**
 * kasett-rewind — OpenClaw Compaction Plugin
 *
 * Rolling compaction window + structured thread tracking.
 * Prevents goldfish brain by retaining N compaction summaries
 * and enforcing thread evolution rules across compactions.
 *
 * Registration modes:
 *   1. before_compaction hook — injects customInstructions dynamically
 *   2. after_compaction hook — validates thread evolution
 *
 * The plugin does NOT replace the LLM summarizer. It augments OC's
 * built-in compaction by injecting structured instructions and
 * validating the output.
 */

import { generateCustomInstructions } from './phase1/instructions.js';
import { ThreadTracker } from './compaction/threads.js';
import type { KasettConfig, ThreadSnapshot } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- OC Plugin SDK types (structural, not imported at runtime) ---

interface CompactionHookContext {
  messages: unknown[];
  previousSummary?: string;
  customInstructions?: string;
  compressionRatio?: number;
}

interface CompactionResult {
  summary: string;
}

interface PluginAPI {
  getConfig<T>(pluginId: string): T;
  hooks: {
    on(event: 'before_compaction', handler: (ctx: CompactionHookContext) => CompactionHookContext | void): void;
    on(event: 'after_compaction', handler: (result: CompactionResult) => void): void;
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
 *
 * If `enabled` is false in config, does nothing — plugin is invisible.
 * If `enabled` is true, registers:
 *   - before_compaction hook to inject structured instructions
 *   - after_compaction hook to validate thread evolution
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

  let lastThreadSnapshot: ThreadSnapshot | undefined;

  // Hook 1: Inject structured compaction instructions before OC runs the summarizer
  api.hooks.on('before_compaction', (ctx: CompactionHookContext) => {
    const instructions = generateCustomInstructions(config);

    // If there's a previous summary, try to parse thread state from it
    if (ctx.previousSummary && config.threadTracking) {
      lastThreadSnapshot = ThreadTracker.parse(ctx.previousSummary);
      api.log.debug(
        `[kasett-rewind] Parsed previous thread state: main="${lastThreadSnapshot.mainThread}"`,
      );
    }

    // Inject our instructions (merges with any existing customInstructions)
    const merged = ctx.customInstructions
      ? `${ctx.customInstructions}\n\n${instructions}`
      : instructions;

    return { ...ctx, customInstructions: merged };
  });

  // Hook 2: Validate thread evolution after compaction completes
  api.hooks.on('after_compaction', (result: CompactionResult) => {
    if (!config.threadTracking) return;

    const currentSnapshot = ThreadTracker.parse(result.summary);

    if (lastThreadSnapshot) {
      const violations = ThreadTracker.validate(currentSnapshot, lastThreadSnapshot);

      if (violations.length > 0) {
        api.log.warn(
          `[kasett-rewind] Thread evolution violations (${violations.length}):`,
        );
        for (const v of violations) {
          api.log.warn(`  → ${v}`);
        }
      } else {
        api.log.debug('[kasett-rewind] Thread evolution validated ✓');
      }
    }

    // Store for next compaction cycle
    lastThreadSnapshot = currentSnapshot;
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
      windowBudgetSplit: raw.windowBudgetSplit ?? DEFAULT_CONFIG.windowBudgetSplit,
      threadTracking: raw.threadTracking ?? DEFAULT_CONFIG.threadTracking,
    };
  } catch {
    // If config fetch fails, use defaults with enabled=true
    return { enabled: true, ...DEFAULT_CONFIG };
  }
}

// --- Public API Exports ---

export { CompactionProvider } from './compaction/provider.js';
export { CompactionWindow } from './compaction/window.js';
export { ThreadTracker } from './compaction/threads.js';
export { buildCompactionPrompt } from './compaction/prompt.js';

// Phase 1 exports
export { generateCustomInstructions, KasettError } from './phase1/instructions.js';
export { SectionLoader } from './phase1/section-loader.js';
export type { LoadedSections } from './phase1/section-loader.js';

// Storage exports
export { SessionReader } from './storage/reader.js';

// CLI exports
export { generateConfig } from './cli/generate-config.js';
export type { GenerateConfigOptions } from './cli/generate-config.js';

export type {
  CompactionSummary,
  CompactionContext,
  ThreadSnapshot,
  SubThread,
  KasettConfig,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
