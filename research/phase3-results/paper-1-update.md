# Proposed Insertion into PAPER-1-DRAFT.md

This file proposes the new section to add (and the small addition to acknowledge methodological correction). It does not replace anything in §3.4; both findings stand. The Phase 2 result (SY: 0 vs 18.20) remains the categorical claim. Phase 3 adds a behavioral measurement that the original 2×2 design called for and we initially skipped.

---

## §3.4.5 Behavioral Recall (RQ1)

### 3.4.5.1 Why we ran this

§3.4.3 reports Structure Yield — a count of structured artifacts the next compaction cycle can consume. SY answers "did Kasett deliver structure?" It does not answer "does Kasett make the agent more accurate at remembering things across compaction?" That is RQ1 from STUDY-DESIGN §2: *Does weighted thread meta steering improve context retention across multiple compaction cycles?*

Structural and behavioral retention are different constructs. We initially conflated them. SY is necessary but not sufficient for behavioral benefit; the structured output has to actually change what the next-cycle agent answers.

### 3.4.5.2 Protocol (NIAH-adapted, single-compaction)

We adapted the LoCoMo + RULER protocols from §5.1 / §5.2 of STUDY-DESIGN:

1. **Probe corpus.** 5 synthetic scenarios × 10 planted facts each = 50 probes total. Scenarios span 90–140 turns of plausible domain-specific conversation (engineering, research, support, standup, debug). Each fact is a `{question, expected_answer, position, kind}` planted exactly once at a controlled position. `kind ∈ {url, version, path, decision, blocker, deadline, person, command, error, value}`. `position ∈ [0, 1]` is normalized depth in the conversation. Position stratification: 3 facts early (≤ 0.25), 4 facts mid (0.25–0.65), 3 facts late (> 0.65) per scenario.
2. **Compaction.** For each scenario, run two compactions:
   - **Vanilla** — the same Sonnet 4.5 prose-summary prompt as §3.3.1.
   - **Kasett** — production V3 steering prompt + parser, identical to §3.3.1.
3. **Probe answer.** For each of the 50 probes, ask a fresh Sonnet 4.5 call (temperature 0.2) to answer the probe question given:
   - **Vanilla condition:** prose summary only.
   - **Kasett condition:** prose summary + the parsed `main`, `sub[].label`, `key_state[]`, `decisions[]`, `open_questions[]` fields formatted as a bulleted "Structured context" block.
   The answerer is instructed to say "I don't have that information" when the context does not support an answer.
4. **Score.** Each answer is scored four ways:
   - `exact_match`: lowercase substring of `expected_answer` in answer.
   - `semantic_match`: LLM judge (Sonnet 4.6, different model — bias control) decides yes/no whether the candidate correctly identifies the expected answer (paraphrase counts).
   - `hallucinated`: LLM judge decides yes/no whether the candidate fabricated a specific value not supported by the context.
   - `no_answer`: regex over common refusal patterns.

Decoding: temperature 0 for compaction and judge calls; temperature 0.2 for probe-answer calls. 2-second delay between API calls. Total: 310 LLM calls, ~22 minutes wall time, ~\$2 OpenRouter spend.

### 3.4.5.3 Headline result (n = 50 probes)

| Condition | Semantic Recall@1 | 95% CI (Wilson) | Exact-match Recall@1 |
|---|---|---|---|
| Vanilla | 1.000 (50/50) | [0.929, 1.000] | 0.780 (39/50) |
| Kasett  | 0.980 (49/50) | [0.895, 0.996] | 0.780 (39/50) |
| **Δ (K − V)** | **−0.020** | — | **+0.000** |

McNemar's exact two-sided paired test (semantic): b = 1 (V✓ K✗), c = 0 (V✗ K✓), p = 1.00.
McNemar's exact two-sided paired test (exact): b = 3 (V✓ K✗), c = 3 (V✗ K✓), p = 0.97.

**Recall by position bucket (semantic / exact):**

| Bucket | n | V sem | K sem | Δ sem | V exact | K exact | Δ exact |
|---|---|---|---|---|---|---|---|
| early (≤ 0.25) | 15 | 1.000 | 0.933 | −0.067 | 0.933 | 0.867 | −0.067 |
| mid (0.25–0.65) | 20 | 1.000 | 1.000 | 0.000 | 0.650 | 0.650 | 0.000 |
| late (> 0.65) | 15 | 1.000 | 1.000 | 0.000 | 0.800 | 0.867 | +0.067 |

LoCoMo's expected position effect (vanilla degrades more on early-position facts) does not appear in this corpus — vanilla preserves early facts at 1.00 semantic recall. The exact-match dip at the *mid* bucket (0.65 / 0.65) likely reflects mid-position facts being decisions and errors that get paraphrased rather than quoted.

**Recall by kind (semantic):** all kinds at 1.00 in vanilla. The single Kasett miss is a `value` (customer ticket ID `TKT-48721` in scenario C) where Kasett's structured output prioritized the customer name and account ID over the ticket ID, and the prose summary mentioned the ticket only obliquely.

**Hallucination rate:** 0/50 in both conditions. **No-answer rate:** 0/50 vanilla, 1/50 Kasett.

### 3.4.5.4 Interpretation — pre-registered hypothesis NOT met

The pre-registered hypothesis (Kasett Recall@1 > Vanilla Recall@1 by ≥ 10 pp) is **not** met on this corpus. The observed delta is −2.0 pp on semantic recall and 0.0 pp on exact match. Cohen's h = −0.28 (semantic) and 0.00 (exact). McNemar's test does not reject the null in either case.

Four candidate explanations:

