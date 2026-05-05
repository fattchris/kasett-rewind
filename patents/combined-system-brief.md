# Patent Brief: Combined Adaptive Memory System for Persistent AI Agents

## Title
Integrated System for Runtime Context Management and Training Data Lifecycle in Persistent AI Agents Combining Rolling Compaction Windows with Adaptive Behavioral Pattern Pruning

## Inventors
- Chris Fontes

## Filing Status
DRAFT — For attorney review

---

## 1. Technical Field

This invention relates to the combined management of short-term operational context and long-term behavioral training in persistent AI agents, specifically to an integrated system where runtime compaction events feed a training data lifecycle pipeline, creating a closed-loop adaptive memory architecture.

## 2. Background / Problem Statement

### 2.1 Two Memory Problems, One Agent

Persistent AI agents (those serving a single user over weeks/months/years) face two distinct but interconnected memory challenges:

1. **Short-term (runtime):** The agent's context window fills during a session and must be compressed. Current systems lose trajectory awareness after multiple compressions.

2. **Long-term (training):** The agent's personalization adapter (LoRA) accumulates training data indefinitely, leading to pattern calcification as the user's needs evolve.

These are solved separately in existing literature and implementations. No system treats them as a **unified memory architecture** where the short-term system feeds the long-term system in a continuous adaptive loop.

### 2.2 The Missing Integration

The connection between runtime compaction and training data is direct:

- When a compaction summary is **dropped** from the rolling window (oldest summary rolled off), it contains behavioral patterns that are now too old for runtime context — but they are exactly the right age for training data extraction.
- Thread evolution across compactions reveals how the user's priorities and workflow change over time — this is a **drift signal** for the training pipeline.
- The structured thread tracking in compaction summaries provides metadata that enriches pattern extraction (what was the agent working on when this pattern emerged?).

### 2.3 The Closed-Loop Architecture

```
                    ┌─────────────────────────────────┐
                    │         RUNTIME LAYER            │
                    │   (Rolling Compaction Window)     │
                    │                                   │
                    │  [Summary N-1] [Summary N] [Turns]│
                    └───────────────┬───────────────────┘
                                    │
                         Dropped summaries + 
                         Thread evolution signals
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │        TRAINING LAYER            │
                    │   (ALLM Lifecycle Pipeline)       │
                    │                                   │
                    │  Extract → Score → Diff → Train  │
                    └───────────────┬───────────────────┘
                                    │
                         Deployed LoRA adapter
                         (modifies agent behavior)
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │        AGENT BEHAVIOR            │
                    │   (Modified by adapter + context) │
                    │                                   │
                    │  Generates sessions → new data    │
                    └───────────────┬───────────────────┘
                                    │
                                    └──────────────────────▶ Back to Runtime Layer
```

The key insight: **Dropped compaction summaries are the natural input to the training pipeline.** They represent behavioral patterns that have aged out of runtime relevance but contain exactly the signal needed for long-term personalization.

## 3. Summary of Invention

An integrated adaptive memory system for persistent AI agents comprising:

1. **Runtime Layer (Rolling Compaction):** Maintains a window of N structured compaction summaries with thread tracking, providing trajectory awareness during active sessions.

2. **Bridge Layer (Drop-to-Extract):** When the oldest compaction summary is dropped from the rolling window, it is fed to the training pipeline for pattern extraction. Thread evolution metadata enriches the extraction.

3. **Training Layer (ALLM):** Extracts behavioral patterns, scores vitality, diffs across training cycles, prunes dead patterns, and retrains the LoRA adapter.

4. **Feedback Loop:** The retrained adapter modifies the agent's behavior, which generates new sessions, which trigger new compactions, which feed new patterns — creating a self-improving closed loop.

5. **Drift Detection Bridge:** Thread evolution patterns from the compaction window serve as an early-warning drift signal for the training pipeline. If the agent's thread landscape shifts dramatically, it triggers an out-of-cycle retrain.

## 4. Detailed Description

### 4.1 Bridge Layer — Drop-to-Extract

When `CompactionWindow.push()` drops the oldest summary:

```typescript
const dropped = window.push(newSummary);
if (dropped && config.allmExtraction) {
  // The dropped summary becomes ALLM input
  const patterns = extractor.extractFromCompaction(dropped);
  // Thread metadata enriches pattern context
  for (const pattern of patterns) {
    pattern.contextThread = dropped.threadSnapshot.mainThread;
    pattern.contextSubThreads = dropped.threadSnapshot.subThreads;
  }
  await patternStore.ingest(patterns);
}
```

This creates a natural pipeline where:
- Patterns enter the training system at the same rate compactions occur (roughly every few hours of active work)
- Each pattern carries thread context from when it was generated
- The flow is automatic — no manual data extraction step needed

### 4.2 Thread Evolution as Drift Signal

The structured thread snapshots across successive compactions encode how the user's work evolves. By comparing thread snapshots across time:

```
Compaction 1: mainThread = "Building auth system"
Compaction 2: mainThread = "Building auth system" (stable)
Compaction 3: mainThread = "Migrating to Rust" (SHIFT)
Compaction 4: mainThread = "Migrating to Rust" (stable)
```

This shift signal can trigger the ALLM pipeline to:
- Reduce vitality of "auth system" patterns (no longer the primary focus)
- Boost emerging "Rust migration" patterns
- Potentially trigger an out-of-cycle retrain (drift-based trigger)

### 4.3 Pattern Context Enrichment

Standard ALLM extraction works on raw sessions. The integrated system adds **compaction context**:

