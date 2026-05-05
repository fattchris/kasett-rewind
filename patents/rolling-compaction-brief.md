# Patent Brief: Rolling Compaction Window for AI Agent Context Management

## Title
System and Method for Maintaining Trajectory Awareness in AI Agents Through Rolling Context Compaction with Structured Thread Tracking

## Inventors
- Chris Fontes

## Filing Status
DRAFT — For attorney review

---

## 1. Technical Field

This invention relates to context management in conversational AI systems, specifically to methods for preserving multi-session trajectory awareness when an AI agent's operational context exceeds its processing window and must be summarized (compacted).

## 2. Background / Problem Statement

### 2.1 Context Windows and Compaction

Large language models (LLMs) operate within fixed context windows (typically 128K-2M tokens). When deployed as persistent agents with long-running conversations, the accumulated conversation history eventually exceeds this window. Current systems address this through "compaction" — summarizing older conversation into a compressed block that fits within the context budget.

### 2.2 The Single-Summary Problem

Existing compaction implementations (including those in OpenClaw, LangChain, AutoGen, and similar frameworks) produce a **single compaction summary**. When the context fills again and a second compaction is triggered, the first summary is itself re-summarized into the second — losing depth and nuance with each cycle.

After N compactions:
- Compaction 1: Full detail of turns 1-100
- Compaction 2: Summary-of-summary (turns 1-100 compressed, turns 101-200 detailed)
- Compaction 3: Summary-of-summary-of-summary (turns 1-200 highly compressed, turns 201-300 detailed)

This creates a **recency bias problem** where the agent retains high-fidelity awareness of recent interactions but progressively loses awareness of earlier work, decisions, and context threads.

### 2.3 Consequences

1. **Topic drift without awareness** — The agent doesn't know it's drifted from the original objective
2. **Repeated mistakes** — The agent forgot it already tried approach X and it failed
3. **Lost multi-session context threads** — Work streams that span multiple compactions disappear
4. **Thread disappearance** — Active workstreams silently vanish from the agent's awareness without explicit resolution
5. **User frustration** — Humans must re-explain context the agent previously possessed

### 2.4 Prior Art Limitations

| System | Approach | Limitation |
|--------|----------|------------|
| OpenClaw (current) | Single compaction summary | Loses trajectory on 2nd+ compaction |
| LangChain ConversationSummaryBufferMemory | Summary + recent buffer | Summary is overwritten each cycle |
| AutoGen | Session-level summary | No cross-session retention |
| Sliding window attention | Architectural (fixed window) | Not configurable, no structure |
| RAG systems | Retrieve from external store | Retrieval latency, no trajectory |

No existing system maintains a **rolling window of multiple structured compaction summaries** with **thread evolution tracking**.

## 3. Summary of Invention

The invention provides a method for maintaining AI agent trajectory awareness through:

1. **Rolling Compaction Window** — Instead of maintaining a single compaction summary, the system retains a configurable window of N compaction summaries (default N=2). When a new compaction occurs, the oldest summary in the window is dropped and a new summary is added, with each summary preserved as-is (not re-summarized into the next).

2. **Token Budget Splitting** — The available context budget is dynamically allocated across the N summaries and recent turns using configurable proportions, ensuring each retained summary receives adequate representation.

3. **Structured Thread Tracking** — Each compaction summary includes a structured thread snapshot (main thread, sub-threads, key state, unresolved items) that the summarization model is required to produce.

4. **Gradual Thread Evolution Rules** — A set of constraints ensuring that threads from one compaction MUST appear in the next compaction as either still-active, completed, blocked, or deprioritized. Threads cannot silently disappear. This is enforced through prompt engineering and/or structured output schemas.

5. **Thread History Merging** — When threads transition from active to resolved, they move to a thread history section that carries forward across compactions, providing long-term awareness of completed work.

## 4. Detailed Description

### 4.1 System Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Agent Context Window                  │
├──────────────┬──────────────┬───────────────────────┤
│ Compaction   │ Compaction   │                       │
│ Summary N-1  │ Summary N    │   Recent Turns        │
│ (oldest)     │ (newest)     │   (verbatim)          │
│              │              │                       │
│ 30% budget   │ 30% budget   │   40% budget          │
├──────────────┼──────────────┼───────────────────────┤
│ Thread       │ Thread       │                       │
│ Snapshot     │ Snapshot     │   Live conversation   │
│ (structured) │ (structured) │                       │
└──────────────┴──────────────┴───────────────────────┘
```

### 4.2 Compaction Triggering

When the system detects that the conversation history exceeds the available context budget minus a safety margin:

1. The system identifies the conversation turns that need to be summarized
2. The rolling window manager retrieves existing compaction summaries
3. A structured compaction prompt is constructed that:
   - Includes the previous compaction summaries as context
   - Requires the output to follow the structured thread format
   - Specifies the token budget for the new summary
4. The LLM produces the new structured summary
5. The window manager pushes the new summary, potentially dropping the oldest

### 4.3 Structured Thread Snapshot Schema

Each compaction summary contains:

```
{
  "summary": "Free-form narrative...",
  "windowIndex": 0,
  "windowTotal": 2,
  "threadSnapshot": {
    "mainThread": "Primary task description",
    "subThreads": [
      {"name": "...", "status": "active|completed|blocked|backgrounded", "detail": "..."}
    ],
    "keyState": {"key": "value"},
    "unresolved": ["item1", "item2"],
    "threadHistory": [
      {"thread": "...", "status": "completed", "lastSeen": "ISO-timestamp"}
    ]
  },
  "timestamp": "ISO-timestamp",
  "tokenCount": 500
}
```

### 4.4 Thread Evolution Constraints

The system enforces that between compaction N and compaction N+1:

- Every active thread from compaction N MUST appear in compaction N+1 as either:
  - Still active (with updated state)
  - Completed (explicitly marked with outcome)
  - Blocked (with reason)
  - Deprioritized/backgrounded (with reason)
- A thread CANNOT simply disappear without explanation
- Maximum 3 active sub-threads at any time
- When a 4th sub-thread emerges, the lowest-activity existing sub-thread is explicitly marked "backgrounded"
- Thread history carries forward (capped at 10 entries)

Enforcement mechanisms:
- **Prompt-level:** The compaction prompt template requires structured output and references previous thread state
- **Validation-level:** Post-generation validation checks that all previous threads are accounted for
- **Retry-level:** If validation fails, the system can retry with explicit instructions to address missing threads

### 4.5 Token Budget Management

The system supports configurable budget splits:

```
windowBudgetSplit: [0.3, 0.3, 0.4]
                    │     │     └─ Recent turns (verbatim)
                    │     └─ Newest summary
                    └─ Oldest summary
