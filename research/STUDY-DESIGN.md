# Research Study Design — Kasett Rewind

## Title
**"Press Rewind: Measuring Context Continuity in AI Agents Through Rolling Compaction and Thread Tracking"**

---

## 1. Research Questions

**RQ1:** Does rolling compaction with thread tracking reduce context loss across multiple compaction cycles compared to standard single-summary compaction?

**RQ2:** Does structured thread evolution (numbered thread lists that naturally evolve across compactions) reduce the rate at which active workstreams are silently dropped?

**RQ3:** Does the presence of thread history from prior compactions measurably reduce repeated-mistake errors (suggesting approaches previously attempted and failed)?

**RQ4:** What is the minimum window size (N) that provides meaningful trajectory awareness without unacceptable sacrifice of recent-turn context budget?

---

## 2. Hypotheses

| ID | Hypothesis | Measure |
|----|-----------|---------|
| H1 | Kasett compaction retains ≥80% of active threads across 3+ compaction cycles, vs. ≤40% for vanilla. | Thread retention rate |
| H2 | Kasett reduces "context re-explanation" events (user restating something the agent should know) by ≥50%. | Re-explanation count |
| H3 | Agents with Kasett produce ≤50% as many repeated-failure suggestions as vanilla agents. | Repeated-mistake rate |
| H4 | Key state (URLs, IDs, versions, paths) survives compaction at ≥90% rate with Kasett vs. ≤30% with vanilla. | Key state survival rate |
| H5 | windowSize=2 provides ≥85% of the benefit of windowSize=3 at lower token cost. | Marginal benefit curve |

---

## 3. Study Design

### 3.1 Design Type

**Within-subject, counterbalanced A/B evaluation** with both offline (controlled replay) and online (live deployment) phases.

### 3.2 Conditions

| Condition | Description |
|-----------|-------------|
| **A: Vanilla** | Default OC compaction. No plugin. Single unstructured summary. |
| **B: Kasett-Threads** | Kasett with thread tracking enabled, windowSize=1 (structured but single summary). |
| **C: Kasett-Full** | Kasett with thread tracking AND rolling window (windowSize=2). |
| **D: Kasett-Deep** | Kasett with windowSize=3 (deepest window). |

### 3.3 Phases

```
Phase 1: Offline Evaluation (controlled, reproducible)
 → Feed identical session histories through each condition
 → Measure output quality with human raters + automated metrics
 → Duration: 2 weeks
 → N = 60 sessions (20 per complexity tier)

Phase 2: Live A/B Deployment (real user, real sessions)
 → Deploy conditions on real agents serving real users
 → Rotate conditions weekly (counterbalanced)
 → Measure correction rate, re-explanation, satisfaction
 → Duration: 8 weeks (2 weeks per condition × 2 rotations)
 → N = 1-3 users (deep longitudinal > wide shallow)

Phase 3: Analysis + Publication
 → Statistical analysis
 → Effect sizes + confidence intervals
 → Write paper
 → Duration: 4 weeks
```

---

## 4. Metrics (Dependent Variables)

### 4.1 Primary Metrics

| Metric | Definition | Measurement Method |
|--------|-----------|-------------------|
| **Thread Retention Rate (TRR)** | % of threads active in compaction N that appear (explicitly) in compaction N+1 | Automated: parse both summaries, compute overlap |
| **Key State Survival Rate (KSSR)** | % of specific values (URLs, IDs, paths) from pre-compaction context that appear post-compaction | Automated: extract values pre/post, compute survival |
| **Repeated-Mistake Rate (RMR)** | % of suggestions that repeat a previously-failed approach | Human rater: review suggestions, mark repeats |
| **Re-Explanation Rate (RER)** | User messages that restate context the agent previously had | Human rater: annotate user turns |

### 4.2 Secondary Metrics

| Metric | Definition | Measurement Method |
|--------|-----------|-------------------|
| **Trajectory Coherence Score (TCS)** | Can a human reader follow the "story" of the session from compaction summaries alone? (1-5 Likert) | Human rater |
| **First-Attempt Success Rate** | % of tasks completed without user correction | Automated: count correction turns |
| **Token Efficiency** | Quality per token spent on compaction context | Computed: TRR × KSSR / tokens_used |
| **User Satisfaction** | Weekly self-report (1-7 Likert) | Survey |

### 4.3 Control Variables

| Variable | How Controlled |
|----------|---------------|
| Model | Same model across all conditions (hold constant) |
| Session complexity | Stratified sampling: simple (1 thread), medium (2-3 threads), complex (4+ threads) |
| Token budget | Fixed `maxHistoryShare` across conditions |
| User | Same user across conditions (within-subject) |
| Session length | Sessions selected to have similar turn counts |
| Time of day | Randomize condition assignment within day |

