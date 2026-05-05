# Prior Art Analysis — kasett-rewind Patent Portfolio

## Executive Summary

Three patent briefs covering:
1. **Rolling Compaction Window** — Runtime context management with structured thread tracking
2. **ALLM** — Adaptive LoRA Lifecycle Management with neuroscience-inspired pruning
3. **Combined System** — Integrated architecture where runtime compaction feeds training lifecycle

**Overall assessment: STRONG novelty.** The core innovation (intentional adaptive forgetting of training data based on behavioral relevance) has no direct prior art. The rolling compaction window has some overlap with sliding window techniques but the thread evolution tracking is novel. The combination is entirely novel.

---

## 1. Rolling Compaction Window — Prior Art

### 1.1 Most Relevant Prior Art

| Reference | What It Does | How We Differ |
|-----------|-------------|---------------|
| **LangChain ConversationSummaryBufferMemory** | Maintains summary + recent buffer | Single summary, overwritten each cycle. No window, no thread tracking |
| **LangChain ConversationSummaryMemory** | Incrementally updates a running summary | Same summary mutated — no multi-summary retention |
| **OpenClaw compaction (current)** | Produces single structured summary | We extend this with windowing + thread evolution |
| **MemGPT (Packer et al. 2023)** | Hierarchical memory with paging | Focus is on retrieval from external store, not trajectory in context |
| **Sliding Window Attention (Beltagy 2020)** | Fixed attention window at architecture level | Not configurable per-deployment, no structure, purely architectural |
| **AutoGen Teachability** | Stores facts in vector DB for retrieval | RAG approach, not in-context trajectory |

### 1.2 Patent Landscape Search Terms

- "context window management language model"
- "conversation summary retention multiple"
- "thread tracking AI agent compaction"
- "rolling window context compression"

### 1.3 Identified Risk Areas

**Low risk:**
- Thread tracking structure is novel — no existing system enforces thread evolution rules
- Rolling window of summaries with configurable budget is novel
- Gradual thread evolution constraints have no prior art

**Medium risk:**
- The concept of "keeping more than one summary" is simple enough that someone may have patented a broad version
- Need to search for patents from Google (Bard/Gemini context management), Meta (LLaMA tooling), Microsoft (Copilot session management)

**Action items for attorney:**
- Run full patent search on: US 2023/0259*, US 2024/0* related to "context" + "summary" + "retention" + "language model"
- Check Google's DeepMind publications on conversation management
- Check Anthropic's published technical reports on context handling

### 1.4 Key Differentiators to Emphasize

1. **Thread evolution rules** — No existing system enforces that workstreams cannot silently disappear between compressions. This is entirely novel.
2. **Structured + narrative** — Existing systems produce free-form summaries OR structured data. We produce both in the same compaction output.
3. **Budget splitting across window** — Configurable proportional allocation across multiple retained summaries is novel.
4. **Validation + retry** — Post-generation validation of thread continuity with optional regeneration is novel.

---

## 2. ALLM — Prior Art

### 2.1 Most Relevant Prior Art

| Reference | What It Does | How We Differ |
|-----------|-------------|---------------|
| **LoRA (Hu 2021)** | Efficient fine-tuning mechanism | We manage the LIFECYCLE of the data fed to LoRA |
| **QLoRA (Dettmers 2023)** | Memory-efficient LoRA | Same — mechanism, not lifecycle |
| **EWC (Kirkpatrick 2017)** | Prevents catastrophic forgetting | Aims to PRESERVE. We aim to intentionally FORGET. Opposite goal. |
| **Synaptic Intelligence (Zenke 2017)** | Online importance estimation for preservation | Same — preservation-focused |
| **Progressive Neural Networks (Rusu 2016)** | Adds capacity for new tasks | Architecture expansion, not data pruning |
| **Active Learning (Settles 2009)** | Smart selection of what to label | Selects data for INITIAL training, no lifecycle |
| **Curriculum Learning (Bengio 2009)** | Order matters in training | Static ordering, no dynamic lifecycle |
| **Experience Replay (Lin 1992)** | Replay old experiences in RL | Replays all uniformly — no vitality-based selection |
| **Prioritized Experience Replay (Schaul 2015)** | Priority-weighted replay | Closest prior art but: (1) RL-specific, (2) priority based on TD error not behavioral relevance, (3) no pruning, just sampling weights |
| **Data Distillation (Wang 2018)** | Compress dataset into fewer examples | One-time compression, no ongoing lifecycle |
| **Forgetting in Continual Learning (survey, De Lange 2021)** | Surveys approaches to prevent forgetting | All surveyed work aims to PREVENT forgetting. None enable adaptive forgetting. |

