# Phase G — Progress Log

**Date started:** 2026-05-12
**Goal:** Close two non-blocking gaps identified in Phase 4 code-path verification.
- Gap 1: Lifecycle events not re-surfaced to next compaction's steering prompt.
- Gap 2: Continuity hints (previousSubIds, previousKeyState) only mined from latest summary; should aggregate across full window.

## Step status
- [x] G1 — Wire `readLatestLifecycleEvents` into `buildCompactionContext` — DONE
- [x] G2 — Aggregate previousSubIds + previousKeyState across full window with frequency weighting (core/fresh) — DONE
- [x] G3 — Tests (lifecycle-resurface, window-aggregation) + full suite green — DONE (448/448 pass; +14 new tests over baseline 434)
- [x] G4 — Re-run Phase 4 protocol with fixed plugin code — DONE
- [x] G5 — Update Paper 1 discussion — DONE
- [x] G6 — Commit and push — DONE (commit cced56a, pushed to origin/main)

## G4 results (honest)

**Behavioral (Recall@1) by depth:** unchanged. 22.2% → 22.2% vanilla; 55.6% → 55.6% Kasett. McNemar still p≈0.0005, kasettOnly=12, vanillaOnly=0.

**Behavioral by probe type:**
- long-range-recall: 76% → 82% (+5.9pp, +1 question)
- decision-continuity: 22% → 11% (-11.1pp, -1 question)
- trajectory: 80% (no change)
- thread-lineage: 20% (no change)

**Mechanism evidence:**
- Lifecycle events surfaced into next compaction’s steering: 2.56 events / transition avg (Phase 4 = 0, gap was wired-but-unused).
- Core sub IDs identified across the window (freq>=2): 1.22 / transition avg (Phase 4 = 0).
- Total key_state across all 12 compactions: 184 (Phase 4 = 160; +15%).
- Total sub-thread entries: 47 / 47 (no change).

## G4 interpretation
The mechanisms are unambiguously firing — every Kasett compaction with prior history now sees lifecycle hints and core-thread callouts, and key_state accumulation grew ~15%. But on this synthetic corpus at this probe difficulty, those extra signals don't translate into Recall@1 wins. The Phase 4 baseline already saturates the easy gains; the residual hard probes (decision-continuity rationale, renamed-thread lineage) require richer mechanisms (e.g. carrying decision rationale verbatim, structured rename log) that Phase G doesn't add.

This is consistent with the methodological note's pre-registered framing: "if G4 shows no change: include as 'ablation showing window-1 hints are sufficient at this regime.'" The Phase G mechanisms are still defensible (they expand the per-compaction signal envelope and may matter on noisier real-session data), but Phase 4 stands as the headline result for Paper 1.

## Notes
- Reusing same 3 conversations from Phase 4 (synthetic corpus is deterministic in seed/structure).
- Backward compat: old sidecars without `lifecycle_events` → `readLatestLifecycleEvents` returns []; non-blocking.

## Implementation summary

### G1 — Lifecycle re-surfacing
- Imported `LifecycleEvent` from `./threads/lifecycle.js` in index.ts.
- After resolving `sessionFile` in `buildCompactionContext`, call `reader.readLatestLifecycleEvents(sessionFile)` inside try/catch.
- Pass `recentLifecycle` to `buildSteeringPrompt` (was already supported by the steering builder).
- `lifecycleCount` returned from `buildCompactionContext` and logged via new `before_compaction:context_built` hook event in both sync and hot-swap paths.

### G2 — Window-aggregated continuity
- Loop over ALL `previousSummaries` (not just `[0]`).
- Track sub-ID frequency in a Map; sort previousSubIds by descending frequency (most-recurring first = "core").
- Build `coreSubIds` = IDs with frequency >=2.
- Dedupe key_state by `${kind}::${value}` across the window, preserving the most-recent entry.
- Added `coreSubIds` to `SteeringOptions` and surfaced in the JSON instructions block as a strong-preserve hint.
- Backwards compatible: if there's only one previous summary (window=1 effective), behavior matches the previous code (sub IDs in the order they appeared, no "core" callout, no recurrence).
