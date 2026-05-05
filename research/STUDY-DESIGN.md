# Research Study Design — Kasett + ALLM Evaluation

## Title
**"Press Rewind: Evaluating Weighted Thread Steering and Adaptive Pattern Pruning for Persistent AI Agent Memory"**

---

## 1. Overview

This study evaluates two complementary systems for improving AI agent memory:

1. **Kasett** — Runtime context management via weighted thread meta steering during compaction
2. **ALLM** — Long-term behavioral adaptation via adaptive LoRA lifecycle management

We employ a 2×2 factorial design to measure independent and combined effects, grounded in established evaluation benchmarks (LoCoMo, RULER, QuestEval, LaMP) while introducing novel metrics (TRR, KSSR, WSE) and contributing CompactBench as an evaluation resource.

---

## 2. Research Questions

| ID | Question | System |
|----|---------|--------|
| RQ1 | Does weighted thread meta steering improve context retention across multiple compaction cycles? | Kasett |
| RQ2 | Do configurable decay weights outperform flat weighting for thread evolution prediction? | Kasett |
| RQ3 | Does adaptive pattern pruning maintain or improve personalization quality while reducing training data size? | ALLM |
| RQ4 | Is there a synergistic interaction between runtime context steering and long-term behavioral adaptation? | Combined |
| RQ5 | What is the optimal window size (N) and weight distribution for thread meta evaluation? | Kasett |

---

## 3. Experimental Design

### 3.1 2×2 Factorial

| | No ALLM | With ALLM |
|--|---------|-----------|
| **No Kasett** | **A: Vanilla** (baseline) | **C: ALLM-only** |
| **With Kasett** | **B: Kasett-only** | **D: Combined** |

**Condition A (Vanilla):** Default OpenClaw compaction. Single unstructured summary. No thread tracking. No adaptive training.

**Condition B (Kasett-only):** Weighted thread meta steering active. windowSize=3, weights=[1.0, 0.6, 0.3]. Thread meta stored per compaction. Orientation injection on context load. No LoRA adaptation.

**Condition C (ALLM-only):** Standard vanilla compaction (no thread steering). Adaptive LoRA lifecycle management active: pattern extraction, vitality scoring, trailing-window diff, pruning, retraining on 7-day cycles.

**Condition D (Combined):** Both systems active. Kasett's thread meta feeds ALLM's pattern extraction (thread-modulated decay). ALLM's trained adapter modifies behavior, generating new sessions that flow through Kasett's compaction steering.

### 3.2 Ablation Conditions (Kasett-specific)

| Sub-condition | Description |
|--------------|-------------|
| B1 | windowSize=1, weights=[1.0] (single previous compaction, no history) |
| B2 | windowSize=3, weights=[1.0, 1.0, 1.0] (flat weighting) |
| B3 | windowSize=3, weights=[1.0, 0.6, 0.3] (default decay) |
| B4 | windowSize=5, weights=[1.0, 0.8, 0.6, 0.4, 0.2] (deep window) |

---

## 4. Metrics

### 4.1 Novel Metrics (Formally Defined)

**Thread Retention Rate (TRR)**

```
TRR(c_n) = |T(c_n) ∩ T(c_{n-1})| / |T(c_{n-1})|
```

Where `T(c_n)` is the set of thread descriptions in compaction n, and `∩` denotes semantic overlap (BERTScore > 0.75 between any pair). Range: [0, 1]. Higher = better retention.

**Key State Survival Rate (KSSR)**

```
KSSR(c_n) = |V(c_n) ∩ V(pre_n)| / |V(pre_n)|
```

Where `V(pre_n)` is the set of specific values (URLs, IDs, paths, versions) present in the pre-compaction context, and `V(c_n)` is the set present in the compaction output. Exact string match or normalized equivalence. Range: [0, 1].

**Weighted Steering Effectiveness (WSE)**

```
WSE = TRR_weighted / TRR_unweighted
```