### 2.2 Critical Distinction from Closest Prior Art

**Prioritized Experience Replay (PER)** is the closest:
- PER weights replay based on prediction error (TD error in RL)
- ALLM weights training based on behavioral relevance to the CURRENT user

Key differences:
1. PER operates in reinforcement learning; ALLM operates in supervised fine-tuning
2. PER's priority is TD error (how surprising); ALLM's priority is vitality (how relevant NOW)
3. PER never removes experiences; ALLM explicitly prunes dead patterns
4. PER has no concept of "correction source" weighting
5. PER has no trailing-window lifecycle classification
6. PER has no evolution detection via semantic similarity

**Elastic Weight Consolidation (EWC)** is the philosophical opposite:
- EWC identifies IMPORTANT weights and prevents them from changing
- ALLM identifies IRRELEVANT data and removes it to prevent stale influence
- EWC = "don't forget important things"
- ALLM = "actively forget irrelevant things"

### 2.3 Patent Landscape

**Key searches:**
- "adaptive training data management machine learning"
- "pattern pruning personalization language model"
- "vitality score training examples"
- "behavioral pattern lifecycle artificial intelligence"

**Likely clear because:**
- The LoRA personalization space is very new (2021+)
- Fine-tuning as personalization for agents is even newer (2023+)
- The specific combination of vitality scoring + trailing-window diff + neuroscience-inspired decay has no parallel
- Most ML patents focus on the TRAINING ALGORITHM, not the DATA LIFECYCLE

### 2.4 Key Differentiators to Emphasize

1. **Intentional forgetting** — Direct opposite of all continual learning literature
2. **Behavioral patterns, not raw data** — Extraction of structural signals, not conversation content
3. **Multi-factor vitality scoring** — Novel specific function with neuroscience-inspired components
4. **Trailing-window diff with lifecycle classification** — No prior art on classifying training data lifecycle stage based on cross-cycle comparison
5. **Safety constraints** — Correction floor, minimum dataset, archive-not-delete
6. **Drift-triggered retraining** — Jensen-Shannon divergence between pattern distributions

---

## 3. Combined System — Prior Art

### 3.1 Why the Combination Is Novel

No existing system in the literature or in commercial products combines:
- Runtime context compression
- Training data lifecycle management
- A bridge where one feeds the other

These are universally treated as separate concerns. Even in research that discusses both context management and fine-tuning, they are described as independent systems that happen to serve the same agent.

### 3.2 The Novel Bridge Mechanisms

1. **Drop-to-Extract:** Oldest compaction summary → pattern extraction pipeline. No prior art.
2. **Thread-modulated decay:** Pattern vitality decay rate changes based on runtime thread lifecycle. No prior art.
3. **Drift detection via thread evolution:** Using structured compaction metadata as a drift signal for training triggers. No prior art.
4. **Unified memory hierarchy:** Explicit mapping of working/short-term/long-term/archival memory types to specific technical mechanisms. Conceptually discussed in MemGPT but not implemented as an integrated pipeline.

### 3.3 MemGPT Comparison (Closest Conceptual Analog)

MemGPT (Packer et al., 2023) proposes hierarchical memory for LLM agents:
- Main context (working memory) + archival storage (long-term)
- Self-directed memory management (model decides what to store/retrieve)

