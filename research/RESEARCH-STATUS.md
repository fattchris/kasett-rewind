# Kasett Research Status — 2026-05-12

A consolidated view of what we've done on the research/benchmarking side, what we have data for, and what's still queued.

---

## Original research plan (from May 5)

We laid out three deliverables:

1. **STUDY-DESIGN.md** — 2×2 factorial design (Vanilla × Kasett × ALLM), grounded in established benchmarks (LoCoMo, RULER, QuestEval, LaMP, BERTScore, SummaC), 7 pre-registered hypotheses, two-paper strategy (Paper 1: Kasett alone at week 12; Paper 2: full system at week 24).

2. **COMPACTBENCH.md** — Formal benchmark spec, 5 tasks (Thread Persistence, Key State Retrieval, Trajectory Reconstruction, Steering Effectiveness, Multi-Compaction Degradation), released as HuggingFace dataset + GitHub harness + leaderboard.

3. **benchmarks-reference.md** — Full landscape of related work, gap analysis, novel-vs-established metric mapping.

All three documents shipped May 5.

---

## Phase 1 benchmark — what was run

**File:** `research/phase1-results/summary.md`
**Date:** 2026-05-05
**Method:** 10 synthetic sessions × 2 conditions (vanilla vs Kasett-steered prompt) on `anthropic/claude-sonnet-4-6` at temperature 0.

### Headline result

| Metric | Vanilla | Kasett | Δ | Cohen's d | Interpretation |
|--------|---------|--------|---|-----------|----------------|
| TRR | 0.930 | 0.930 | +0.000 | 0.00 | negligible |
| KSSR | 0.972 | 0.962 | -0.010 | -0.16 | negligible |

### What this tells us

**Synthetic-session benchmarking on May 5 showed no difference between Vanilla and Kasett-steered.** Both approaches retained ~93% of threads and ~97% of key state values. Effect size negligible.

### Why the result was null (what we know NOW that we didn't on May 5)

The May 5 benchmark was run **before Phase A→F shipped**. At that point:
- Kasett had no real production deployment
- The "Kasett-steered" condition was just a prompt-augmentation test, not the full plugin pipeline
- The synthetic sessions were too short / clean (1-6 threads, 3-11 key state values) — vanilla compaction handles those fine
- The complexity at which Kasett's structure helps (5+ threads, 20+ key state values, multi-day work) wasn't represented

### What May 5's null result actually means

Sonnet 4.6 is good enough at *prose summarization* of small synthetic sessions that thread retention isn't the bottleneck. That's a real finding. What it doesn't tell us is whether Kasett helps in the ACTUAL deployment regime — long-running real sessions with many parallel threads, dozens of file paths, multiple concurrent decisions.

**The benchmark needs to be re-run with realistic session data and the full plugin stack.**

---

## Phase A→F production work (May 12)

In one compressed sprint we:

1. **Phase A (verify):** Replayed 36 production compaction events through kasett's parser. Found compliance rate **0%** — but identified the actual failure mode: hot-swap was racing OC's session-file lock and timing out (`LOCK_WAIT_TIMEOUT`). This was a different bug than the strategic analysis predicted.

2. **Phase B1 (sidecar fix):** Replaced the JSONL hot-swap rewrite with append-only sidecar files. No more lock fight. Verified live in production.

3. **Phase B2 (schema v3):** Replaced markdown sentinel with structured JSON output. Schema includes stable IDs, status enum, decisions, open_questions.

4. **Phase C (key state):** Added `key_state[]` as a first-class V3 field. 6-kind detector (URLs, paths, IDs, versions, configs, values) finds candidates pre-compaction; LLM emits refined entries.

5. **Phase D (identity + lifecycle):** Multi-tier matcher (exact-id → Jaccard → fingerprint cosine). Detects created/completed/blocked/renamed/merged/split events between compactions.

6. **Phase E (cross-session):** Global thread index across all sessions. Cross-session orientation injection. Snapshot file with atomic rebuild.

7. **Phase F (production bug fixes):** max_tokens bumped to 32k, parser tolerates truncated JSON via bracket-balancing repair, sidecar path resolved correctly.

**411 unit tests pass. Two production compactions verified live.**

---

## Production data (just collected — May 12)

We have **two real compactions** under the Phase A→F plugin stack:

### Compaction #1: topic-12388 (LLM Hacking, 16:35 UTC)
- Input: 60 messages, 37k tokens
- Output: 14,113 chars (truncated by max_tokens before F1 landed)
- LLM emitted **full V3 JSON**: 5 sub-threads with stable IDs, 3 decisions, 3 open_questions, **20 key_state entries** (recovered via F2 parser repair)
- Compliance: ✅ Full V3 (after recovery)