Ratio of thread retention with weighted steering vs. without. WSE > 1.0 means weighting helps. WSE = 1.0 means no effect. WSE < 1.0 means weighting hurts.

**Adaptation Lag (ALLM)**

```
AL = t_adapted - t_behavior_change
```

Days between a user behavioral shift (new pattern emerging in sessions) and the pattern appearing in the curated training dataset. Lower = faster adaptation.

**Pruning Efficiency (ALLM)**

```
PE = |P_pruned| / |P_total| where Q(adapter_new) ≥ Q(adapter_prev)
```

Percentage of patterns pruned per training cycle without quality regression. Target: 15-30%.

### 4.2 Established Metrics

| Metric | Source | Application |
|--------|--------|-------------|
| **ROUGE-L** | Lin (2004) | Narrative summary quality vs. reference |
| **BERTScore** | Zhang et al. (2020) | Semantic thread concept persistence |
| **SummaC** | Laban et al. (2022) | Faithfulness — no hallucinated threads |
| **QuestEval** | Scialom et al. (2021) | Key state as question-answering |
| **Human Likert (1-5)** | Standard | Thread coverage, trajectory clarity, key state specificity |
| **Cohen's κ** | Cohen (1960) | Inter-rater agreement (target > 0.7) |

### 4.3 Metric-to-Benchmark Mapping

| Our Metric | Adapted From | Adaptation |
|-----------|-------------|-----------|
| TRR | LoCoMo recall protocol | Cross-compaction instead of cross-session |
| KSSR | RULER multi-key retrieval | Post-compression instead of in-context |
| WSE | Novel (no direct analog) | — |
| Narrative quality | LongBench summarization | Applied to compaction output |
| Faithfulness | SummaC NLI protocol | Summary vs. source conversation |

---

## 5. Benchmark Protocols

### 5.1 LoCoMo-Adapted: Multi-Compaction Memory Recall

**Original:** LoCoMo tests memory across 600+ turn conversations with memory-augmented agents.

**Our adaptation:**
1. Take a session with 5+ compaction events
2. Plant specific factual claims in turns 1-100 (early context)
3. Run through 3-5 compaction cycles
4. Probe: "What was [specific fact from early context]?"
5. Measure: Can the agent answer correctly from compaction summaries alone?

**Protocol:**
- 30 sessions × 5 planted facts each = 150 probes
- Binary scoring: correct / incorrect
- Report: recall@1, recall@3, recall@5 compactions

### 5.2 RULER/NIAH-Adapted: Post-Compaction Key State Retrieval

**Original:** RULER plants "needles" at various context positions and tests retrieval.

**Our adaptation:**
1. Insert key state values (URL, version, config path, user ID) at controlled positions in session
2. Compact the session
3. Probe: "What is the [specific value type]?"
4. Measure: exact match retrieval rate

**Protocol:**
- Values inserted at: beginning (turns 1-20), middle (turns 40-60), end (turns 80-100) of pre-compaction context
- 20 sessions × 3 positions × 4 value types = 240 probes
- Report: KSSR by position, KSSR by value type, KSSR by compaction depth

### 5.3 QuestEval-Adapted: Information Retention

**Original:** Generate questions from source, test if summary enables answering them.

**Our adaptation:**
1. From pre-compaction context, auto-generate 10 factual questions
2. After compaction, attempt to answer questions from summary alone
3. Score: answerable / unanswerable / incorrectly answered

**Protocol:**
- 60 sessions × 10 questions = 600 QA pairs
- Report: answerability rate, accuracy rate, hallucination rate

### 5.4 LaMP-Adapted: ALLM Personalization (Condition C, D only)

**Original:** LaMP measures personalized text generation quality.

**Our adaptation:**
1. Collect user-specific behavioral patterns (formatting preferences, tool chain habits, disambiguation style)
2. Train adapter with ALLM pipeline
3. Test: does adapter produce user-preferred behavior on held-out test cases?
4. Compare: before-ALLM vs. after-ALLM on same test cases

