# Patent Brief: Adaptive LoRA Lifecycle Management (ALLM)

## Title
System and Method for Adaptive Lifecycle Management of Training Data for Personalized AI Model Adapters Using Neuroscience-Inspired Vitality Scoring and Pattern Pruning

## Inventors
- Chris Fontes

## Filing Status
DRAFT — For attorney review

---

## 1. Technical Field

This invention relates to machine learning model personalization, specifically to methods for dynamically managing the lifecycle of training data used to produce Low-Rank Adaptation (LoRA) adapters for large language models, enabling the adapter to evolve with its user rather than calcifying around initial interaction patterns.

## 2. Background / Problem Statement

### 2.1 The Personalization Challenge

Large language models are general-purpose. When deployed as personal AI agents, they require personalization to learn user-specific preferences, workflows, terminology, and behavioral patterns. LoRA fine-tuning (Hu et al., 2021) provides an efficient mechanism: small trainable matrices applied to frozen model weights, producing personalized behavior at low computational cost.

### 2.2 The Accumulate-Forever Anti-Pattern

Every current LoRA personalization system treats training data as monotonically accumulating:

- Session data is extracted → training examples are created → examples are added to dataset → model is retrained
- Older examples are never removed, never re-evaluated, never weighted differently based on current relevance

This creates three compounding failures:

**Pattern Calcification:** Early interaction patterns dominate the training set by volume. As the user's needs evolve, stale patterns dilute the signal of current behavior. An adapter trained on 6 months of data where the user spent Month 1 learning Python and Months 2-6 working in Rust will retain disproportionate Python-helping patterns.

**Signal Dilution:** Training on N examples where K are stale produces worse outcomes than training on N-K current examples. The stale patterns are noise, not signal.

**Correction Residue:** When a user corrects the model and the correction becomes a training example, that example persists indefinitely — even after the model has fully internalized the lesson. The training example no longer teaches; it wastes capacity and can cause overcorrection.

### 2.3 The Neuroscience Parallel (Novel Application)

Biological neural networks solve this exact problem through well-characterized mechanisms:

- **Long-Term Potentiation (LTP):** Repeatedly activated synapses strengthen
- **Long-Term Depression (LTD):** Rarely activated synapses weaken
- **Synaptic Pruning:** Weak synapses are physically removed, freeing resources
- **Homeostatic Plasticity:** Total network activation is kept in balance

This is not merely an analogy. LoRA adapters are low-rank weight updates to attention layers — they literally strengthen certain computational pathways. Training examples that activate those pathways are analogous to synaptic inputs. Removing stale training examples (pruning) weakens the corresponding pathways, just as synaptic pruning removes underused connections.

The mathematical isomorphism:
- Synapse activation frequency → Pattern match frequency in sessions
- LTP strengthening → Core pattern weight boost (1.2x)
- LTD weakening → Fading pattern weight reduction (0.8x)
- Synaptic pruning → Dead pattern removal from training set
- Homeostatic plasticity → Minimum dataset size constraint + quality evaluation

### 2.4 Prior Art Analysis

| System | What It Does | What It Doesn't Do |
|--------|-------------|-------------------|
| LoRA (Hu 2021) | Efficient fine-tuning | No lifecycle management of training data |
| QLoRA (Dettmers 2023) | Memory-efficient fine-tuning | Same — no data lifecycle |
| EWC (Kirkpatrick 2017) | Prevents catastrophic forgetting | Aims to PRESERVE, not intentionally forget |
| Synaptic Intelligence (Zenke 2017) | Online importance estimation | Same — preservation-focused |
| Curriculum Learning (Bengio 2009) | Training data ordering matters | Static ordering, no lifecycle |
| Lottery Ticket (Frankle 2018) | Sparse subnetworks suffice | Architecture-level, not data-level |
| Active Learning | Smart data selection for initial training | No post-training lifecycle |

**The gap:** No existing system treats LoRA training data as a living, evolving collection that strengthens relevant patterns and prunes irrelevant ones based on ongoing user behavior. All existing approaches either accumulate forever or focus on preventing forgetting — none enable *intentional, adaptive forgetting*.

## 3. Summary of Invention

The invention provides a complete lifecycle management system for LoRA training data comprising:

1. **Pattern Extraction** — Extracts structural behavioral patterns (not raw content) from user-agent interaction sessions, categorized by interaction type (multi-part handling, tool chains, corrections, disambiguation, formatting, domain-specific).