---

## 5. Session Corpus (Phase 1 — Offline)

### 5.1 Source

Real session JSONL files from deployed OpenClaw agents (Clyde, Zero, sentinels). These are real work sessions with real compaction events.

### 5.2 Selection Criteria

- Must have ≥3 compaction events in the same session
- Must contain multi-threaded work (not single-topic Q&A)
- Stratified by complexity:
  - **Tier 1 (Simple):** 1-2 concurrent threads, ≤5 key state values
  - **Tier 2 (Medium):** 3-4 concurrent threads, 5-10 key state values
  - **Tier 3 (Complex):** 5+ concurrent threads, 10+ key state values, thread shifts mid-session

### 5.3 Corpus Size

- 20 sessions per tier × 3 tiers = **60 sessions**
- Each session processed through all 4 conditions = **240 evaluation instances**
- Minimum 3 compaction cycles per session = **720+ compaction events** evaluated

### 5.4 Privacy

- All sessions from consenting users (internal agents)
- Content can be used for evaluation but not published verbatim
- Published examples will be synthetic reconstructions preserving structural characteristics

---

## 6. Evaluation Protocol

### 6.1 Automated Metrics

Run automatically after each compaction event:

```python
for session in corpus:
    for condition in [vanilla, kasett_threads, kasett_full, kasett_deep]:
        results = []
        for compaction_event in session.compaction_events:
            # Pre-compaction: extract ground truth
            ground_truth_threads = extract_active_threads(pre_compaction_context)
            ground_truth_values = extract_key_values(pre_compaction_context)
            
            # Run compaction under this condition
            summary = run_compaction(compaction_event, condition)
            
            # Post-compaction: measure retention
            retained_threads = extract_threads_from_summary(summary)
            retained_values = extract_values_from_summary(summary)
            
            results.append({
                'TRR': len(retained_threads & ground_truth_threads) / len(ground_truth_threads),
                'KSSR': len(retained_values & ground_truth_values) / len(ground_truth_values),
            })
```

### 6.2 Human Rating Protocol

3 raters (minimum 2 per instance for inter-rater reliability):

1. **Training:** 10 calibration sessions with discussed ground truth
2. **Rating:** Independently rate each compaction summary on:
   - Thread coverage (1-5): Are all active workstreams represented?
   - Key state specificity (1-5): Are actual values retained, not just topic labels?
   - Trajectory clarity (1-5): Could you predict what comes next from this summary?
   - Repeated-mistake identification: Mark any suggestion that repeats a known failure
3. **Agreement:** Compute Cohen's κ / Krippendorff's α. Target: κ > 0.7.

### 6.3 Live Deployment Protocol (Phase 2)

- Deploy each condition for 2 consecutive weeks
- Order counterbalanced across users (Latin square if multiple users)
- Daily logging of:
  - Correction events (user says "no," "wrong," "I already told you," etc.)
  - Re-explanation events (user restates context)
  - Compaction events (with pre/post state)
- Weekly user satisfaction survey (3 questions, 1-7 scale)
- Post-condition debrief: "Did the agent seem to forget things this week?" (open-ended)

---

## 7. Analysis Plan

### 7.1 Statistical Tests

| Comparison | Test | Rationale |
|-----------|------|-----------|
| Vanilla vs. Kasett-Full (primary) | Paired t-test or Wilcoxon signed-rank | Within-subject, same sessions |
| Across all 4 conditions | Repeated-measures ANOVA (or Friedman) | Multiple conditions, same sessions |
| Window size effect (1 vs. 2 vs. 3) | Linear trend analysis | Ordinal IV |
| Human ratings | ICC (intraclass correlation) | Inter-rater reliability |
| Live deployment | Mixed-effects model | Session nested in user nested in condition |

### 7.2 Effect Size Reporting

Report Cohen's d or η² for all significant results. Focus on practical effect sizes, not just p-values.

### 7.3 Pre-registration

Pre-register hypotheses and analysis plan on OSF (Open Science Framework) before running Phase 2. Phase 1 is exploratory/pilot.

---

## 8. Expected Results

Based on the design doc's preliminary observations:

| Metric | Vanilla (expected) | Kasett-Full (expected) | Effect |
|--------|--------------------|----------------------|--------|
| TRR | 35-45% | 85-95% | ~50pp improvement |
| KSSR | 20-35% | 85-95% | ~55pp improvement |
| RMR | 15-25% per 50 turns | 3-8% per 50 turns | 60-75% reduction |
| RER | 8-12% of user turns | 2-4% of user turns | 60-70% reduction |