### Compaction #2: topic-11727 (Session Stream, 17:16 UTC)
- Input: 100 messages, 76k tokens
- Output: 2,180 chars (no truncation)
- LLM emitted **pure prose** — no JSON block
- Compliance: ❌ schema=none, 0 key_state from 534 detected

### What this tells us

**LLM compliance with the V3 schema is variable.** The complex multi-thread session (topic-12388) got structured output. The single-task completion session (topic-11727) got prose. n=2, but the variance is real.

This is **the Phase B2 risk** the strategic analysis flagged. Path B (steering prompt + parser) achieves 90-95% compliance ceiling because compliance is at LLM discretion. Path A (provider-native tool_use with `strict: true`) achieves ~99%.

---

## What's still owed on the research side

### 1. Re-run Phase 1 with the real plugin stack
The May 5 benchmark used a prompt-injection mock. Now that Phase A→F is live, we should:
- Run the same 10 synthetic sessions through the actual kasett plugin (load via OC → trigger compaction → read sidecar)
- Compare to vanilla OC compaction
- Plus: add 5 more sessions with realistic complexity (10+ threads, 30+ key state values, multi-day arcs)

Expected result delta: For tier-3 complexity, Kasett should significantly outscore vanilla on KSSR (the schema explicitly tracks values; vanilla doesn't). TRR delta less predictable.

### 2. CompactBench v0.1 implementation
We have the spec. We don't have:
- The dataset (synthetic conversations + real anonymized sessions)
- The eval harness (automated TRR/KSSR/TCS/WSE/DGR scoring)
- Baseline runs
- The leaderboard scaffold

Building CompactBench v0.1 is a 2-3 week project. It's the "publishable benchmark" deliverable. Without it, the Paper 1 strategy is just a system paper, not a benchmark paper.

### 3. LoCoMo-adapted protocol run
Strategic analysis recommended running on LoCoMo's dataset for direct comparison to established work. Hasn't been done. Requires:
- Download LoCoMo dataset
- Adapt their multi-session recall protocol to multi-compaction recall
- Run vanilla + Kasett on the adapted protocol
- Report against LoCoMo's published baselines

### 4. NIAH-adapted post-compaction probes
Strategic analysis recommended planting key state values at controlled positions, compacting, then probing retrieval. We have the detector + Kasett's KSSR; we don't have a controlled probe protocol with position-stratified planting.

### 5. Compliance rate measurement (NEW since May 12)
The post-fix-compaction-2 finding makes this urgent:
- Track schema=v3 vs schema=none vs schema=v1 ratio across all production compactions
- Add a daily/weekly compliance report
- This becomes its own publishable metric: "% of compactions where structured output was emitted, by session complexity"

### 6. Path A activation experiment
If compliance rate stays below 90%:
- Switch default to `structuredOutput: 'tool'` (Anthropic tool_use API)
- Re-measure compliance rate
- Compare cost/latency overhead
- Decide whether the ~99% compliance is worth the per-provider code

### 7. ALLM
Not started. The strategic analysis said ALLM is research/patents only for now. Plugin stays Kasett-only. Paper 2 territory, not Paper 1.

---

## Honest read on publishability

### Paper 1: Kasett alone

**Status:** System is built. Has shipped 6 phases. Has 411 unit tests. Has 2 production compactions (n=2).

**What we still need for credible Paper 1:**
- Re-run the 10-session benchmark with the real plugin (realistic complexity tier added) → ~1-2 days
- Add 30 more production compactions worth of data → ~1-2 weeks of organic Chris use
- Run on LoCoMo subset → ~1 week
- Build CompactBench v0.1 → 2-3 weeks
- Compliance rate metric tracking → ~1 day

**Realistic Paper 1 timeline: 6-8 weeks from now** if we work the research track in parallel with regular product work.

### Paper 2: Kasett + ALLM + CompactBench

Not started. ALLM is patents-track. CompactBench needs Paper 1's data. Realistic Paper 2 timeline is the original 24 weeks.

---

## Recommended priorities (in order)

1. **Spawn a benchmark-rerun subagent** — re-run Phase 1's 10 synthetic sessions through the real plugin stack, this time measuring sidecar contents (V3 fields populated) vs vanilla output. Expected delta is large because Kasett tracks key_state explicitly.
2. **Add compliance rate tracking** — daily review counts schema=v3/none/v1, graphs over time. ~2 hours of work.
3. **Strengthen V3 steering prompt** — directly addresses the topic-11727 prose-only finding. ~1 hour.
4. **Begin CompactBench v0.1 dataset construction** — this is the multi-week investment but it's the highest-leverage research deliverable.

The four items together get us to "publishable Paper 1 draft" in 6-8 weeks of part-time research work alongside everything else.

---

*Filed: 2026-05-12 17:25 UTC. Driven by Chris's question "go back and look at the benchmarking and research we needed to do with this project."*
