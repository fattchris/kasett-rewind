# Benchmarks & Standards Reference — Kasett + ALLM Evaluation

## Purpose

Map existing evaluation frameworks to our specific claims. Identify which benchmarks we should run against, which metrics we should adopt, and where we're defining new ground (no existing benchmark covers it).

---

## 1. Long-Context Memory & Recall Benchmarks

### 1.1 RULER (2024)
- **Paper:** "RULER: What's the Real Context Size of Your Long-Context Language Models?" (Hsieh et al., 2024)
- **What it measures:** Effective context utilization at various depths. Tests whether models actually USE information at different positions in long contexts.
- **Tasks:** Needle retrieval at variable depths, multi-key retrieval, multi-value retrieval, multi-query retrieval
- **Relevance to us:** HIGH. We can adapt the multi-key retrieval task: plant specific values (URLs, IDs) at various points in a session, compact, then test retrieval. This directly measures KSSR (Key State Survival Rate).
- **How to use:** Create a RULER-style probe for post-compaction key state retrieval
- **Adoption:** Widely cited (200+ citations), used by Google, Meta, Anthropic for context evaluation

### 1.2 Needle-in-a-Haystack (NIAH)
- **Origin:** Greg Kamradt (2023), refined by multiple labs
- **What it measures:** Can the model find a specific fact inserted at a particular position in a long context?
- **Relevance to us:** MEDIUM. Post-compaction NIAH tells us if compaction preserved specific facts. But our system is more nuanced (threads, not just single facts).
- **How to use:** Plant "needles" (key state values) at various session points, compact, probe
- **Adoption:** Universal. Every long-context paper uses this or a variant.

### 1.3 LongBench (2023)
- **Paper:** "LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding" (Bai et al., 2023)
- **What it measures:** 6 task categories across 21 datasets, testing genuine long-context understanding (not just retrieval)
- **Tasks:** Single-doc QA, multi-doc QA, summarization, few-shot learning, code completion, synthetic tasks
- **Relevance to us:** MEDIUM. The summarization sub-tasks are directly relevant. We can benchmark our compaction summaries against LongBench summarization quality metrics.
- **Adoption:** High (500+ citations), standard in long-context evaluation

### 1.4 InfiniteBench (2024)
- **Paper:** "∞Bench: Extending Long Context Evaluation Beyond 100K Tokens" (Zhang et al., 2024)
- **What it measures:** Tasks requiring 100K+ token contexts — math computation, code debugging, multi-turn dialogue understanding
- **Relevance to us:** LOW-MEDIUM. The multi-turn dialogue task is relevant but the scale (100K+) exceeds our compaction window. More useful for validating that our compaction doesn't lose information critical for these tasks.
- **Adoption:** Growing (recent)

### 1.5 HELMET (2024)
- **Paper:** "HELMET: How to Evaluate Long-Context Language Models Effectively and Thoroughly" (Yen et al., 2024)
- **What it measures:** Meta-evaluation framework. Identifies which existing benchmarks are actually reliable vs. which have flawed methodologies.
- **Relevance to us:** HIGH (meta). Use HELMET's recommendations to design our evaluation correctly. They found that many needle-type tests don't correlate with real task performance.
- **How to use:** Follow their guidelines for probe design and metric selection

---

## 2. Summarization Quality Metrics

### 2.1 ROUGE (Lin, 2004)
- **What it measures:** N-gram overlap between generated summary and reference
- **Variants:** ROUGE-1 (unigram), ROUGE-2 (bigram), ROUGE-L (longest common subsequence)
- **Relevance to us:** LOW for thread tracking (threads are novel text, not extractive), MEDIUM for narrative summary quality
- **Limitation:** Doesn't capture semantic equivalence. "PostgreSQL 15.2" and "Postgres version 15.2" score poorly despite meaning the same thing.
- **Adoption:** Universal baseline, expected in any summarization paper