| Without Integration | With Integration |
|--------------------|------------------|
| Pattern: "Uses exec for file ops" | Pattern: "Uses exec for file ops" + Context: "While building auth system, sub-thread: database migration" |
| No lifecycle awareness | Pattern lifecycle tied to thread lifecycle — when the thread dies, related patterns decay faster |
| Flat extraction | Hierarchical: patterns inherit priority from their thread's lifecycle stage |

### 4.4 Adaptive Decay Rate Modulation

In the standalone ALLM system, all patterns decay at rate λ = 0.05. In the integrated system, the decay rate is modulated by thread lifecycle:

```
λ_effective(p) = λ_base × thread_decay_multiplier(p)
```

Where:
- Thread still active → multiplier = 0.5 (slower decay — pattern is in active use context)
- Thread completed → multiplier = 1.0 (normal decay)
- Thread backgrounded → multiplier = 1.5 (faster decay — context has shifted away)
- Thread dead (absent from all recent compactions) → multiplier = 2.0 (rapid decay)

This means patterns associated with the user's current work naturally persist longer, while patterns from abandoned workstreams fade faster.

### 4.5 Unified Memory Architecture

The complete system provides an agent with:

| Memory Type | Duration | Mechanism | Location |
|-------------|----------|-----------|----------|
| Immediate | Current turn | Context window (recent turns) | RAM/context |
| Short-term | Last 2-3 compactions | Rolling window | Session JSONL |
| Medium-term | Last few weeks | Vitality-scored patterns | Pattern store |
| Long-term | Months | Trained LoRA adapter | Model weights |
| Archival | Indefinite | Dropped summaries + pruned patterns | Cold storage |

This mirrors biological memory systems:
- Working memory → Context window
- Short-term memory → Rolling compaction window
- Long-term memory → ALLM pattern store + LoRA adapter
- Episodic memory → Archived compaction summaries

## 5. Claims

**Claim 1.** A computer-implemented method for integrated adaptive memory management in a persistent AI agent, comprising:
(a) maintaining a rolling window of N compaction summaries during agent operation, each summary including structured thread tracking with main thread, sub-threads, and key state;
(b) when a new compaction summary is generated and the window exceeds N, dropping the oldest summary and routing it to a training data extraction pipeline;
(c) extracting behavioral patterns from the dropped summary, enriched with thread context metadata from the summary's structured thread snapshot;
(d) scoring pattern vitality using a multi-factor function incorporating recency, frequency, correction-source weighting, and thread lifecycle status;
(e) comparing pattern vitality across training cycles to classify patterns as core, stable, fading, or dead;
(f) pruning dead patterns and retraining a LoRA adapter on the curated dataset; and
(g) deploying the retrained adapter to modify the agent's behavior in subsequent sessions.

**Claim 2.** The method of Claim 1, wherein pattern vitality decay rate is modulated by the lifecycle status of the thread with which the pattern is associated, such that patterns associated with active threads decay slower and patterns associated with dead threads decay faster.

**Claim 3.** The method of Claim 1, further comprising detecting behavioral drift by comparing structured thread snapshots across successive compaction summaries, and triggering an out-of-cycle retrain when the main thread changes or when sub-thread composition shifts by more than a threshold.

**Claim 4.** The method of Claim 1, wherein the system provides a unified memory architecture spanning:
(a) immediate memory via the context window's recent turns;
(b) short-term memory via the rolling compaction window;
(c) medium-term memory via the vitality-scored pattern store; and
(d) long-term memory via the trained LoRA adapter weights.

**Claim 5.** The method of Claim 1, wherein behavioral patterns extracted from dropped compaction summaries inherit priority from the thread lifecycle stage at the time of extraction, with patterns from core threads receiving higher initial vitality than patterns from fading threads.

**Claim 6.** The method of Claim 1, further comprising maintaining an archival layer of dropped compaction summaries and pruned patterns, enabling recovery of previously-relevant behavioral patterns when user behavior reverts to earlier work contexts.

**Claim 7.** A system for integrated adaptive memory in a persistent AI agent, comprising:
(a) a runtime layer maintaining a rolling compaction window with structured thread tracking;
(b) a bridge layer that intercepts dropped compaction summaries and routes them to pattern extraction with thread context enrichment;
(c) a training layer implementing adaptive LoRA lifecycle management with vitality scoring, trailing-window diff, and automated pruning;
(d) a drift detection module that monitors thread evolution across compactions and triggers retraining when significant behavioral shifts are detected; and
(e) a feedback loop wherein the retrained adapter modifies agent behavior, generating new session data that flows back through the compaction and extraction pipeline.

**Claim 8.** The system of Claim 7, wherein the drift detection module computes thread landscape divergence by measuring the Jaccard similarity of active thread sets across successive compaction windows, triggering retrain when similarity drops below a threshold.

**Claim 9.** A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform the method of Claim 1.

## 6. Novelty Statement

The core novelty is the **integration** of runtime context management and training data lifecycle into a single closed-loop system where:

1. Runtime compaction events naturally feed the training pipeline (drop-to-extract bridge)
2. Thread evolution serves as a drift signal for training lifecycle decisions
3. Pattern vitality is modulated by runtime thread lifecycle (not just time-based decay)
4. The complete system mirrors biological memory hierarchy (working → short-term → long-term)

No existing system combines runtime context compression with training data lifecycle management as a unified architecture. They are universally treated as separate concerns.

## 7. Relationship to Individual Patents

This brief describes the **combined system** that includes both:
- The Rolling Compaction Window (separate brief: `rolling-compaction-brief.md`)
- The ALLM Pipeline (separate brief: `allm-brief.md`)

The individual inventions have independent patentable novelty. This brief covers the novel integration and the additional mechanisms (bridge layer, thread-modulated decay, drift detection) that emerge from their combination.

---

*DRAFT — Molt AI Corp. For qualified patent attorney review.*
