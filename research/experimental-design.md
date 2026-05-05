# Experimental Design — kasett-rewind Validation

## Purpose

Define the experiments needed to support patent claims, academic publication, and product validation. Three tiers: immediate (this month), medium-term (90 days), and long-term (6 months).

---

## 1. Immediate Experiments (Phase 1 Validation)

### Experiment 1.1: Compaction Quality Comparison

**Question:** Does structured compaction with thread tracking produce higher-quality summaries than unstructured compaction?

**Method:**
1. Take 20 real session JSONL files (OpenClaw sessions with 2+ compactions)
2. For each session, produce compaction summaries three ways:
   - (A) Default OC compaction (unstructured free-form)
   - (B) kasett-rewind with customInstructions only (structured prompt, no window)
   - (C) kasett-rewind with full rolling window (N=2)
3. Human evaluation: rate each summary on:
   - Thread awareness (0-5): Does the summary capture all active work streams?
   - Trajectory clarity (0-5): Could you tell what came before and what comes next?
   - Key state preservation (0-5): Are specific values (IDs, versions, URLs) retained?
   - Conciseness (0-5): Is it appropriately compressed without filler?

**Expected result:** B > A on structure, C > B on trajectory awareness.

**Resources:** 20 sessions × 3 conditions × 1 evaluator = ~4 hours human evaluation time.

### Experiment 1.2: Thread Disappearance Rate

**Question:** In current OC compaction, how often do active work threads silently disappear?

**Method:**
1. Collect 50 sessions with 3+ compactions
2. For each pair of successive compactions, manually identify:
   - Threads mentioned in compaction N
   - Threads mentioned in compaction N+1
   - Threads that disappeared without explicit resolution
3. Compute disappearance rate: (disappeared / total threads from N)

**Expected result:** >30% thread disappearance rate in unstructured compaction. This establishes the problem's severity.

**Resources:** 50 sessions × ~10 minutes each = ~8 hours analysis.

### Experiment 1.3: Goldfish Brain Error Rate

**Question:** After 3+ compactions, do agents repeat previously-failed approaches?

**Method:**
1. Collect 30 sessions where the agent tried approach X, it failed, and the conversation continued past 2+ more compactions
2. Check if the agent later suggested approach X again (without remembering it failed)
3. Compare: sessions with kasett-rewind (thread tracking preserving failure history) vs. without

**Expected result:** Significant reduction in repeated-failure suggestions with thread history.

---

## 2. Medium-Term Experiments (ALLM Pipeline Validation, 90 days)

### Experiment 2.1: Pattern Extraction Accuracy

**Question:** Does the pattern extractor correctly identify behavioral patterns?

**Method:**
1. Take 100 session turns manually annotated with ground-truth patterns
2. Run extractor, compute:
   - Precision: of patterns extracted, how many are real patterns?
   - Recall: of real patterns, how many were extracted?
   - Category accuracy: are patterns assigned to the correct category?

**Target:** Precision > 0.85, Recall > 0.70, Category accuracy > 0.80.

### Experiment 2.2: Vitality Score Predictive Validity

**Question:** Does the vitality score predict future pattern relevance?

**Method:**
1. Score all patterns at time T
2. Wait 30 days
3. Check: did patterns with high vitality (>0.8) continue to appear in sessions?
4. Did patterns with low vitality (<0.2) stop appearing?
5. Compute correlation between V(p,T) and future_match_count(p, T+30)

**Target:** Pearson correlation > 0.60.

### Experiment 2.3: Pruning Without Quality Loss

**Question:** Can we prune 15-30% of training data without degrading adapter quality?

**Method:**
1. Train LoRA adapter on full dataset (baseline)
2. Train LoRA adapter on pruned dataset (dead patterns removed)
3. Compare on held-out test set:
   - Correction rate
   - First-attempt success rate
   - Pattern match rate
4. Repeat with multiple pruning thresholds (V < 0.1, V < 0.2, V < 0.3)

**Expected result:** V < 0.2 threshold prunes 15-30% with no quality degradation. V < 0.3 may show marginal degradation.

### Experiment 2.4: A/B Deployment

**Question:** Does ALLM improve real user experience?

**Method:**
1. Deploy agent with ALLM (adaptive pruning) for 45 days
2. Compare against same agent with static training (accumulate-forever) for 45 days
3. Measure:
   - User correction rate per week
   - Task completion rate
   - User satisfaction (weekly brief survey)
   - Training dataset size over time

**Expected result:** ALLM correction rate ≤ static at day 45, with 20-30% smaller dataset.

---

## 3. Long-Term Experiments (Combined System, 6 months)

### Experiment 3.1: Full Pipeline Closed-Loop

**Question:** Does the integrated system (compaction → extract → train → deploy) self-improve?

**Metric:** Correction rate trajectory over 6 months. Expected: decreasing trend with ALLM, plateau with static.

### Experiment 3.2: Thread-Modulated Decay vs. Flat Decay

**Question:** Does modulating decay rate by thread lifecycle improve adaptation speed?

**Method:** Compare ALLM with flat λ=0.05 vs. ALLM with thread-modulated λ. Measure adaptation lag (days from new user behavior → pattern in training).

### Experiment 3.3: Multi-User Generalization

**Question:** Do optimal hyperparameters (α, β, γ, δ, λ) transfer across users?

**Method:** Deploy to 5+ users, optimize per-user, compare per-user optimal vs. population average. If population average works well → hyperparameters are general. If not → need per-user tuning.

---

## 4. Data Collection Requirements

### What Must Be Collected

| Data | Source | Privacy Level |
|------|--------|--------------|
| Session JSONL files | OC agents | High (contains conversation content) |
| Compaction events | Session JSONL | Medium (contains summaries) |
| Pattern extractions | Extractor output | Low (structural only) |
| Vitality scores | Scorer output | None (numeric scores) |
| Correction annotations | Human labeling | Medium (references turns) |
| User satisfaction | Brief survey | Low |

### Privacy Considerations for Publication

- All published results use structural patterns only (no content)
- Session examples in papers use synthetic or anonymized conversations
- Metrics are aggregated — individual sessions are not published
- User identities are never disclosed
- Can demonstrate with Clyde's own sessions (self-experimentation, no external consent needed)

---

## 5. Resource Estimates

| Phase | Duration | Compute | Human Time |
|-------|----------|---------|------------|
| Phase 1 (immediate) | 2 weeks | Minimal (eval only) | ~16 hours |
| Phase 2 (ALLM validation) | 90 days | LoRA training (~$50/run × 10 runs) | ~40 hours |
| Phase 3 (full pipeline) | 6 months | Continuous (~$200/month compute) | ~20 hours/month |

Total estimated cost: ~$2,000 compute + ~150 hours human evaluation over 6 months.

---

## 6. Success Criteria for Patent Support

The experimental results need to demonstrate:

1. **The problem exists:** Thread disappearance rate >30% (Exp 1.2), goldfish brain errors measurable (Exp 1.3)
2. **Rolling compaction solves the runtime problem:** Higher thread awareness scores (Exp 1.1)
3. **Vitality scoring is predictive:** Correlation >0.6 (Exp 2.2)
4. **Pruning works without harm:** 15-30% reduction, no quality loss (Exp 2.3)
5. **The combined system self-improves:** Decreasing correction rate over time (Exp 3.1)

These five results, if achieved, make the patent claims empirically defensible and provide the data for academic publication.

---

*Experimental design — Molt AI Corp. Prepared 2026-05-05.*
