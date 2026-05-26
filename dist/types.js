/**
 * OpenClaw plugin interface types for kasett-rewind.
 * Simple thread meta model: 1 main thread + 3 sub-threads as plain strings.
 */
export const DEFAULT_CONFIG = {
    compaction: {
        // model is intentionally unset — defaults to agent's primary model
        hotSwap: true,
        hotSwapTimeoutMs: 30_000,
        windowSize: 3,
        weights: [1.0, 0.6, 0.3],
        compactionMaxTokens: 32000,
    },
    steering: {
        threadTracking: true,
    },
    coldStart: {
        enabled: true,
        minTurns: 2,
        maxIdleHours: 168,
        hotSwap: true,
        hotSwapTimeoutMs: 30_000,
        maxSourceTurns: 200,
    },
};
//# sourceMappingURL=types.js.map