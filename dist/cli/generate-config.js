import { DEFAULT_CONFIG } from '../types.js';
import { KasettError } from '../storage/reader.js';
/**
 * Generates the full openclaw.json configuration output.
 * Validates all inputs and produces ready-to-paste JSON blocks.
 *
 * @param options - CLI flags parsed into options
 * @returns Formatted string output for the terminal
 * @throws KasettError on invalid configuration
 */
export function generateConfig(options) {
    const config = buildConfig(options);
    validateConfig(config);
    const output = [];
    output.push('✓ Generated kasett-rewind configuration:');
    output.push('');
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.push('Step 1 — Add to "plugins.entries" in openclaw.json:');
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.push('');
    const pluginBlock = {
        'kasett-rewind': {
            enabled: true,
            path: './node_modules/kasett-rewind',
            config: {
                compaction: {
                    windowSize: config.compaction.windowSize,
                    weights: config.compaction.weights,
                },
                steering: {
                    threadTracking: config.steering.threadTracking,
                },
            },
        },
    };
    output.push(JSON.stringify(pluginBlock, null, 2));
    output.push('');
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.push('Step 2 — Activate the provider (MERGE into "agents.defaults"):');
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.push('');
    const providerBlock = {
        compaction: {
            provider: 'kasett-rewind',
            mode: 'safeguard',
        },
    };
    output.push(JSON.stringify(providerBlock, null, 2));
    output.push('');
    output.push('  ⚠️  Do NOT put compaction on a specific agent entry (agents.list[].compaction).');
    output.push('      That\'s not a valid schema slot — OC will reject the config and the gateway');
    output.push('      will enter a respawn loop. Always use agents.defaults.compaction.');
    output.push('');
    output.push('  Or via CLI (recommended):');
    output.push('    openclaw config set agents.defaults.compaction.provider "kasett-rewind"');
    output.push('    openclaw config set agents.defaults.compaction.mode "safeguard"');
    output.push('');
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.push(`Window size: ${config.compaction.windowSize} | Thread tracking: ${config.steering.threadTracking ? 'ON' : 'OFF'} | Weights: [${config.compaction.weights.join(', ')}]`);
    output.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return output.join('\n');
}
/**
 * Build a validated KasettConfig from CLI options + defaults.
 */
function buildConfig(options) {
    const windowSize = options.windowSize ?? DEFAULT_CONFIG.compaction.windowSize;
    const threadTracking = options.threadTracking ?? DEFAULT_CONFIG.steering.threadTracking;
    let weights;
    if (options.weights) {
        weights = [...options.weights];
    }
    else if (windowSize === DEFAULT_CONFIG.compaction.windowSize) {
        weights = [...DEFAULT_CONFIG.compaction.weights];
    }
    else {
        // Generate default weights with decay for the given window size
        weights = generateDefaultWeights(windowSize);
    }
    return {
        compaction: {
            windowSize,
            weights,
            hotSwap: DEFAULT_CONFIG.compaction.hotSwap,
            hotSwapTimeoutMs: DEFAULT_CONFIG.compaction.hotSwapTimeoutMs,
        },
        steering: {
            threadTracking,
        },
    };
}
/**
 * Generate default weights with exponential decay.
 * Most recent = 1.0, then 0.6^n decay.
 */
function generateDefaultWeights(windowSize) {
    const weights = [];
    for (let i = 0; i < windowSize; i++) {
        weights.push(Math.round(Math.pow(0.6, i) * 100) / 100);
    }
    return weights;
}
/**
 * Validate a KasettConfig and throw on invalid state.
 */
function validateConfig(config) {
    const { windowSize, weights } = config.compaction;
    if (windowSize < 1 || windowSize > 5) {
        throw new KasettError(`windowSize must be between 1 and 5, got ${windowSize}`, 'INVALID_CONFIG');
    }
    if (!Number.isInteger(windowSize)) {
        throw new KasettError(`windowSize must be an integer, got ${windowSize}`, 'INVALID_CONFIG');
    }
    if (weights.length !== windowSize) {
        throw new KasettError(`weights length must equal windowSize (${windowSize}), got ${weights.length}`, 'INVALID_CONFIG');
    }
    for (const value of weights) {
        if (value < 0 || value > 1) {
            throw new KasettError(`weights values must be between 0 and 1, got ${value}`, 'INVALID_CONFIG');
        }
    }
}
//# sourceMappingURL=generate-config.js.map