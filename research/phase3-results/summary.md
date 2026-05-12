# Phase 3 — Behavioral Probe Benchmark Results

**Date:** 2026-05-12T20:22:02.893Z
**Probes:** 50 (5 scenarios × 10 facts each)
**Compaction model:** anthropic/claude-sonnet-4-5
**Probe-answer model:** anthropic/claude-sonnet-4-5
**LLM-judge model:** anthropic/claude-sonnet-4-6 (different model — bias control)

---

## 1. Headline: Recall@1

Primary metric is **semantic_match** (judged by Sonnet 4.6 — does the candidate answer correctly identify the expected answer, allowing paraphrase).
Secondary metric is **exact_match** (lowercase substring presence).

### Semantic Recall@1

| Condition | Correct | Recall@1 | 95% CI (Wilson) |
|---|---|---|---|
| Vanilla | 50/50 | 1.000 | [0.929, 1.000] |
| Kasett  | 49/50 | 0.980 | [0.895, 0.996] |
| **Δ (K − V)** | **-1** | **-0.020** | — |

- **Cohen's h:** -0.284 (Small)
- **McNemar paired test:** b=1 (V✓ K✗), c=0 (V✗ K✓), exact two-sided p=1.0000

### Exact-match Recall@1

| Condition | Correct | Recall@1 | 95% CI (Wilson) |
|---|---|---|---|
| Vanilla | 39/50 | 0.780 | [0.648, 0.872] |
| Kasett  | 39/50 | 0.780 | [0.648, 0.872] |
| **Δ (K − V)** | **+0** | **+0.000** | — |

- **Cohen's h:** 0.000 (Negligible)
- **McNemar paired test:** b=3 (V✓ K✗), c=3 (V✗ K✓), exact two-sided p=0.9688

---

## 2. Recall by position bucket (LoCoMo-style stratification)

Probes are stratified by where the planted fact lives in the conversation:
- **early:** position ≤ 0.25
- **mid:**   0.25 < position ≤ 0.65
- **late:**  position > 0.65

| Bucket | n | V semantic | K semantic | Δ sem | V exact | K exact | Δ exact |
|---|---|---|---|---|---|---|---|
| early | 15 | 1.000 | 0.933 | -0.067 | 0.933 | 0.867 | -0.067 |
| mid | 20 | 1.000 | 1.000 | +0.000 | 0.650 | 0.650 | +0.000 |
| late | 15 | 1.000 | 1.000 | +0.000 | 0.800 | 0.867 | +0.067 |

LoCoMo expectation: vanilla degrades more on early-position facts (further from end of summary). If we observe this pattern, Kasett's structured key_state should preserve early facts better.

---

## 3. Recall by kind

| Kind | n | V semantic | K semantic | Δ sem | V exact | K exact | Δ exact |
|---|---|---|---|---|---|---|---|
| blocker | 5 | 1.000 | 1.000 | +0.000 | 0.200 | 0.400 | +0.200 |
| command | 5 | 1.000 | 1.000 | +0.000 | 1.000 | 1.000 | +0.000 |
| deadline | 5 | 1.000 | 1.000 | +0.000 | 0.800 | 1.000 | +0.200 |
| decision | 5 | 1.000 | 1.000 | +0.000 | 0.400 | 0.200 | -0.200 |
| error | 4 | 1.000 | 1.000 | +0.000 | 0.250 | 0.250 | +0.000 |
| path | 5 | 1.000 | 1.000 | +0.000 | 1.000 | 1.000 | +0.000 |
| person | 5 | 1.000 | 1.000 | +0.000 | 1.000 | 1.000 | +0.000 |
| url | 5 | 1.000 | 1.000 | +0.000 | 1.000 | 1.000 | +0.000 |
| value | 7 | 1.000 | 0.857 | -0.143 | 1.000 | 0.857 | -0.143 |
| version | 4 | 1.000 | 1.000 | +0.000 | 1.000 | 1.000 | +0.000 |

Hypothesis: URL/path/version probes should benefit MORE from Kasett (key_state is designed for these). Decisions/blockers should benefit moderately. Person/deadline less.

---

## 4. Per-scenario Recall

| Scenario | Name | n | V sem | K sem | Δ sem | V exact | K exact | Kasett SY | has_meta |
|---|---|---|---|---|---|---|---|---|---|
| A | Multi-thread engineering work | 10 | 1.000 | 1.000 | +0.000 | 0.700 | 0.700 | 18 | true |
| B | Multi-day research project | 10 | 1.000 | 1.000 | +0.000 | 0.900 | 1.000 | 19 | true |
| C | Customer support session | 10 | 1.000 | 0.900 | -0.100 | 0.800 | 0.700 | 11 | true |
| D | Multi-task standup | 10 | 1.000 | 1.000 | +0.000 | 0.800 | 0.800 | 14 | true |
| E | Cross-thread debug | 10 | 1.000 | 1.000 | +0.000 | 0.700 | 0.700 | 9 | true |

