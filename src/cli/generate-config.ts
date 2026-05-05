import { DEFAULT_CONFIG } from '../types.js';
import { generateCustomInstructions, KasettError } from '../phase1/instructions.js';
import type { KasettConfig } from '../types.js';

/**
 * Options for the generate-config command.
 */
export interface GenerateConfigOptions {
  /** Override window size (default: 2) */
  readonly windowSize?: number;
  /** Override thread tracking (default: true) */
  readonly threadTracking?: boolean;
  /** Override budget split array */
  readonly budgetSplit?: readonly number[];
}

/**
 * Generates the full openclaw.json configuration output.
 * Validates all inputs and produces ready-to-paste JSON blocks.
 *
 * @param options - CLI flags parsed into options
 * @returns Formatted string output for the terminal
 * @throws KasettError on invalid configuration
 */
export function generateConfig(options: GenerateConfigOptions): string {
  const config = buildConfig(options);
  validateConfig(config);

  const customInstructions = generateCustomInstructions(config);
  const output: string[] = [];

  output.push('✓ Generated kasett-rewind configuration:');
  output.push('');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push('Add to your openclaw.json → "compaction" section:');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push('');

  const compactionBlock = {
    compaction: {
      customInstructions,
      maxHistoryShare: computeMaxHistoryShare(config),
    },
  };

  output.push(JSON.stringify(compactionBlock, null, 2));
  output.push('');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push('Add to your openclaw.json → "plugins.entries" section:');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push('');

  const pluginBlock = {
    'kasett-rewind': {
      enabled: true,
      path: './node_modules/kasett-rewind',
      config: {
        windowSize: config.windowSize,
        windowBudgetSplit: config.windowBudgetSplit,
        threadTracking: config.threadTracking,
      },
    },
  };

  output.push(JSON.stringify(pluginBlock, null, 2));
  output.push('');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push(`Window size: ${config.windowSize} | Thread tracking: ${config.threadTracking ? 'ON' : 'OFF'} | Budget split: [${config.windowBudgetSplit.join(', ')}]`);
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return output.join('\n');
}

/**
 * Build a validated KasettConfig from CLI options + defaults.
 */
function buildConfig(options: GenerateConfigOptions): KasettConfig {
  const windowSize = options.windowSize ?? DEFAULT_CONFIG.windowSize;
  const threadTracking = options.threadTracking ?? DEFAULT_CONFIG.threadTracking;

  let windowBudgetSplit: number[];

  if (options.budgetSplit) {
    windowBudgetSplit = [...options.budgetSplit];
  } else if (windowSize === DEFAULT_CONFIG.windowSize) {
    windowBudgetSplit = [...DEFAULT_CONFIG.windowBudgetSplit];
  } else {
    // Generate a sensible default split for the given window size
    windowBudgetSplit = generateDefaultSplit(windowSize);
  }

  return { windowSize, windowBudgetSplit, threadTracking };
}

/**
 * Generate a sensible default budget split for a given window size.
 * Allocates 40% to recent turns and divides the rest evenly among summaries.
 */
function generateDefaultSplit(windowSize: number): number[] {
  const recentTurnsShare = 0.4;
  const summaryShare = (1 - recentTurnsShare) / windowSize;
  const split: number[] = [];

  for (let i = 0; i < windowSize; i++) {
    split.push(Math.round(summaryShare * 100) / 100);
  }
  split.push(recentTurnsShare);

  // Normalize to sum to exactly 1.0
  const sum = split.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    // Adjust the last summary slot to compensate for rounding
    split[windowSize - 1] += 1.0 - sum;
    split[windowSize - 1] = Math.round(split[windowSize - 1] * 100) / 100;
  }

  return split;
}

/**
 * Validate a KasettConfig and throw on invalid state.
 */
function validateConfig(config: KasettConfig): void {
  if (config.windowSize < 1 || config.windowSize > 5) {
    throw new KasettError(
      `windowSize must be between 1 and 5, got ${config.windowSize}`,
      'INVALID_CONFIG',
    );
  }

  if (!Number.isInteger(config.windowSize)) {
    throw new KasettError(
      `windowSize must be an integer, got ${config.windowSize}`,
      'INVALID_CONFIG',
    );
  }

  const expectedLength = config.windowSize + 1;
  if (config.windowBudgetSplit.length !== expectedLength) {
    throw new KasettError(
      `windowBudgetSplit length must be windowSize + 1 (${expectedLength}), got ${config.windowBudgetSplit.length}`,
      'INVALID_CONFIG',
    );
  }

  const sum = config.windowBudgetSplit.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new KasettError(
      `windowBudgetSplit must sum to 1.0 (±0.01), got ${sum}`,
      'INVALID_CONFIG',
    );
  }

  for (const value of config.windowBudgetSplit) {
    if (value < 0 || value > 1) {
      throw new KasettError(
        `windowBudgetSplit values must be between 0 and 1, got ${value}`,
        'INVALID_CONFIG',
      );
    }
  }
}

/**
 * Compute maxHistoryShare for OC config.
 * This is the proportion of context allocated to compaction summaries
 * (everything except recent turns).
 */
function computeMaxHistoryShare(config: KasettConfig): number {
  // Recent turns is the last element of the split
  const recentTurnsShare = config.windowBudgetSplit[config.windowBudgetSplit.length - 1];
  return Math.round((1 - recentTurnsShare) * 100) / 100;
}
