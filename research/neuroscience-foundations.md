# Neuroscience Foundations for ALLM

## Purpose

This document establishes the scientific foundation for the neuroscience-to-ML isomorphism at the core of ALLM. It provides citations, mechanism descriptions, and the formal mapping that patent claims rely on.

---

## 1. Biological Memory Systems Overview

Human memory operates across multiple timescales through distinct but interconnected systems:

| System | Duration | Mechanism | Capacity |
|--------|----------|-----------|----------|
| Sensory memory | <1 second | Iconic/echoic buffers | High (all input) |
| Working memory | Seconds to minutes | Prefrontal sustained activity | ~7±2 items |
| Short-term memory | Minutes to hours | Hippocampal binding | Limited |
| Long-term memory | Days to lifetime | Cortical consolidation + synaptic modification | Effectively unlimited |

### Key Principle: Consolidation and Forgetting Are Active Processes

Memory is not passive storage. The brain actively:
1. **Consolidates** important patterns from short-term to long-term (sleep-dependent, replay-mediated)
2. **Prunes** irrelevant connections (activity-dependent synaptic elimination)
3. **Strengthens** frequently-used pathways (LTP)
4. **Weakens** disused pathways (LTD)
5. **Maintains homeostasis** (total synaptic strength is regulated)

Forgetting is not a failure — it is a **feature** that maintains signal-to-noise ratio.

---

## 2. Long-Term Potentiation (LTP)

### Definition
Long-lasting enhancement of signal transmission between neurons that occurs when they are stimulated synchronously. First described by Bliss & Lømo (1973).

### Mechanism
1. Presynaptic neuron releases glutamate
2. Postsynaptic NMDA receptors require both glutamate AND depolarization (coincidence detection)
3. Ca²⁺ influx triggers kinase cascades (CaMKII, PKC)
4. AMPA receptors inserted into postsynaptic membrane
5. Result: stronger response to same input

### Properties Relevant to ALLM
- **Frequency-dependent:** Higher stimulation frequency → stronger potentiation
- **Input-specific:** Only the stimulated synapse strengthens (not neighbors)
- **Associative:** Weak input can be potentiated if paired with strong input
- **Persistent:** Can last hours to weeks with maintenance
- **Saturating:** There's a ceiling — can't potentiate indefinitely

### ALLM Mapping
| LTP Property | ALLM Implementation |
|-------------|-------------------|
| Frequency-dependent | F(p,t) — patterns matched more often get higher frequency score |
| Input-specific | Per-pattern scoring — each pattern scored independently |
| Persistent with maintenance | Patterns maintain vitality as long as they keep being matched |
| Saturating | F_max threshold — no benefit beyond 10 matches in 30 days |

### Citations
- Bliss, T.V.P., & Lømo, T. (1973). Long-lasting potentiation of synaptic transmission in the dentate area of the anaesthetized rabbit following stimulation of the perforant path. *J. Physiol.*, 232(2), 331-356.
- Malenka, R.C., & Bear, M.F. (2004). LTP and LTD: an embarrassment of riches. *Neuron*, 44(1), 5-21.
- Citri, A., & Malenka, R.C. (2008). Synaptic plasticity: multiple forms, functions, and mechanisms. *Neuropsychopharmacology*, 33(1), 18-41.

---

## 3. Long-Term Depression (LTD)

### Definition
Long-lasting decrease in synaptic strength that occurs with low-frequency or asynchronous stimulation.

### Mechanism
1. Low-frequency stimulation (1 Hz) or asynchronous pre/post firing
2. Moderate Ca²⁺ influx (lower than LTP threshold)
3. Phosphatase activation (PP1, calcineurin) instead of kinases
4. AMPA receptor internalization
5. Result: weaker response to same input

### Properties Relevant to ALLM
- **Activity-dependent:** Synapses must be active (but at wrong frequency) to weaken
- **Complementary to LTP:** Same synapse can undergo both LTP and LTD
- **Reversible:** LTD can be reversed by subsequent LTP-inducing stimulation
- **Threshold-dependent:** Below LTP threshold → LTD; above → LTP

