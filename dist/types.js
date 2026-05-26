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
        // Bumped from 30s to 90s in v0.3.1 — production diag showed compaction
        // LLM calls regularly take 30-55s for moderately-sized transcripts. 30s
        // hit timeouts in real load.
        hotSwapTimeoutMs: 90_000,
        maxSourceTurns: 200,
    },
};
//# sourceMappingURL=types.js.map