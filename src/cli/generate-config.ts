import { DEFAULT_CONFIG } from '../types.js';
import type { KasettConfig } from '../types.js';
import { KasettError } from '../storage/reader.js';

/**
 * Options for the generate-config command.
 */
export interface GenerateConfigOptions {
  /** Override window size (default: 3) */
  readonly windowSize?: number;
  /** Override thread tracking (default: true) */
  readonly threadTracking?: boolean;
  /** Override weights array */
  readonly weights?: readonly number[];
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

  const output: string[] = [];

  output.push('✓ Generated kasett-rewind configuration:');
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
        weights: config.weights,
        threadTracking: config.threadTracking,
      },
    },
  };

  output.push(JSON.stringify(pluginBlock, null, 2));
  output.push('');
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  output.push(`Window size: ${config.windowSize} | Thread tracking: ${config.threadTracking ? 'ON' : 'OFF'} | Weights: [${config.weights.join(', ')}]`);
  output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return output.join('\n');
}

/**
 * Build a validated KasettConfig from CLI options + defaults.
 */
function buildConfig(options: GenerateConfigOptions): KasettConfig {
  const windowSize = options.windowSize ?? DEFAULT_CONFIG.windowSize;
  const threadTracking = options.threadTracking ?? DEFAULT_CONFIG.threadTracking;

  let weights: number[];

  if (options.weights) {
    weights = [...options.weights];
  } else if (windowSize === DEFAULT_CONFIG.windowSize) {
    weights = [...DEFAULT_CONFIG.weights];
  } else {
    // Generate default weights with decay for the given window size
    weights = generateDefaultWeights(windowSize);
  }

  return { windowSize, weights, threadTracking };
}

/**
 * Generate default weights with exponential decay.
 * Most recent = 1.0, then 0.6^n decay.
 */
function generateDefaultWeights(windowSize: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < windowSize; i++) {
    weights.push(Math.round(Math.pow(0.6, i) * 100) / 100);
  }
  return weights;
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

  if (config.weights.length !== config.windowSize) {
    throw new KasettError(
      `weights length must equal windowSize (${config.windowSize}), got ${config.weights.length}`,
      'INVALID_CONFIG',
    );
  }

  for (const value of config.weights) {
    if (value < 0 || value > 1) {
      throw new KasettError(
        `weights values must be between 0 and 1, got ${value}`,
        'INVALID_CONFIG',
      );
    }
  }
}