```

For windowSize=3:
```
windowBudgetSplit: [0.2, 0.2, 0.25, 0.35]
                    │     │     │      └─ Recent turns
                    │     │     └─ Newest summary
                    │     └─ Middle summary
                    └─ Oldest summary
```

The system validates that the split array length equals windowSize + 1 and sums to 1.0.

### 4.6 Integration with Existing Systems

The invention operates as a plugin/provider within existing LLM agent frameworks:

- **As a compaction.provider:** Replaces the built-in summarizer entirely
- **As customInstructions:** Injects structured prompt requirements into the existing summarization flow (Phase 1 compatibility)
- **As a standalone module:** Can be integrated into any agent framework that supports extensible context management

## 5. Claims

**Claim 1.** A computer-implemented method for maintaining trajectory awareness in an AI agent operating within a fixed-size context window, comprising:
(a) detecting that accumulated conversation history exceeds a context budget threshold;
(b) retrieving a rolling window of N previously-generated compaction summaries, where N ≥ 1;
(c) constructing a summarization prompt that includes said previous summaries and requires structured output comprising at minimum: a main thread identifier, active sub-threads with status, and key state values;
(d) generating a new compaction summary from recent conversation turns using said prompt;
(e) validating that all threads from the most recent previous summary appear in the new summary with an explicit status;
(f) storing the new summary in the rolling window, dropping the oldest summary when the window exceeds N; and
(g) constructing the agent's operational context from the retained window of summaries plus recent verbatim turns.

**Claim 2.** The method of Claim 1, wherein the context budget is allocated across the rolling window summaries and recent turns according to a configurable split proportion, and wherein the split array length equals the window size plus one.

**Claim 3.** The method of Claim 1, wherein validating thread continuity comprises:
(a) identifying all threads (main thread and sub-threads) present in the most recent previous summary;
(b) checking that each identified thread appears in the new summary as either active, completed, blocked, or deprioritized;
(c) flagging any thread that has disappeared without explicit status change as a validation violation; and
(d) optionally regenerating the summary with explicit instructions to address missing threads.

**Claim 4.** The method of Claim 1, wherein each compaction summary includes a thread history section that records previously-active threads with their terminal status and the timestamp of their last active appearance, enabling the agent to maintain awareness of completed work across multiple compaction cycles.

**Claim 5.** The method of Claim 1, further comprising enforcing a maximum number of concurrent active sub-threads (default 3), and when a new sub-thread emerges beyond this limit, automatically marking the lowest-activity existing sub-thread as "backgrounded" with an explicit notation.

**Claim 6.** The method of Claim 1, wherein the rolling window of summaries is stored as structured events in a session journal file, with each event containing both the free-form narrative summary and the structured thread snapshot, enabling programmatic access to thread state.

**Claim 7.** A system for trajectory-aware context management in a conversational AI agent, comprising:
(a) a compaction trigger module that detects when conversation context exceeds a budget threshold;
(b) a rolling window manager that maintains N compaction summaries with configurable budget allocation;
(c) a structured prompt builder that constructs summarization prompts requiring thread-tracked output format;
(d) a thread evolution validator that ensures no active thread disappears between successive compactions without explicit resolution; and
(e) a context assembler that constructs the agent's operational context from the retained summary window plus recent verbatim conversation turns.

**Claim 8.** The system of Claim 7, further comprising a thread history merger that carries completed-thread records forward across compaction cycles with a configurable maximum history size.

**Claim 9.** A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform the method of Claim 1.

## 6. Advantages Over Prior Art

1. **Trajectory preservation** — Agent maintains awareness of work done 2-3 compactions ago, not just the most recent
2. **Thread accountability** — No silent loss of active workstreams
3. **Configurable depth** — Window size tunable per deployment (deeper for complex agents, shallower for simple ones)
4. **Backward compatible** — windowSize=1 replicates current single-summary behavior exactly
5. **Framework agnostic** — Works as prompt injection (Phase 1) or full provider replacement
6. **Structured + narrative** — Both human-readable narrative and machine-parseable thread state

## 7. Implementation Status

- Phase 1 (prompt-only): Implemented and deployable today via `compaction.customInstructions` in OpenClaw
- Phase 2 (rolling window): Implemented in kasett-rewind plugin, pending OpenClaw integration hooks
- Phase 3 (structured schema): Designed, pending implementation
- Phase 4 (thread-aware pre-loading): Designed, pending implementation

---

*DRAFT — Molt AI Corp. For qualified patent attorney review.*