### 2.2 BERTScore (Zhang et al., 2020)
- **What it measures:** Semantic similarity using contextual embeddings
- **Relevance to us:** MEDIUM-HIGH. Better than ROUGE for our case because thread descriptions evolve semantically (same thread, different words). Can measure whether the thread CONCEPT persists even if wording changes.
- **How to use:** BERTScore between pre-compaction thread descriptions and post-compaction thread meta
- **Adoption:** Standard (5000+ citations), expected alongside ROUGE

### 2.3 SummaC (Laban et al., 2022)
- **What it measures:** Summary faithfulness/consistency — does the summary contradict the source?
- **Relevance to us:** HIGH. Critical metric: does our compaction summary make claims that contradict what actually happened in the session? Hallucinated thread descriptions would be caught.
- **How to use:** Run SummaC on compaction summaries vs. source conversation
- **Adoption:** Growing standard for faithfulness evaluation

### 2.4 QuestEval (Scialom et al., 2021)
- **What it measures:** Question-based evaluation — generate questions from the source, see if the summary can answer them (and vice versa)
- **Relevance to us:** HIGH. Perfect for key state: generate questions about specific values from the pre-compaction context, test whether the summary enables answering them.
- **How to use:** Extract key state as questions, run against compaction output
- **Adoption:** Well-cited, used in ACL summarization papers

### 2.5 UniEval (Zhong et al., 2022)
- **What it measures:** Multi-dimensional evaluation: coherence, consistency, fluency, relevance (unified scorer)
- **Relevance to us:** MEDIUM. Good for overall summary quality but doesn't capture our specific thread-tracking dimension.
- **Adoption:** Standard in recent summarization work

---

## 3. Agent Memory & Episodic Recall

### 3.1 MemGPT / MemoryBank Evaluation (Packer et al., 2023; Zhong et al., 2024)
- **What it measures:** Agent's ability to recall information stored in long-term memory across sessions
- **Tasks:** Multi-session QA, persona consistency, fact recall across conversation boundaries
- **Relevance to us:** HIGH. Directly comparable. MemGPT is the closest prior work to Kasett. Their evaluation protocol (plant facts in early sessions, test recall in later sessions) maps directly to our compaction scenario.
- **How to use:** Adapt their multi-session recall protocol to multi-compaction recall
- **Adoption:** Moderate (MemGPT is well-known but eval protocol less standardized)

### 3.2 LoCoMo — Long-Context Conversations with Memory (Maharana et al., 2024)
- **Paper:** "LoCoMo: Long-Context Memory-Augmented Multi-Turn Conversation"
- **What it measures:** Memory-augmented agents in conversations spanning 600+ turns
- **Tasks:** Temporal reasoning, multi-hop memory retrieval, open-ended conversation quality
- **Relevance to us:** VERY HIGH. This is the closest benchmark to our actual use case. Tests whether an agent with memory can maintain coherence over very long conversations.
- **How to use:** Run our compaction system on LoCoMo's conversations, compare recall accuracy
- **Adoption:** Recent (2024), growing

### 3.3 StreamBench (2024)
- **What it measures:** Streaming evaluation of LLMs over time — how models perform as they process longer and longer contexts
- **Relevance to us:** HIGH for measuring degradation across compaction cycles. Does quality drop after the 3rd compaction? 5th?
- **How to use:** Adapted longitudinal protocol

### 3.4 PersonalLLM / LaMP (Salemi et al., 2024)
- **Paper:** "LaMP: When Large Language Models Meet Personalization"
- **What it measures:** Personalized text generation quality after learning user preferences
- **Tasks:** Personalized email, review, headline, paper title generation
- **Relevance to us:** HIGH for ALLM specifically. Tests whether personalization (analogous to our LoRA adaptation) improves task quality over time.
- **How to use:** Baseline for ALLM evaluation — does pattern-trained adapter outperform generic?
- **Adoption:** Standard in personalization track (EMNLP 2024 spotlight)

---

## 4. Conversational Summarization Benchmarks

### 4.1 SAMSum (Gliwa et al., 2019)
- **What it measures:** Chat/dialogue summarization quality
- **Relevance to us:** MEDIUM. Our summaries are of multi-turn agent conversations, similar to chat but more technical.
- **Adoption:** Standard dataset for dialogue summarization