2. **Vitality Scoring Function V(p,t)** — A multi-factor scoring function incorporating recency (exponential decay), frequency (saturation-bounded), correction-source weighting (lessons learned are more valuable), and quality signal (impact on correction rate). Produces a single [0,1] score per pattern.

3. **Trailing-Window Diff Engine** — Compares pattern vitality across the last N training cycles, classifying each pattern as core, stable, fading, dead, or emerging. Includes semantic similarity matching for detecting pattern evolution (same behavioral intent, different surface form).

4. **Automated Pruning with Safety Constraints** — Dead patterns are pruned, fading patterns are down-weighted, core patterns are boosted. Safety constraints prevent premature pruning of correction-sourced patterns, maintain minimum dataset sizes, and preserve a core personality set.

5. **Continuous Retraining Protocol** — Triggered by time, volume, distribution shift (Jensen-Shannon divergence), or quality degradation (correction rate increase). Includes automatic rollback if the new adapter underperforms.

## 4. Detailed Description

### 4.1 System Pipeline

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐    ┌────────────┐
│ Sessions │───▶│   Pattern    │───▶│  Vitality   │───▶│ Dataset  │───▶│  Training  │
│ (JSONL)  │    │ Extraction   │    │  Scoring    │    │ Curation │    │  + Deploy  │
└──────────┘    └──────────────┘    └─────────────┘    └──────────┘    └────────────┘
                                          │                                    │
                                          │         ┌──────────────┐           │
                                          └────────▶│ Trailing-Win │◀──────────┘
                                                    │  Diff Engine │
                                                    └──────────────┘
