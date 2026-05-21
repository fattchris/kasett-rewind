# ALLM Patent Claims — DRAFT
## For Attorney Review

### Title
System and Method for Adaptive Lifecycle Management of Training Data for Personalized AI Model Adapters

### Inventors
- Chris Fontes, Molt AI Corp

### Claims

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
(e) classifying patterns absent from the most recent two cycles as dead patterns.

**Claim 4.** The method of Claim 1, wherein extracting behavioral patterns comprises identifying at least one of: multi-part instruction handling patterns, tool call chain structures, correction recovery sequences, disambiguation behaviors, and domain-specific workflow patterns.

**Claim 5.** The method of Claim 1, further comprising:
(a) maintaining a core personality set of patterns marked as never-prune;
(b) enforcing a minimum retention period for correction-sourced patterns; and
(c) archiving pruned patterns to enable recovery if user behavior reverts.

**Claim 6.** The method of Claim 1, further comprising:
(a) evaluating the deployed adapter against a held-out test set;
(b) comparing evaluation metrics to the previously deployed adapter; and
(c) automatically reverting to the previous adapter if evaluation metrics regress.

**Claim 7.** The method of Claim 1, wherein the training cycle is triggered by at least one of: a time-based schedule, accumulation of a threshold number of new session hours, a shift in pattern distribution exceeding a threshold measured by Jensen-Shannon divergence, or an increase in user correction rate exceeding a threshold.

**Claim 8.** A system for adaptive personalization of an AI language model, comprising:
(a) a pattern extraction module configured to process user-agent interaction transcripts and output structured behavioral patterns;
(b) a vitality scoring module configured to compute a multi-factor vitality score for each pattern incorporating recency, frequency, correction-source weighting, and quality signals;
(c) a trailing-window diff engine configured to compare pattern vitality across multiple training cycles and classify patterns by lifecycle stage;
(d) a dataset curator configured to prune dead patterns and adjust training weights for fading and core patterns;
(e) a training module configured to produce a low-rank adaptation (LoRA) adapter from the curated dataset; and
(f) an evaluation module configured to compare adapter quality before and after retraining, with automatic rollback on regression.

**Claim 9.** The system of Claim 8, wherein the trailing-window diff engine uses semantic embedding similarity rather than exact string matching to determine pattern identity across training cycles, enabling detection of pattern evolution.

**Claim 10.** The system of Claim 8, further comprising a decay function that weakens patterns not matched in recent sessions at an exponential rate, with correction-sourced patterns decaying at a slower rate than organically-observed patterns.

**Claim 11.** A method for detecting behavioral pattern evolution in a personalized AI agent, comprising:
(a) computing embedding representations for behavioral patterns across successive training cycles;
(b) identifying pattern pairs with cosine similarity between a lower threshold and an upper threshold as evolutionary variants of the same underlying behavior;
(c) archiving the older variant while transferring its vitality history to the newer variant; and
(d) maintaining a lineage record linking evolutionary variants.

**Claim 12.** A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform the method of Claim 1.

---

*DRAFT — For review by qualified patent attorney. Claims may need refinement based on prior art search.*
*Molt AI Corp, 2026.*
