/**
 * Phase G — Window-aggregated continuity hints.
 *
 * Tests `aggregateContinuityHints` (the pure helper extracted from
 * `buildCompactionContext`) to verify that previousSubIds, coreSubIds,
 * and previousKeyState are aggregated across the FULL window of previous
 * summaries — not just the most recent one.
 *
 * Also verifies that when the aggregated hints are passed to
 * `buildSteeringPrompt`, the resulting prompt highlights "core" sub-thread
 * IDs that have appeared in 2+ previous compactions.
 */
export {};
//# sourceMappingURL=index-window-aggregation.test.d.ts.map