**Protocol:**
- 50 held-out behavioral test cases per user
- Score: binary match to user preference
- Report: personalization accuracy, correction rate trend over time

---

## 6. Study Phases

### Phase 1: Offline Controlled Evaluation (Weeks 1-8)

**Corpus:** 60 real session JSONL files from deployed OpenClaw agents, stratified:
- Tier 1 (Simple): 20 sessions, 1-2 concurrent threads, ≤5 key state values
- Tier 2 (Medium): 20 sessions, 3-4 concurrent threads, 5-10 key state values
- Tier 3 (Complex): 20 sessions, 5+ concurrent threads, 10+ key state values

**Processing:** Each session runs through all 4 conditions + ablations. Compaction events replayed under each condition. Output summaries collected for evaluation.

**Evaluation:**
- Automated: TRR, KSSR, ROUGE-L, BERTScore, SummaC (all 240 instances)
- Human: 3 raters evaluate 120 instances (2 per session, blind to condition) on:
  - Thread coverage (1-5)
  - Key state specificity (1-5)
  - Trajectory clarity (1-5)
- Calibration: 10 practice instances with discussed ground truth before rating begins

### Phase 2: Live A/B Deployment (Weeks 9-16)

**Participants:** 2-3 consenting users with deployed OpenClaw agents

**Design:** Within-subject, counterbalanced (Latin square). Each user experiences each condition (A, B) for 2 weeks. Order rotated.

**Daily collection:**
- Compaction events with thread meta
- Correction turns (user says "no," "wrong," "I told you")
- Re-explanation turns (user restates known context)
- Task completion outcomes

**Weekly:**
- User satisfaction survey (3 items, 1-7 Likert):
  1. "My agent remembered what we were working on" (memory)
  2. "I had to repeat myself less than usual" (efficiency)
  3. "The agent stayed on track across long sessions" (trajectory)

### Phase 3: ALLM Evaluation (Weeks 17-24)

**Requires:** Minimum 4 training cycles (28 days active use per condition)

**Conditions C and D activated:** ALLM pipeline running alongside conditions A and B from Phase 2

**Metrics:**
- Correction rate trend (weekly, per condition)
- Adaptation lag measurement (behavioral shift detection → pattern in training)
- Pruning efficiency per training cycle
- LaMP-adapted personalization test (held-out behavioral cases)
- Dataset size over time (should decrease with pruning)

---

## 7. Statistical Analysis

### 7.1 Power Analysis

- Effect size: d = 0.5 (medium, conservative estimate for TRR improvement)
- α = 0.05 (two-tailed)
- Power (1-β) = 0.80
- **Required N per condition: 34 sessions (paired design)**
- Our corpus: 60 sessions → adequately powered

### 7.2 Primary Analyses

| Analysis | Test | DV | IV |
|----------|------|----|----|
| Kasett vs. Vanilla (TRR) | Paired t-test / Wilcoxon | TRR | Condition (A vs. B) |
| All 4 conditions | 2×2 Repeated-measures ANOVA | TRR, KSSR, ROUGE-L | Kasett (yes/no) × ALLM (yes/no) |
| Window size effect | Linear trend / one-way RM-ANOVA | TRR | windowSize (1, 3, 5) |
| Weight scheme effect | Paired t-test | WSE | Weighted vs. flat |
| Interaction (Kasett × ALLM) | Interaction term in 2×2 ANOVA | All metrics | — |

### 7.3 Live Deployment Analysis

- Mixed-effects model: Metric ~ Condition + Week + (1|User)
- Random intercept for user, fixed effect for condition and time
- Accounts for between-user variability and temporal trends

### 7.4 Reporting