### ALLM Mapping
| LTD Property | ALLM Implementation |
|-------------|-------------------|
| Activity-dependent weakening | R(p,t) exponential decay — patterns not matched recently weaken |
| Complementary to strengthening | Same pattern can transition from core → stable → fading based on activity |
| Reversible | Archived patterns can be recovered if user reverts to old behavior |
| Threshold-dependent | Vitality thresholds (0.8/0.5/0.2) determine lifecycle stage |

### Citations
- Dudek, S.M., & Bear, M.F. (1992). Homosynaptic long-term depression in area CA1 of hippocampus and effects of N-methyl-D-aspartate receptor blockade. *PNAS*, 89(10), 4363-4367.
- Collingridge, G.L., et al. (2010). Long-term depression in the CNS. *Nature Reviews Neuroscience*, 11(7), 459-473.

---

## 4. Synaptic Pruning

### Definition
The elimination of synapses (physical removal, not just weakening) during neural development and ongoing maintenance. Removes approximately 50% of synapses between early childhood and adulthood.

### Mechanism
1. Microglia (immune cells) detect weakened synapses
2. Complement proteins (C1q, C3) tag underused synapses for elimination
3. Microglia engulf and digest tagged synapses (phagocytosis)
4. Result: permanent removal, freeing metabolic resources

### Properties Relevant to ALLM
- **Activity-dependent:** Used synapses survive; unused are eliminated
- **Irreversible (mostly):** Pruned synapses are physically gone — new ones must form
- **Resource-freeing:** Pruning frees metabolic resources for remaining connections
- **Quality-improving:** Post-pruning networks are more efficient and specialized
- **Has safety mechanisms:** Critical pathways (e.g., reflexes) are protected from pruning

### ALLM Mapping
| Pruning Property | ALLM Implementation |
|-----------------|-------------------|
| Activity-dependent elimination | Dead patterns (V < 0.2, absent from recent cycles) are pruned |
| Resource-freeing | Pruning reduces dataset size → faster training, less noise |
| Quality-improving | Post-pruning adapter is more focused on current behavior |
| Safety mechanisms | Core personality set (never-prune), correction floor (30-day minimum), minimum dataset size |
| Mostly irreversible | Patterns are archived (not deleted) — ALLM is more forgiving than biology |

### Citations
- Huttenlocher, P.R. (1979). Synaptic density in human frontal cortex: developmental changes and effects of aging. *Brain Res.*, 163(2), 195-205.
- Paolicelli, R.C., et al. (2011). Synaptic pruning by microglia is necessary for normal brain development. *Science*, 333(6048), 1456-1458.
- Schafer, D.P., et al. (2012). Microglia sculpt postnatal neural circuits in an activity and complement-dependent manner. *Neuron*, 74(4), 691-705.

---

## 5. Homeostatic Plasticity

### Definition
Mechanisms that maintain overall network stability despite ongoing LTP/LTD at individual synapses. Prevents runaway excitation or silencing.

### Mechanism
1. **Synaptic scaling:** Global multiplicative adjustment of all synaptic weights (up or down)
2. **Metaplasticity:** The threshold for LTP/LTD shifts based on recent activity history
3. **Intrinsic excitability adjustment:** Neurons adjust their own firing threshold

### Properties Relevant to ALLM
- **Prevents runaway:** No single pattern can dominate indefinitely
- **Maintains balance:** Total "training weight" stays within bounds
- **History-dependent thresholds:** Past activity affects current plasticity rules

### ALLM Mapping
| Homeostasis Property | ALLM Implementation |
|---------------------|-------------------|
| Prevents runaway | Frequency saturation (F_max = 10) — can't boost beyond ceiling |
| Maintains balance | Minimum dataset size prevents over-pruning; weights bounded [0.5, 1.2] |
| History-dependent | Trailing-window considers last N cycles, not just current |

### Citations
- Turrigiano, G.G. (2008). The self-tuning neuron: synaptic scaling of excitatory synapses. *Cell*, 135(3), 422-435.
- Abraham, W.C. (2008). Metaplasticity: tuning synapses and networks for plasticity. *Nature Reviews Neuroscience*, 9(5), 387-399.

---

## 6. Error-Driven Learning

### Definition
The brain assigns stronger memory traces to events associated with prediction errors (unexpected outcomes). Mediated by dopaminergic reward prediction error signals.