### Power Analysis

- Assuming medium effect size (d = 0.5) for TRR
- α = 0.05, power = 0.80
- Required N per condition: ~34 sessions (paired design)
- Our corpus of 60 sessions exceeds this

---

## 9. Threats to Validity

### Internal
| Threat | Mitigation |
|--------|-----------|
| Learning effects (user adapts to condition) | Counterbalanced order, washout period between conditions |
| Rater bias | Blind rating (raters don't know which condition produced the summary) |
| Model variability | Temperature=0 for offline, same model version across all conditions |
| Session selection bias | Stratified random sampling from full session corpus |

### External
| Threat | Mitigation |
|--------|-----------|
| Single-user results may not generalize | Acknowledge in limitations. Phase 2 aims for 2-3 users. |
| Model-specific results | Test with 2+ models (Claude, GPT) in Phase 1 |
| Task-specific results | Stratified complexity ensures coverage of use cases |

### Construct
| Threat | Mitigation |
|--------|-----------|
| "Thread" definition is subjective | Operational definition + rater calibration + κ reporting |
| Automated metrics may miss nuance | Supplement with human ratings |
| User satisfaction is multifactorial | Isolate with specific questions ("Did it forget things?") |

---

## 10. Ethical Considerations

- All session data from consenting participants (internal team agents)
- No PII in published results
- Synthetic examples in paper (structural preservation, content replacement)
- No deception (users know they're in a study during Phase 2)
- Right to withdraw: user can opt out at any time, data excluded

---

## 11. Publication Target

### Primary Venue
**NeurIPS 2026 Workshop on Foundation Model Agents** or **EMNLP 2026**

### Backup Venues
- AAAI 2027 (main conference, agent track)
- ACL 2027 (findings track)
- CHI 2027 (human-AI interaction angle)

### Paper Structure
1. Introduction + Problem (compaction = lossy, goldfish brain) [1 page]
2. Related Work (compaction systems, continual learning, agent memory) [1 page]
3. System Design (Kasett architecture, thread model) [2 pages]
4. Study Design + Methods [1.5 pages]
5. Results (automated + human ratings + live deployment) [2 pages]
6. Discussion (limitations, future work, implications for agent design) [1 page]
7. Conclusion [0.5 pages]

Total: ~9 pages + references (standard conference format)

### Pre-print
ArXiv submission concurrent with conference submission (allowed by NeurIPS/EMNLP).

---

## 12. Timeline

| Week | Activity | Deliverable |
|------|----------|-------------|
| 1 | Corpus collection + annotation guidelines | 60 sessions labeled by tier |
| 2 | Build evaluation harness (automated metrics) | Running pipeline |
| 3-4 | Phase 1: Offline evaluation (all 4 conditions) | Raw results |
| 5 | Human rating (3 raters, calibration + rating) | Annotated dataset |
| 5 | Pre-register Phase 2 on OSF | Registration DOI |
| 6-13 | Phase 2: Live deployment (8 weeks, 4 conditions × 2 rotations) | Daily logs |
| 14-15 | Analysis (statistics, effect sizes, figures) | Results tables + plots |
| 16-17 | Paper writing | Draft manuscript |
| 18 | Internal review + revision | Submission-ready paper |

**Total: 18 weeks (4.5 months) from start to submission-ready paper.**

---

## 13. Resources Required

| Resource | Quantity | Cost |
|----------|---------|------|
| Session corpus (internal) | 60 sessions | $0 (existing data) |
| LLM compute for offline eval (240 × 3 compactions × 4 conditions) | ~2,880 compaction calls | ~$50-100 at API rates |
| Human raters (3 people, ~10 hrs each) | 30 person-hours | Internal or $750 at contractor rate |
| Live deployment compute (8 weeks) | Standard OC running cost | ~$200/month (existing infra) |
| Pre-registration | OSF account | Free |
| ArXiv submission | Account | Free |
| Conference submission fee | NeurIPS/EMNLP | ~$100-200 |

**Total estimated cost: $500-1,500** (mostly human rating labor if external)

---

## 14. Stretch Goals

If primary study succeeds:

1. **Multi-model comparison:** Run Phase 1 across Claude, GPT, Gemini — do structured instructions work universally?
2. **Ablation study:** Thread tracking alone vs. rolling window alone vs. both — which contributes more?
3. **User study at scale:** Deploy to Molt clients (N=6-10 users), measure over 30 days
4. **Downstream task performance:** Does better context retention improve actual task completion (not just memory metrics)?

---

*Study design — Kasett. Prepared 2026-05-05.*
