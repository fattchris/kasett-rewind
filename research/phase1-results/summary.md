# Phase 1 Benchmark Results

## Overview

**Model:** anthropic/claude-sonnet-4-6 (temperature=0)
**Conditions:** Vanilla compaction vs. Kasett-steered compaction
**Sessions:** 10 (3 × Tier 1, 4 × Tier 2, 3 × Tier 3)
**Date:** 2026-05-05

## Results

### Per-Session

| Session | Tier | Threads | Keys | Vanilla TRR | Kasett TRR | Vanilla KSSR | Kasett KSSR |
|---------|------|---------|------|-------------|------------|--------------|-------------|
| session-01 | 1 | 1 | 3 | 1.00 | 1.00 | 1.00 | 1.00 |
| session-02 | 1 | 2 | 4 | 0.50 | 0.50 | 1.00 | 1.00 |
| session-03 | 1 | 2 | 4 | 1.00 | 1.00 | 1.00 | 1.00 |
| session-04 | 2 | 3 | 5 | 1.00 | 1.00 | 1.00 | 1.00 |
| session-05 | 2 | 4 | 6 | 1.00 | 1.00 | 0.83 | 0.83 |
| session-06 | 2 | 3 | 5 | 1.00 | 1.00 | 1.00 | 1.00 |
| session-07 | 2 | 3 | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| session-08 | 3 | 5 | 10 | 1.00 | 1.00 | 1.00 | 0.90 |
| session-09 | 3 | 5 | 9 | 0.80 | 0.80 | 0.89 | 0.89 |
| session-10 | 3 | 6 | 11 | 1.00 | 1.00 | 1.00 | 1.00 |

### Averages by Tier

| Tier | Vanilla TRR | Kasett TRR | Δ TRR | Vanilla KSSR | Kasett KSSR | Δ KSSR |
|------|-------------|------------|-------|--------------|-------------|--------|
| 1 | 0.83 | 0.83 | +0.00 | 1.00 | 1.00 | +0.00 |
| 2 | 1.00 | 1.00 | +0.00 | 0.96 | 0.96 | +0.00 |
| 3 | 0.93 | 0.93 | +0.00 | 0.96 | 0.93 | -0.03 |

### Overall

| Metric | Vanilla | Kasett | Δ | Cohen's d | Interpretation |
|--------|---------|--------|---|-----------|----------------|
| TRR | 0.930 | 0.930 | +0.000 | 0.00 | negligible |
| KSSR | 0.972 | 0.962 | -0.010 | -0.16 | negligible |

## Interpretation

TRR (Thread Retention Rate): Higher = more threads survived compaction.
KSSR (Key State Survival Rate): Higher = more specific values (URLs, paths, versions) survived verbatim.
Cohen's d: Effect size. |d| < 0.2 = negligible, 0.2-0.5 = small, 0.5-0.8 = medium, > 0.8 = large.

---
*Generated 2026-05-05T12:20:47.226Z by kasett-rewind Phase 1 benchmark harness.*