1. **Synthetic conversations are too clean.** 80–150-turn conversations with explicit, well-formed plants are easy for Sonnet 4.5 to summarize without information loss. Real Molt sessions have ambiguity, aborted threads, partial facts — they should compress with more loss. The benchmark needs to stress compaction more than this corpus does.
2. **Ceiling effect on the probe-answer call.** The probe-answer model is also Sonnet 4.5. It is strong enough to answer paraphrastically from a decent prose summary even when the literal expected string is absent, which is exactly what we see in the exact-match miss pattern (78% exact / 100% semantic).
3. **Compression ratio is too low.** Conversations compress to 2–4 KB summaries from ~20–30 KB transcripts (≈10 : 1). Real production compaction operates at 30 : 1 or higher and that is where loss begins to bite.
4. **Single-compaction depth.** STUDY-DESIGN §5.1 specifies probing across 3–5 compaction cycles. We ran one. The regime where Kasett's structure should help most is the cumulative-loss regime (RQ4: "TRR degrades slower with Kasett across N compactions"). Phase 3.5 should run multi-compaction degradation curves before drawing strong behavioral conclusions.

### 3.4.5.5 What this changes about Paper 1

Three things:

1. **The headline claim is structural, not behavioral.** Phase 2's SY result is the publishable finding — Kasett delivers 18 structured artifacts per session that vanilla cannot produce by construction. We should not over-claim a behavioral benefit on the basis of structure-yield alone.
2. **The behavioral measurement we initially skipped is in the paper now.** RQ1 was always behavioral and STUDY-DESIGN specified the protocol. Phase 3 closes that loop with an honest null result on synthetic data.
3. **Future work has a clear hook.** Phase 3.5 (multi-compaction degradation) and replication on real session data are now well-motivated extensions, not handwave promises.

This is the methodological correction §3.5.4 already foreshadowed: "It does not show Kasett improves end-to-end agent task completion. SY is an intermediate metric; downstream-task evaluation is separate work." Phase 3 attempted that separate work and reports a null. We treat the null as informative about the regime in which Kasett's structure would or would not produce behavioral benefit.

### 3.4.5.6 Reproducibility

- Probe corpus: `research/phase3-results/probe-corpus.json` (5 scenarios, 50 probes, deterministic seeds for filler).
- Harness: `research/phase3-results/run-probes.mjs` (uses production parser, steering, and detector via `dist/`).
- Raw outputs: `research/phase3-results/raw-outputs/`.
- Per-probe results: `research/phase3-results/results.json`.
- Analysis script: `research/phase3-results/analyze.mjs`.
- Summary: `research/phase3-results/summary.md`.
- Cost: \~\$2 OpenRouter spend at Sonnet 4.5 + 4.6 pricing.

### 3.4.5.7 Honest take on what Phase 2 measured vs Phase 3 measured

Phase 2 asked: *Does Kasett produce structured output?* Yes — 18.20 artifacts/session vs 0 for vanilla.
Phase 3 asked: *Does Kasett make the agent more accurate at remembering planted facts after one compaction?* On this corpus, no.

Both findings are real. The first is a categorical advantage at the system-output level; the second is a null at the agent-behavior level under conditions weaker than the production deployment regime. Paper 1 should report both and be explicit about which regime each addresses. Promoting either as the unqualified answer to RQ1 would be misleading.

---

## §3.5.6 Update to "Why TRR and KSSR are similar"

Append to §3.5.1 (after the existing paragraph):

> The Phase 3 behavioral probes corroborate this picture. When the next-cycle agent reads a Sonnet 4.5 prose summary of an 80–150-turn synthetic conversation, semantic recall on planted facts is 1.00. Adding Kasett's structured fields does not measurably move that ceiling under single-compaction conditions on synthetic data. The structural advantage SY captures is system-level (the next cycle has a queryable thread list it can iterate over without re-parsing prose); the behavioral advantage that should follow from that structure was not detectable in this regime. We treat this as evidence that compaction-quality measurement at single-cycle depth on synthetic corpora is the wrong test bed for Kasett's behavioral hypothesis, not as evidence against the hypothesis.

---

## §3.5.7 Update to "Future work" — add multi-compaction protocol

Append to §3.5.5 as a new bullet:

> - **Multi-compaction degradation curves (RQ4).** STUDY-DESIGN §5.1 specifies probing fact recall across 3–5 sequential compactions. Phase 3 ran one. The regime where Kasett's `key_state` should help most is the cumulative-loss regime, where each successive compaction can drop a value the prior summary still contained. Building a synthetic 5-compaction harness (compact → continue conversation → compact → repeat) and measuring Recall@N for N ∈ {1, 3, 5} is the next behavioral experiment. Hypothesis: Kasett Recall degrades on a shallower slope than vanilla because the structured `key_state` carries values across cycles intact. Cost estimate: ~\$15 at Sonnet 4.5 pricing. Build this before any further behavioral claims.

---

## §3.6.4 Update to "Threats to Validity — Construct"

Append to §3.6.3:

> **Single-compaction protocol.** Phase 3's behavioral probes ran one compaction per scenario. The pre-registered hypothesis (Recall@1 ≥ +10 pp for Kasett) was framed assuming compaction-induced information loss; we did not observe that loss in the n = 1 cycle on synthetic data. The construct (does Kasett improve behavioral recall) was therefore tested in the wrong regime. Multi-cycle probing is the correct test; we report the single-cycle null transparently rather than re-frame the construct after the fact. The Phase 2 structural delta (SY) and the Phase 3 behavioral null are both reported; readers can weigh them against their own intended deployment depth.