- **Primary:** Effect sizes (Cohen's d) with 95% CI
- **Secondary:** p-values (Bonferroni-corrected for multiple comparisons)
- **Descriptive:** Means, SDs, and distributions per condition
- **Reliability:** Cohen's κ for human ratings (target > 0.7)
- **Visualizations:** Violin plots (distributions), trend lines (degradation curves), heatmaps (position × condition)

### 7.5 Pre-Registration

Register on Open Science Framework (OSF) before Phase 2 begins:
- Hypotheses (directional)
- Analysis plan (exact tests, correction methods)
- Stopping rules
- Exclusion criteria

---

## 8. Hypotheses (Pre-Registered)

| ID | Hypothesis | Test | Expected Effect |
|----|-----------|------|----------------|
| H1 | TRR(B) > TRR(A) | Paired t-test | d > 0.5 |
| H2 | KSSR(B) > KSSR(A) | Paired t-test | d > 0.8 |
| H3 | WSE > 1.0 (weighted > flat) | One-sample t | WSE ≈ 1.3 |
| H4 | TRR degrades slower with Kasett across N compactions | Linear trend interaction | Shallower slope |
| H5 | Correction rate decreases over time with ALLM (C, D) | Mixed-effects trend | Negative β |
| H6 | Combined (D) outperforms independent sum of B and C effects | Interaction term > 0 | Synergy |
| H7 | windowSize=3 provides ≥85% of windowSize=5 benefit | Equivalence test | TOST |

---

## 9. CompactBench

We propose **CompactBench**, a benchmark for evaluating context compression systems in persistent AI agents, described in a companion technical report. CompactBench comprises five evaluation tasks:

1. **Thread Persistence** — Measures TRR across controlled compression events
2. **Key State Retrieval** — NIAH-adapted probes for specific value survival post-compression
3. **Trajectory Reconstruction** — Can the session story be followed from summaries alone?
4. **Steering Effectiveness** — Does weighted history injection improve compression output?
5. **Multi-Compaction Degradation** — Quality decay curves across 1, 3, 5, 10 compression cycles

CompactBench will be released as a HuggingFace dataset with automated evaluation harness and hosted leaderboard alongside Paper 1 submission.

---

## 10. Publication Strategy

### Paper 1: Kasett (Target: 12 weeks from study start)

**Title:** "Press Rewind: Weighted Thread Steering for Context-Preserving Compaction in Persistent AI Agents"

**Contents:**
- System design (weighted meta, steering prompt, feedback loop)
- Phase 1 offline results (TRR, KSSR, WSE, ROUGE-L, BERTScore, SummaC)
- Phase 2 live results (correction rate, re-explanation rate, satisfaction)
- Ablation (window size, weight schemes)
- CompactBench introduction + baseline results

**Target venues:** NeurIPS 2026 Workshop on Foundation Model Agents, EMNLP 2026

### Paper 2: Full System (Target: 24 weeks from study start)

**Title:** "Adaptive Memory for Persistent AI Agents: Combining Runtime Context Steering with Neuroscience-Inspired Training Data Lifecycle Management"

**Contents:**
- Full 2×2 factorial results
- ALLM system + evaluation (adaptation lag, pruning efficiency, LaMP comparison)
- Interaction effects (does Kasett + ALLM produce synergy?)
- CompactBench v1.0 full results
- Longitudinal analysis (6-month deployment data)

**Target venues:** ICML 2027, NeurIPS 2027 main conference

---

## 11. Timeline

| Week | Activity | Deliverable |
|------|----------|-------------|
| 1-2 | Corpus collection + annotation guidelines | 60 sessions labeled by tier + complexity annotation |
| 3-4 | Build evaluation harness (automated TRR, KSSR, ROUGE-L, BERTScore, SummaC) | Running pipeline, validated on sample |
| 5-6 | Phase 1 offline evaluation — all 4 conditions + ablations on corpus | Raw metric tables |
| 7-8 | Human rating (3 raters × 120 instances, calibration first) | Annotated dataset + κ scores |
| 8 | Pre-register Phase 2 on OSF | Registration DOI |
| 9-16 | Phase 2 live A/B deployment (2 conditions × 2 rotations × 2-3 users) | Daily event logs, weekly surveys |
| 12 | **Paper 1 draft** (Kasett alone, offline + early live results) | Submission-ready manuscript |
| 17-20 | ALLM training cycles active (conditions C, D) | 4+ training cycles completed |
| 21-22 | Combined evaluation — full 2×2 analysis | Statistical results + figures |
| 23-24 | **Paper 2 draft** | Submission-ready manuscript |

---

## 12. Threats to Validity

### Internal Validity
| Threat | Mitigation |
|--------|-----------|
| Order effects (live A/B) | Latin square counterbalancing + washout periods |
| Rater bias | Blind rating (condition labels removed) |
| Model variability | Fixed model version + temperature=0 for offline; same model across conditions |
| Session selection bias | Stratified random sampling with pre-specified criteria |
| Multiple comparisons | Bonferroni correction; pre-registered analyses |

### External Validity
| Threat | Mitigation |
|--------|-----------|
| Small N for live (2-3 users) | Acknowledge; prioritize deep longitudinal over wide shallow |
| Single framework (OpenClaw) | System-agnostic design; CompactBench portable |
| Model-specific (compaction quality varies by model) | Test with 2 models (Claude, GPT) in Phase 1 |
| English-only | Acknowledge as limitation; future work |

### Construct Validity
| Threat | Mitigation |
|--------|-----------|
| "Thread" definition subjective | Operational definition via BERTScore > 0.75 + rater calibration |
| Automated metrics may miss nuance | Human ratings supplement all automated metrics |
| KSSR favors exact match | Include normalized equivalence (e.g., "v15.2" = "version 15.2") |

---

## 13. Ethical Considerations

- All session data from consenting participants (internal team, informed consent)
- No PII in published results or CompactBench dataset
- Synthetic examples in paper; structural preservation with content replacement
- Users informed during Phase 2 that conditions may vary
- Right to withdraw at any time; data excluded if withdrawn
- No deception; study purpose disclosed
- Data retention: anonymized dataset retained for reproducibility; raw sessions deleted after analysis

---

## 14. Resource Requirements

| Resource | Estimate |
|----------|---------|
| LLM compute (offline, 720 compaction calls × 4 conditions) | ~$150 |
| Human raters (3 × 15 hours) | $1,125 (contractor) or $0 (internal) |
| Live deployment infra (16 weeks) | ~$400 (existing OC compute) |
| ALLM training compute (8 cycles × ~$50) | ~$400 |
| Conference registration | ~$200 |
| **Total** | **~$2,275** (or ~$1,150 with internal raters) |

---

## 15. References

1. Maharana et al. (2024). "LoCoMo: Long-Context Conversations with Memory."
2. Hsieh et al. (2024). "RULER: What's the Real Context Size of Your Long-Context Language Models?"
3. Scialom et al. (2021). "QuestEval: Summarization Asks for Fact-based Evaluation." EMNLP.
4. Zhang et al. (2020). "BERTScore: Evaluating Text Generation with BERT." ICLR.
5. Laban et al. (2022). "SummaC: Re-Visiting NLI-based Models for Inconsistency Detection." TACL.
6. Salemi et al. (2024). "LaMP: When Large Language Models Meet Personalization." EMNLP.
7. Lin (2004). "ROUGE: A Package for Automatic Evaluation of Summaries." ACL Workshop.
8. Packer et al. (2023). "MemGPT: Towards LLMs as Operating Systems."
9. Hu et al. (2021). "LoRA: Low-Rank Adaptation of Large Language Models."
10. Kirkpatrick et al. (2017). "Overcoming Catastrophic Forgetting in Neural Networks." PNAS.
11. Yen et al. (2024). "HELMET: How to Evaluate Long-Context Language Models Effectively and Thoroughly."
12. Bai et al. (2023). "LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding."

---

*Study design v2 — Kasett. Prepared 2026-05-05.*