---

## 5. Hallucination & No-answer

Hallucination = LLM-judge identifies a fabricated specific value (URL/number/name/etc.) not in context.
Denominator: probes where the agent attempted an answer (excludes no-answer responses).

| Condition | Attempted (n) | Hallucinated | Hall rate | No-answer (of 50) | No-answer rate |
|---|---|---|---|---|---|
| Vanilla | 50 | 0 | 0.000 | 0 | 0.000 |
| Kasett  | 49 | 0 | 0.000 | 1 | 0.020 |

Higher no-answer rate is honest (no fabrication); lower can be either better recall OR more hallucination.

---

## 6. Interpretation

Hypothesis (RQ1): Kasett Recall@1 > Vanilla Recall@1 by ≥ 10 percentage points.

**Observed:**
- Semantic: -2.0 pp (Cohen's h -0.28 Small)
- Exact:    +0.0 pp (Cohen's h 0.00 Negligible)

**Direction of effect on McNemar's discordant pairs:**
- Semantic: c-b = -1 (positive favors Kasett)
- Exact:    c-b = 0 (positive favors Kasett)

**Pre-registered hypothesis status:**
- Semantic Recall@1 ≥ +10pp: ❌ NOT MET
- Statistically significant (p<0.05): semantic ❌, exact ❌

### Why the observed delta may be smaller than predicted

The original hypothesis (vanilla 0.55–0.70, Kasett 0.75–0.90) assumed the prose summary would lose specific values. Observed result: vanilla scored 1.00 — the prose summary actually preserves most planted facts.

This could be:

1. **Synthetic conversations are too clean.** 80–150-turn conversations with explicit, well-formed plants are easy for Sonnet 4.5 to summarize. Real Molt sessions have ambiguity, aborted threads, partial facts — much harder to compress without loss. The benchmark needs to stress compaction more than this corpus does.
2. **Ceiling effect on the probe-answer call.** The probe-answer LLM is also Sonnet 4.5 — strong enough to answer paraphrastically from a decent prose summary even when the exact value is missing.
3. **Compaction ratio is too low.** The conversations compress to a 2–4KB summary from a ~20–30KB transcript. That's roughly a 10:1 ratio. Real production compaction operates at 30:1 or higher and that's where loss begins to bite.
4. **Single compaction.** STUDY-DESIGN's protocol calls for 3–5 compaction cycles; we ran one. Cumulative loss is the regime where Kasett's structure should help most. Phase 3.5 should run multi-compaction probes.

This is itself a publishable finding: at single-compaction depth on synthetic data with strong models, structured output preservation does not measurably move behavioral recall. The structural delta (SY=0 vs SY=18) reported in Phase 2 remains the strongest categorical advantage; behavioral benefit emerges only under harder regimes.

---

## 7. Summary statistics (raw)

- N probes: 50
- Scenarios: 5
- All Kasett compactions emitted parseable V3 meta: YES
- Mean Kasett SY across scenarios: 14.2
- Vanilla SY (by construction): 0

---

## 8. Methodological honesty

This phase explicitly corrects Phase 2's framing. Phase 2 measured machinery (does Kasett emit structured output — yes, +18 artifacts/session). Phase 3 measures behavior (does Kasett make the agent more accurate at recalling planted facts after compaction).

The two questions are not the same. We initially conflated them. Phase 3 is the real RQ1 answer.

The result is more nuanced than the original hypothesis predicted: **on this corpus**, with strong models on both sides of the compaction, the prose summary already retains most planted facts. Kasett's structural advantage from Phase 2 is real and does not translate to a large behavioral delta in this single-compaction synthetic setting.

This does NOT mean Kasett doesn't help. It means:
- The benchmark needs more compaction stress (multi-cycle, higher compression ratio, real session noise)
- The structural delta is the categorical claim; the behavioral delta is small at single-compaction depth
- Future work should run multi-compaction degradation curves (RQ4 from STUDY-DESIGN)

---

## 9. Cost & runtime

- LLM calls: 5 scenarios × (2 compactions + 10 probes × 6 calls) = 310 calls
- Wall time: 1305s
- Estimated cost: ~$2 (well under the $15 budget)