### Mechanism
1. Prediction error occurs (expected ≠ actual)
2. Ventral tegmental area (VTA) dopamine neurons fire (or pause)
3. Dopamine release modulates plasticity in target regions
4. Synapses active during the error are strengthened MORE than during routine success
5. Result: mistakes are remembered better than routine successes

### Properties Relevant to ALLM
- **Errors create stronger traces:** Correction-sourced patterns should persist longer
- **Signal importance:** Not all training data is equal — data from error events is more informative
- **Asymmetric:** Positive surprise and negative surprise have different effects

### ALLM Mapping
| Error-Driven Property | ALLM Implementation |
|----------------------|-------------------|
| Errors create stronger traces | C(p) = 1.0 for correction-sourced vs. 0.5 for organic |
| Data from errors is more informative | Correction floor: 30 days before correction patterns can be pruned |
| Not all data is equal | Multi-factor vitality ensures different sources are weighted differently |

### Citations
- Schultz, W. (1998). Predictive reward signal of dopamine neurons. *J. Neurophysiol.*, 80(1), 1-27.
- Schultz, W., Dayan, P., & Montague, P.R. (1997). A neural substrate of prediction and reward. *Science*, 275(5306), 1593-1599.

---

## 7. Formal Isomorphism Table

| Neuroscience Concept | Mathematical Formalism | ALLM Component | Implementation |
|---------------------|----------------------|----------------|----------------|
| LTP (strengthening) | ΔW ∝ pre × post × learning_rate | Core pattern weight boost | weight = 1.2x for V ≥ 0.8 |
| LTD (weakening) | ΔW ∝ -pre × post × rate | Fading pattern weight reduction | weight = 0.8x for 0.2 ≤ V < 0.5 |
| Synaptic pruning | synapse → null | Dead pattern removal | Remove from dataset when V < 0.2 |
| Frequency-dependent LTP | Higher freq → more LTP | F(p,t) frequency score | min(1.0, count/F_max) |
| Exponential synaptic decay | W(t) = W₀ · e^(-t/τ) | R(p,t) recency score | exp(-λ · Δt) |
| Error-driven learning | |δ| → learning rate boost | C(p) correction weight | 1.0 (correction) vs. 0.5 (organic) |
| Homeostatic scaling | Σ weights → bounded | Safety constraints | Min dataset size, weight bounds, F_max saturation |
| Synaptic tagging | Tag → consolidate later | Pattern archival | Pruned → cold storage, not deleted |
| Metaplasticity | Recent history → threshold | Trailing-window diff | Last N cycles determine lifecycle stage |
| Memory consolidation | Short-term → long-term | Drop-to-extract bridge | Compaction summaries → training patterns |

---

## 8. Why This Isn't Just an Analogy

The patent claims rest on the assertion that this mapping is **structural** (isomorphic), not merely **metaphorical** (analogical). The distinction:

**Analogy:** "Training data is LIKE a synapse because both involve learning."
- Too broad — everything in ML is "like" learning
- Not patentable — analogies don't produce specific mechanisms

**Isomorphism:** "The exponential decay function R(p,t) = exp(-λ·Δt) is the mathematical equivalent of synaptic long-term depression, applied to pattern relevance instead of synaptic strength, with decay rate λ calibrated to produce similar half-life characteristics as observed in biological LTD."
- Specific — names the function, the parameter, the calibration
- Produces specific mechanisms — the decay rate, the threshold tiers, the safety constraints
- Novel application — this specific mapping has not been applied to LoRA training data management

The neuroscience principles are well-known. Their application to training data lifecycle management for LoRA adapters is novel. The specific multi-factor vitality function, the trailing-window diff, and the safety constraints are all novel implementations inspired by (but not previously connected to) neuroscience mechanisms.

---

## 9. Recommended Expert Reviewers

For patent prosecution and academic publication, consider consulting:
- Computational neuroscientists working on plasticity models (Terry Sejnowski, Tomoki Fukai)
- ML researchers at the intersection of neuroscience and deep learning (Blake Richards, Timothy Lillicrap)
- Legal experts in ML/neuroscience patent claims (check AIPLA biotechnology committee)

---

*Research document — Molt AI Corp. Prepared 2026-05-05.*