### 4.2 DialogSum (Chen et al., 2021)
- **What it measures:** Dialogue summarization with structured output (topic, actions, decisions)
- **Relevance to us:** HIGH. Our thread meta IS structured output from dialogue summarization.
- **How to use:** Train/evaluate our meta extraction as a structured summarization task

### 4.3 QMSum (Zhong et al., 2021)
- **What it measures:** Query-based meeting summarization — given a query, produce relevant summary from long meeting transcript
- **Relevance to us:** HIGH. Thread tracking = implicit query ("what happened with thread X?"). Our system should enable query-based recall of specific threads.
- **Adoption:** Standard in meeting summarization

---

## 5. Metrics We Should Adopt (for credibility at NeurIPS/EMNLP)

### Tier 1: MUST INCLUDE (reviewers expect these)
| Metric | Why Required | Our Application |
|--------|-------------|----------------|
| **ROUGE-L** | Universal summarization baseline | Narrative summary quality |
| **BERTScore** | Semantic similarity standard | Thread concept persistence |
| **Human evaluation (Likert)** | Gold standard, always required | Thread coverage, key state, trajectory |
| **Inter-annotator agreement (κ)** | Proves human eval is reliable | Cohen's κ > 0.7 |
| **Effect size (Cohen's d)** | NeurIPS/EMNLP expect this, not just p-values | All primary comparisons |

### Tier 2: SHOULD INCLUDE (strengthens paper significantly)
| Metric | Why Valuable | Our Application |
|--------|-------------|----------------|
| **SummaC faithfulness** | Prevents hallucination in summaries | Compaction doesn't invent threads |
| **QuestEval** | Tests information retention via QA | Key state survival as question-answering |
| **Correction rate** | Practical user impact metric | ALLM primary metric |
| **Adaptation lag** | Novel metric for ALLM, shows practical value | Days to behavior change |
| **Thread Retention Rate (novel)** | OUR metric — define it clearly for the field | What % of threads survive compaction |

### Tier 3: NICE TO HAVE (differentiators)
| Metric | Why | Our Application |
|--------|-----|----------------|
| **NIAH-adapted probes** | Familiar framing for reviewers | Key state as "needles" |
| **LoCoMo comparison** | Direct benchmark comparison | Run on their dataset |
| **LaMP comparison** | ALLM vs. their personalization | Adaptation quality |

---

## 6. What's NOVEL (No Existing Benchmark Covers This)

### Gap 1: Compaction-Specific Thread Tracking
**No benchmark measures whether active workstreams survive context compression.** RULER tests retrieval from raw context. We test retrieval after intentional information destruction (compaction). This is a new evaluation dimension.

**Our contribution:** Thread Retention Rate (TRR) — first formalized metric for this.

### Gap 2: Weighted Thread Evolution Across Compactions
**No benchmark measures whether a feedback loop between successive compressions improves trajectory awareness.** The closest is LoCoMo's multi-session recall, but they don't have a steering mechanism.

**Our contribution:** First evaluation of compaction-to-compaction steering via weighted thread meta.

### Gap 3: Key State Survival Post-Compression
**NIAH tests retrieval from preserved context. We test retrieval from COMPRESSED context.** Different problem entirely. NIAH doesn't destroy the haystack first.

**Our contribution:** Key State Survival Rate (KSSR) — first metric specifically for value retention post-compression.

### Gap 4: Intentional Adaptive Forgetting for Personalization
**All continual learning benchmarks measure forgetting prevention. Nobody measures intentional, beneficial forgetting.** ALLM is literally the opposite of EWC/SI. No existing benchmark evaluates "did pruning help?"

**Our contribution:** Pruning Efficiency metric (% pruned without quality regression), Adaptation Lag metric.

---

## 7. Recommendations for Study Design

### For Maximum NeurIPS/EMNLP Credibility:

1. **Adopt ROUGE-L + BERTScore + Human Eval** as baseline metrics (reviewers expect them)
2. **Define TRR and KSSR formally** — these become our novel metrics, clearly defined with operational formulas
3. **Run on LoCoMo or a subset** — shows we work against an established benchmark, not just internal data
4. **Include a NIAH-style probe adapted for post-compaction** — familiar framing, novel application
5. **Report SummaC faithfulness** — protects against "but what if the threads are hallucinated?" reviewer objection
6. **Effect sizes, not just p-values** — Cohen's d for all primary comparisons
7. **Pre-register Phase 2** on OSF — reviewers love this

### For the Ablation (Kasett alone vs. ALLM alone vs. combined):

- Kasett metrics: TRR, KSSR, RER, trajectory coherence
- ALLM metrics: Correction rate, adaptation lag, pruning efficiency, LaMP-style personalization quality
- Combined: All above + interaction effect measurement

### What Benchmark To Run Against:

| Benchmark | Priority | Effort | Payoff |
|-----------|---------|--------|--------|
| **LoCoMo subset** | HIGH | Medium (adapt protocol) | Direct comparison to established work |
| **NIAH-adapted** | HIGH | Low (straightforward) | Familiar to every reviewer |
| **QMSum subset** | MEDIUM | Medium | Shows structured summarization angle |
| **LaMP (for ALLM)** | HIGH (ALLM paper) | High (needs training) | Standard personalization baseline |
| **SAMSum** | LOW | Low | Too simple for our use case |

---

## 8. Proposed Novel Benchmark: CompactBench

Since no existing benchmark covers compaction-specific evaluation, we should propose one:

**CompactBench** — A benchmark for evaluating AI agent context compression systems:

- **Task 1: Thread Persistence** — Given a multi-threaded conversation and a compaction event, how many threads survive in the output?
- **Task 2: Key State Retrieval** — Given specific values mentioned pre-compaction, can they be retrieved post-compaction?
- **Task 3: Trajectory Reconstruction** — From a series of compaction summaries, can a reader reconstruct the session's trajectory?
- **Task 4: Steering Effectiveness** — Given a weighted thread history, does the steering prompt produce appropriate thread evolution?
- **Task 5: Multi-Compaction Degradation** — How does quality degrade across 3, 5, 10 successive compactions?

If we build CompactBench alongside the paper, we both evaluate our system AND contribute an evaluation resource to the field. Papers that introduce both a system and a benchmark are stronger.

---

## 9. Citations (Key Papers to Reference)

1. Hsieh et al. (2024). "RULER: What's the Real Context Size of Your Long-Context Language Models?" arXiv:2404.06654
2. Bai et al. (2023). "LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding." arXiv:2308.14508
3. Zhang et al. (2024). "∞Bench: Extending Long Context Evaluation Beyond 100K Tokens." arXiv:2402.13718
4. Yen et al. (2024). "HELMET: How to Evaluate Long-Context Language Models Effectively and Thoroughly." arXiv:2410.02694
5. Packer et al. (2023). "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560
6. Maharana et al. (2024). "LoCoMo: Long-Context Conversations with Memory." arXiv:2402.????
7. Salemi et al. (2024). "LaMP: When Large Language Models Meet Personalization." arXiv:2304.11406
8. Zhong et al. (2022). "UniEval: Unified Multi-Dimensional Evaluation." arXiv:2210.07197
9. Laban et al. (2022). "SummaC: Re-Visiting NLI-based Models for Inconsistency Detection." TACL.
10. Scialom et al. (2021). "QuestEval: Summarization Asks for Fact-based Evaluation." EMNLP.
11. Lin (2004). "ROUGE: A Package for Automatic Evaluation of Summaries." ACL Workshop.
12. Zhang et al. (2020). "BERTScore: Evaluating Text Generation with BERT." ICLR.
13. Kirkpatrick et al. (2017). "Overcoming Catastrophic Forgetting." PNAS.
14. Hu et al. (2021). "LoRA: Low-Rank Adaptation." arXiv:2106.09685.

---

*Benchmarks reference — Kasett. Prepared 2026-05-05.*