**Key differences from kasett-rewind:**
1. MemGPT retrieves from archival; kasett-rewind TRAINS from archived patterns (fundamentally different use)
2. MemGPT has no concept of adaptive training or LoRA lifecycle
3. MemGPT's "memory management" is retrieval-augmented generation; kasett-rewind's is behavioral model adaptation
4. MemGPT doesn't track thread evolution or enforce trajectory awareness
5. MemGPT is model-directed (LLM decides what to remember); kasett-rewind is system-directed (vitality function decides)

---

## 4. Academic Publication Strategy

### 4.1 Recommended Papers

| Paper | Venue | Timing |
|-------|-------|--------|
| "Rolling Compaction: Maintaining Trajectory Awareness in Long-Running AI Agents" | NeurIPS Workshop on Foundation Model Agents / EMNLP | After filing |
| "Adaptive LoRA Lifecycle Management: Intentional Forgetting for Evolving Personal AI" | ICML / NeurIPS main | After filing |
| "Unified Adaptive Memory for Persistent AI Agents" | AAAI / ACL | After both above |

### 4.2 Key Experimental Claims to Support

1. Rolling compaction with N=2 reduces "goldfish brain" errors by X% (user study needed)
2. ALLM pruning maintains correction rate while reducing dataset size by 15-30%
3. Thread-modulated decay improves adaptation lag vs. flat decay
4. Combined system outperforms independent components (synergy measurement)

### 4.3 Data Collection Requirements

- Single-user deployment over 90+ days
- At least 3 compaction cycles with thread tracking
- At least 3 training cycles with full ALLM pipeline
- Correction rate tracking throughout
- A/B evaluation (with and without pruning)

---

## 5. Freedom to Operate Concerns

### 5.1 Potential Blockers

| Concern | Risk Level | Mitigation |
|---------|------------|------------|
| Broad "memory management for AI" patent from large corp | Medium | Our claims are specific (rolling window + thread tracking + vitality scoring). Broad claims likely wouldn't survive if challenged. |
| LoRA itself is patented by Microsoft | Low | We don't claim LoRA — we claim the lifecycle management OF training data FOR LoRA. |
| OpenClaw's existing compaction.provider hook | None | OpenClaw is open source (ISC license). Our plugin uses the hook as designed. No IP conflict. |

### 5.2 Recommended Searches Before Filing

1. Google Patents: "context management" + "language model" + "summary" + "window" (2022-2026)
2. Google Patents: "training data" + "lifecycle" + "personalization" + "language model" (2023-2026)
3. USPTO PAIR: Check for pending applications from OpenAI, Google, Meta, Microsoft, Anthropic related to agent memory
4. ArXiv: Full literature review of agent memory systems (2023-2026)
5. Specific check: Microsoft Research publications on "personalizing Copilot" or similar

---

## 6. Filing Strategy Recommendation

### Option A: Three Separate Filings (Recommended)
1. Rolling Compaction Window — independent utility patent
2. ALLM — independent utility patent
3. Combined System — dependent on (1) and (2), covers the integration

**Pros:** Maximum claim coverage, each patent stands alone, harder to invalidate all three
**Cons:** Higher filing cost (~$15-25K total for provisionals + utility conversions)

### Option B: Single Comprehensive Filing
One patent covering the entire system with dependent claims for individual components.

**Pros:** Lower initial cost (~$8-12K), simpler to manage
**Cons:** Single point of failure, easier for competitors to design around one patent

### Option C: Provisional + Divide Later
File one provisional covering everything, then divide into separate utility applications within the 12-month priority window based on prior art search results.

**Pros:** Locks in priority date immediately at low cost (~$2-3K), defers expense
**Cons:** 12-month clock starts ticking, need to decide before search completes

### Recommendation

**Option C** — File comprehensive provisional immediately to lock priority date. Use the 12-month window to:
1. Complete prior art search
2. Collect experimental data
3. Decide whether to file 1, 2, or 3 utility applications
4. Refine claims based on findings

---

*Analysis prepared for Molt AI Corp. attorney review. Last updated 2026-05-05.*