```

### 4.2 Pattern Extraction (Stage 1)

Patterns are **structural behavioral signals**, not raw conversation content. This distinction is critical for:
- Privacy (patterns can be content-free)
- Generalizability (structural patterns transfer better than content-specific ones)
- Efficiency (fewer, higher-quality training examples)

#### Pattern Categories

| Category | Structural Signal | Example |
|----------|------------------|---------|
| Multi-part handling | How N-item inputs are addressed | "3 questions → numbered response addressing all 3" |
| Tool call chains | Sequence and structure of tool use | "read → parse → modify → write → verify" |
| Correction recovery | How corrections are processed | "User says 'no, actually X' → model adjusts without repeating error" |
| Disambiguation | When clarification is sought vs. assumptions made | "Ambiguous input → asks 'did you mean X or Y?'" |
| Formatting | Output structure preferences | "Always uses numbered lists, never tables" |
| Domain-specific | User-specific workflow patterns | "'Config' → always means /etc/service/config.yaml" |
| Instruction following | Precision of directive execution | "'Install v4.0' → installs exactly v4.0, not latest" |

#### Privacy-Preserving Extraction

Content can be replaced with structural placeholders:
- "User asked 3 questions about [TOPIC_A], [TOPIC_B], [TOPIC_C]" → "User asked 3 questions about different topics"
- The behavioral pattern (addressing all 3) is preserved without retaining the actual questions

### 4.3 Vitality Scoring Function (Stage 2)

**V(p, t) = α · R(p, t) + β · F(p, t) + γ · C(p) + δ · Q(p, t)**

#### R(p, t) — Recency Score
```
R(p, t) = exp(-λ · Δt(p))
```
- Δt(p) = days since pattern p was last matched in a session
- λ = decay rate (default 0.05, half-life ≈ 14 days)
- Interpretation: patterns not seen recently decay exponentially toward zero
- Neuroscience parallel: **Long-Term Depression** — unused synapses weaken over time

#### F(p, t) — Frequency Score
```
F(p, t) = min(1.0, count(p, window) / F_max)
```
- count(p, window) = times pattern matched in trailing window (default 30 days)
- F_max = saturation threshold (default 10)
- Interpretation: frequently-triggered patterns plateau at 1.0 (no benefit to firing 100x vs. 10x)
- Neuroscience parallel: **Frequency-dependent LTP** — repeated activation strengthens, but saturates

#### C(p) — Correction-Source Weight
```
C(p) = 1.0 if source == "correction"
C(p) = 0.5 if source == "organic"
```
- Correction-sourced patterns are more valuable because they represent explicit lessons
- They should decay slower than organically-observed patterns (represented by higher base weight)
- Neuroscience parallel: **Error-driven learning** — mistakes create stronger memory traces than routine successes

#### Q(p, t) — Quality Signal
```
Q(p, t) = correction_rate_with(p) / correction_rate_without(p)
```
- If including pattern p reduces user corrections: Q > 1 (beneficial)
- If including pattern p increases corrections: Q < 1 (harmful)
- Defaults to 1.0 when no A/B data available
- Neuroscience parallel: **Reward signal** — dopaminergic reinforcement of useful pathways

#### Default Hyperparameters
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| α (recency weight) | 0.35 | Most important — stale patterns are the core problem |
| β (frequency weight) | 0.30 | Second — confirms pattern is actively relevant |
| γ (correction weight) | 0.20 | Third — lessons learned deserve persistence |
| δ (quality weight) | 0.15 | Fourth — often unavailable early, grows over time |
| λ (decay rate) | 0.05 | Half-life ≈ 14 days — patterns unused for a month score near zero |
| F_max (frequency cap) | 10 | Saturation — 10 matches in 30 days = max frequency score |

### 4.4 Trailing-Window Diff Engine (Stage 3)

Compares pattern presence across the last N training cycles (default N=3):

| Present In | Classification | Training Weight |
|------------|---------------|----------------|
| All N cycles | **Core** | 1.2x (boost) |
| N-1 cycles | **Stable** | 1.0x (normal) |
| 1 cycle only | **Fading** | 0.8x (reduce) |
| Latest=absent, previous=present | **Dead** | Pruned (0x) |
| Latest=present, no history | **Emerging** | 1.0x (monitor) |

#### Semantic Similarity Matching

Patterns are not compared by exact string match. Two patterns are "the same" if their embedding cosine similarity exceeds 0.85. This handles:
- "Model answers all 3 questions" ≈ "Model answers all 4 questions" (same behavior, different count)
- "Uses exec for file ops" ≈ "Uses exec for file ops with verification" (evolved version)

#### Evolution Detection

When similarity is 0.70-0.85 (related but changed), the pattern is classified as an **evolution**:
- Old version is archived (not pruned — lineage preserved)
- New version inherits the old version's vitality history
- This enables tracking of how user preferences shift over time

### 4.5 Pruning Strategy (Stage 4)

#### Vitality-Based Pruning Tiers

| Vitality Score | Action |
|---------------|--------|
| V < 0.2 | Auto-prune |
| 0.2 ≤ V < 0.5 | Weight reduced to 0.5x |
| 0.5 ≤ V < 0.8 | Normal weight (1.0x) |
| V ≥ 0.8 | Boosted weight (1.2x) |

#### Safety Constraints (Critical)

1. **Correction floor:** Correction-sourced patterns CANNOT be pruned within 30 days of creation. Lessons need time to be internalized by the model.

2. **Core personality set:** A manually-curated set of patterns marked as never-prune. These define the agent's fundamental behavioral contract with its user.

3. **Minimum dataset size:** Curated dataset must maintain ≥50 examples after pruning. If pruning would go below, only the lowest-vitality patterns above 50 are pruned.

4. **Archive, don't delete:** Pruned patterns move to cold storage. If user behavior reverts to an old pattern, it can be recovered without re-extraction.

### 4.6 Continuous Retraining Protocol (Stage 5)

#### Triggers (any one fires → retrain)

| Trigger | Threshold | Rationale |
|---------|-----------|-----------|
| Time-based | 7 days | Minimum cadence for freshness |
| Volume-based | 50+ new session hours | Enough new data to be meaningful |
| Drift-based | JS divergence > 15% | Pattern distribution has shifted significantly |
| Quality-based | Correction rate +10% | Model is degrading, needs refresh |

#### Evaluation Protocol

After each training cycle:
1. Evaluate new adapter on held-out test set
2. Compare against previous adapter on same test set
3. If new adapter ≥ previous: deploy
4. If new adapter < previous: **automatic rollback** + flag for review

Metrics tracked:
- Correction rate (% of turns requiring user correction)
- First-attempt success rate
- Pattern match rate (are training patterns reflected in behavior?)
- Pruning efficiency (% pruned without quality loss)
- Adaptation lag (days between new behavior → pattern in training)

## 5. Claims

**Claim 1.** A computer-implemented method for managing the lifecycle of training data used to personalize an artificial intelligence language model adapter, comprising:
(a) extracting behavioral patterns from user-agent interaction sessions, wherein each behavioral pattern captures a structural interaction signal independent of conversation content;
(b) computing a vitality score for each behavioral pattern based on at least recency of pattern occurrence in subsequent sessions, frequency of pattern occurrence, and whether the pattern originated from a user correction;
(c) comparing vitality scores across a trailing window of at least two previous training cycles to classify each pattern as one of: core, stable, fading, or dead;
(d) pruning patterns classified as dead from the training dataset;
(e) training a low-rank adaptation (LoRA) adapter on the curated training dataset; and
(f) deploying the trained adapter to modify the behavior of the language model.

**Claim 2.** The method of Claim 1, wherein the vitality score V(p, t) for a pattern p at time t is computed as:
V(p, t) = α · R(p, t) + β · F(p, t) + γ · C(p) + δ · Q(p, t)
where R(p, t) is an exponentially-decaying recency score, F(p, t) is a frequency score normalized against a saturation threshold, C(p) is a correction-source weight that assigns higher value to patterns extracted from user corrections, Q(p, t) is a quality signal measuring the pattern's impact on model accuracy, and α, β, γ, δ are tunable hyperparameters.

**Claim 3.** The method of Claim 1, wherein comparing vitality scores across a trailing window comprises:
(a) for each pattern, determining its presence or absence in each of the N most recent training cycles;
(b) classifying patterns present in all N cycles as core patterns;
(c) classifying patterns present in N-1 cycles as stable patterns;
(d) classifying patterns present in only one cycle as fading patterns; and
(e) classifying patterns absent from the most recent cycle but present in previous cycles as dead patterns.

**Claim 4.** The method of Claim 1, wherein extracting behavioral patterns comprises identifying at least one of: multi-part instruction handling patterns, tool call chain structures, correction recovery sequences, disambiguation behaviors, formatting preferences, and domain-specific workflow patterns.

**Claim 5.** The method of Claim 1, further comprising:
(a) maintaining a core personality set of patterns marked as never-prune;
(b) enforcing a minimum retention period for correction-sourced patterns;
(c) enforcing a minimum dataset size below which pruning is not performed; and
(d) archiving pruned patterns to enable recovery if user behavior reverts.

**Claim 6.** The method of Claim 1, further comprising:
(a) evaluating the deployed adapter against a held-out test set;
(b) comparing evaluation metrics to the previously deployed adapter; and
(c) automatically reverting to the previous adapter if evaluation metrics regress.

**Claim 7.** The method of Claim 1, wherein the training cycle is triggered by at least one of: a time-based schedule, accumulation of a threshold number of new session hours, a shift in pattern distribution exceeding a threshold measured by Jensen-Shannon divergence, or an increase in user correction rate exceeding a threshold.

**Claim 8.** The method of Claim 1, further comprising detecting pattern evolution by:
(a) computing embedding representations for behavioral patterns across successive training cycles;
(b) identifying pattern pairs with cosine similarity between a lower threshold and an upper threshold as evolutionary variants;
(c) archiving the older variant while transferring its vitality history to the newer variant; and
(d) maintaining a lineage record linking evolutionary variants.

**Claim 9.** A system for adaptive personalization of an AI language model, comprising:
(a) a pattern extraction module that processes user-agent transcripts to output structural behavioral patterns;
(b) a vitality scoring module that computes a multi-factor score for each pattern incorporating exponential recency decay, frequency saturation, correction-source weighting, and quality signals;
(c) a trailing-window diff engine that compares pattern vitality across multiple training cycles and classifies patterns by lifecycle stage;
(d) a dataset curator that prunes dead patterns, adjusts training weights for fading and core patterns, and enforces safety constraints;
(e) a training module that produces a LoRA adapter from the curated dataset; and
(f) an evaluation module that compares adapter quality before and after retraining with automatic rollback on regression.

**Claim 10.** The system of Claim 9, wherein the vitality scoring module applies differential decay rates based on pattern source, with correction-sourced patterns decaying at a slower rate than organically-observed patterns.

**Claim 11.** The system of Claim 9, wherein the pattern extraction module operates on structural behavioral signals independent of conversation content, enabling privacy-preserving personalization.

**Claim 12.** A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform the method of Claim 1.

## 6. Novelty Statement

The core novelty is the **combination** of:
1. Treating training data as a living system with lifecycle stages (not static accumulation)
2. The specific multi-factor vitality scoring function with neuroscience-inspired decay
3. Trailing-window differential analysis for lifecycle classification
4. Intentional, adaptive forgetting with safety constraints (vs. all prior art which focuses on preventing forgetting)
5. Continuous retraining triggered by behavioral drift detection

No existing system implements intentional, structured forgetting of personalization data based on ongoing behavioral relevance. All prior work either accumulates forever (LoRA/QLoRA pipelines) or focuses on preventing catastrophic forgetting (EWC, Synaptic Intelligence).

## 7. Commercial Embodiment

The invention is embodied in the kasett-rewind plugin for the OpenClaw agent framework, with planned deployment to personal AI agents serving individual users on continuous multi-month engagements.

---

*DRAFT — Molt AI Corp. For qualified patent attorney review.*
