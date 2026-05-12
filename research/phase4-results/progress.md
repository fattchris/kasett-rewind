# Phase 4 Progress Log

## Step 0: Setup
- Created `research/phase4-results/`
- Confirmed source file locations in `repos/kasett-rewind/src/`
- File sizes: index.ts (1297), hotswap/worker.ts (544), threads/weight.ts (546), threads/steering.ts (667), storage/reader.ts (605), storage/sidecar.ts (346)

## Step 1: HALF 1 complete
- Traced data flow through all 6 source files.
- Wrote `code-path-verification.md` documenting the live chain.
- Built `test-feedback-loop.mjs` — 11/11 checks pass against the actual built dist.
- Two minor gaps logged but non-blocking:
  1. `recentLifecycle` not passed by `buildCompactionContext` (lifecycle events stored on sidecar but not re-surfaced to next steering prompt).
  2. `previousSubIds`/`previousKeyState` only mined from the most-recent summary, not aggregated across the window.
- DECISION: proceed to HALF 2.

## Step 2: B1 — corpus built
- 3 conversations × 400 turns each = 1200 turns total.
- 4 compaction checkpoints per conversation.
- 36 probes total (12 per conversation, 3 per depth).
- Probe types: long-range-recall / decision-continuity / trajectory / thread-lineage.
- Renames + splits embedded for thread-lineage testing.
- File: `long-corpus.json`

## Step 3: B2 — Harness built
- `run-multi-compaction.mjs` — mirrors index.ts buildCompactionContext logic.
- Imports actual production functions from dist/.
- Vanilla path: each compaction summarizes only the segment, no prior context.
- Kasett path: reads previous N=3 sidecars via SessionReader.readLastNSummaries, weights [1.0, 0.6, 0.3], buildSteeringPrompt with previousSubIds + previousKeyState, parseCompactionOutputBestEffort, writes sidecar.
- Probes: vanilla answerer reads prose only; kasett answerer reads prose + JSON metadata.
- Judge: Sonnet 4.6 with string-match shortcut.

## Step 4: B2 execution — ran all 3 conversations
- conv-eks-migration: vanilla 2/12, kasett 6/12 — saved to results-eks.json
- conv-auth-launch: vanilla 2/12, kasett 5/12 — saved to results-auth.json
- conv-data-pipeline: vanilla 4/12, kasett 9/12 — saved to results-data.json

## Step 5: B3+B4 — analysis
- Overall: Vanilla 8/36 (22.2%), Kasett 20/36 (55.6%), Δ +33.3pp
- Recall@1 by depth: collapse to 0% for vanilla at depths 1-2; Kasett retains 33-44%
- McNemar p (one-tailed): 0.0002, two-tailed 0.0005
- Cohen's h: 0.70 (medium-large)
- Thread continuity 73% (27/37)
- Key state monotonic accumulation in all 3 conversations
- Feedback loop fired 9/9 expected times

## Step 6: B5 — Output documents written
- summary.md
- paper-1-update.md
- analysis.json (full numerics)
- results.json (merged)

## Next: B7 — Commit
