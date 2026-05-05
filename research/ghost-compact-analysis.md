# Ghost Compact: Feasibility Analysis

**Date:** 2026-05-05  
**Goal:** Eliminate perceived compaction delay by pre-computing summaries before OC triggers `summarize()`.  
**Proposed by:** Zero  
**Reviewed against:** kasett-rewind v0.2.0 (post-refactor architecture)

---

## 1. Executive Summary

Ghost compact's **goal is sound** — zero-delay compaction is a meaningful UX improvement. However, Zero's proposed approach has a **fundamental architectural mismatch** with how the CompactionProvider interface works. The draft computed at 55% will be stale by 80%, and there's no clean way to "delta" it without essentially re-running the full summarization.

**Recommendation:** Don't implement ghost compact as proposed. Instead, pursue a **fast-model compaction strategy** (swap to a cheaper/faster model specifically for compaction) and optionally a **speculative pre-fetch** that reduces latency without trying to eliminate the LLM call entirely.

---

## 2. Architecture Constraints (What the Code Actually Shows)

### 2.1 The `summarize()` Interface

From `src/index.ts`, OC calls `summarize()` with:

```typescript
interface SummarizeParams {
  messages: Array<{ role: string; content: unknown }>;  // THE ACTUAL MESSAGES TO SUMMARIZE
  signal?: AbortSignal;
  customInstructions?: string;
  summarizationInstructions?: { identifierPolicy?: string; identifierInstructions?: string };
  previousSummary?: string;
}
```

**Critical insight:** `messages` is the authoritative input. OC passes the *exact* messages that need summarizing at trigger time. kasett cannot ignore this and return a cached summary based on different (fewer) messages — that would produce an incomplete/inaccurate summary that misses everything said between 55% and 80% fill.

### 2.2 What kasett Actually Does in `summarize()`

1. Reads previous summaries (for continuity/weighting)
2. Applies temporal decay weights
3. Builds a steering prompt (thread-aware instructions)
4. Calls an LLM with: steering + the `messages` OC passed in
5. Returns the full output (summary + [THREAD_META])

Steps 1-3 are lightweight (file I/O + string building). Step 4 is the bottleneck — **it's the LLM call that takes time**, and it needs the actual messages.

### 2.3 The Staleness Problem

If ghost compact pre-computes at 55%:
- It doesn't have the messages that will exist at 80% (OC hasn't provided them yet)
- Even if it could observe messages independently, 25% of the conversation is missing from the draft
- A "delta" approach (only summarize the new 25%) defeats the purpose — you still need an LLM call at trigger time

---

## 3. Evaluation of Zero's Proposal

### 3.1 "Monitor context fill level"

**Problem:** Zero correctly notes OC doesn't expose fill level to plugins. The `before_compaction` hook fires *immediately before* compaction — not at 55%. There's no hook for "you're at X% fill."

Workaround options:
- Count tokens in `before_prompt_build` messages (fragile, OC could change message formatting)
- Track message count and estimate (inaccurate — message sizes vary wildly)
- Request OC add a fill-level signal (requires upstream change)

**Verdict:** Technically possible to approximate, but brittle.

### 3.2 "Spawn a worker thread at 55%"

**Problem:** Even if you could detect 55% reliably, what would the worker do? It doesn't have the `messages` array that OC will eventually pass to `summarize()`. The worker would need to:
- Read the session JSONL directly (bypassing OC's message selection logic)
- Guess which messages OC will include at compaction time
- Hope that the messages-to-summarize at 80% are a superset of what existed at 55%

This is fundamentally speculative. OC's compaction message selection logic lives in `model-context-tokens-CwcLB3PA.js` (per the source comments) — kasett shouldn't duplicate/reverse-engineer it.

**Verdict:** Architecturally fragile. Tightly couples to OC internals.

### 3.3 "Return cached draft instantly from `summarize()`"

**Problem:** If `summarize()` returns the 55%-draft when called at 80%, the returned summary:
- Misses all messages from turns 55%→80% 
- Could miss critical context, decisions, or topic shifts
- Violates the implicit contract: OC expects `summarize()` to summarize the messages it provides

Returning stale output is not "eliminating delay" — it's sacrificing quality for speed in a way that causes **information loss**. The whole point of kasett-rewind is *preserving continuity*.

**Verdict:** Contradicts kasett's core purpose.

### 3.4 Hybrid "Delta" Approach

Could you pre-compute at 55%, then at 80% do a quick delta?

```
Draft (at 55%): Summary of messages 1-100
Delta (at 80%): "Here's an existing summary of messages 1-100. Now also incorporate messages 101-140."
```

This is theoretically possible but:
- Still requires an LLM call at trigger time (the delta pass)
- The delta LLM call might be faster (less input) but NOT instant
- Adds complexity: managing draft state, detecting overlap, handling edge cases (what if draft was aborted? what if a previous draft exists from a different branch?)
- The quality of "merge a draft + new messages" is likely worse than "summarize all messages fresh" — LLMs do better with full context than with partial context + instructions to merge

**Verdict:** Adds complexity for marginal latency reduction. Not worth it.

---

## 4. Better Approaches to the Same Goal

### 4.1 Fast-Model Compaction (RECOMMENDED — Simplest Win)

kasett already has a `compactionModel` config field. Set it to a fast, cheap model:

```json
{
  "compactionModel": "claude-haiku-3-5-20241022"
}
```

**Impact:**
- Haiku 3.5 generates at ~100 tokens/s vs Sonnet's ~60 tokens/s
- For a typical compaction output (~1500 tokens), that's 15s → 9s
- Gemini 2.0 Flash or GPT-4o-mini would be even faster (~3-5s)
- Quality trade: thread meta extraction might be slightly less accurate, but for compaction (not primary reasoning) this is acceptable

**Implementation:** Already supported — zero code changes. Just configure it.

**Latency achievable:** 3-8 seconds depending on model choice.

### 4.2 Streaming Summarization (Moderate Effort)

If OC's CompactionProvider interface allows returning a ReadableStream instead of a string (or if kasett could write to the session JSONL incrementally), the perceived delay drops because OC can start processing the summary before it's complete.

**Current status:** `summarize()` returns `Promise<string | undefined>` — it's all-or-nothing. This would require either:
- OC changing the interface to accept streaming (upstream)
- kasett writing a partial result early and updating it (hacky, possibly breaks OC's expectations)

**Verdict:** Good idea, requires OC-side changes. File as a feature request.

### 4.3 Prewarming the Context (Low Effort, Incremental)

The *actual* time breakdown in `summarize()`:

| Step | Time |
|------|------|
| 1. Read previous summaries from JSONL | ~50ms |
| 2. Weight + build steering prompt | ~1ms |
| 3. Convert messages to text | ~10ms |
| 4. HTTP + LLM generation | **95% of total time** |
| 5. Parse output | ~1ms |

Steps 1-3 could be pre-computed and cached in `before_compaction`:
- Read previous summaries into memory ahead of time
- Build the steering prompt
- Have it ready so `summarize()` skips the file I/O

**Impact:** Saves ~50-100ms. Negligible compared to the LLM call.

**Verdict:** Not worth the complexity for <1% improvement.

### 4.4 Parallel Summarization with Validation (Moderate Effort)

A more architecturally sound version of ghost compact:

1. In `before_prompt_build`, once you estimate ~70% fill (heuristic: count messages since last compaction), start a background LLM call with the messages you CAN see
2. When `summarize()` fires at 80%, check:
   - How many new messages arrived since the background call started?
   - If ≤3 new messages: use the background result + append a note about the new messages
   - If >3 new messages: discard background result, do full summarization

**Problem:** kasett's `before_prompt_build` doesn't receive the full message array in a format suitable for summarization. It gets `_event: BeforePromptBuildEvent` which has `messages: unknown[]` but the actual content structure may differ from what `summarize()` receives.

**Bigger problem:** The background LLM call still takes 10-15 seconds. If the session is active (messages arriving fast), by the time the background call finishes, compaction has already been triggered anyway. This only helps if there's a **quiet period** between 70% and 80% — which is exactly when delay doesn't matter (nobody's waiting).

**Verdict:** Helps in the wrong scenarios. The delay is worst when activity is high (messages arriving fast), which is exactly when the background draft goes stale fastest.

### 4.5 Reduce Summary Size (Low Effort)

Current prompt asks for a "concise compaction summary" + [THREAD_META]. If the max_tokens for compaction is reduced (e.g., 4096 → 2048), generation time halves.

**Impact:** ~50% latency reduction.  
**Trade-off:** Less detailed summaries. But combined with thread meta (which preserves orientation), shorter summaries may be sufficient.  
**Implementation:** Add `compactionMaxTokens` config, pass to LLM call.

---

## 5. The Uncomfortable Truth

**The compaction delay is ~10-20 seconds.** For a session with an active human, this is noticeable but not catastrophic. The question is: is the engineering complexity of ghost compact justified for saving 10-20 seconds every N hours?

Consider:
- Compaction fires at 80% fill, which typically means after 30-60+ minutes of active conversation
- A 15-second pause every 45 minutes is a ~0.5% overhead
- The user is already experiencing 3-10 second delays on every normal turn (LLM inference time)
- Compaction delay feels different because it's unexpected (no user message triggered it), but it's the same order of magnitude as normal response time

---

## 6. Recommendation

### Do Now (Zero Code Changes)
1. **Set `compactionModel` to a fast model** (Haiku 3.5, Gemini Flash, or GPT-4o-mini)
2. **Reduce `max_tokens` to 2048** for the compaction call (add a config field)

Expected result: Compaction drops from ~15s to ~5-8s.

### Do If 5-8s Is Still Too Slow
3. **Request streaming support from OC** (upstream feature request for `summarize()` to return a stream)
4. **Investigate OC's built-in progress feedback** — does it show "compacting..." to the user? If so, the perceived delay is already communicated. If not, that's an easier fix than ghost compact.

### Don't Do
- Ghost compact as proposed (stale drafts, architectural mismatch)
- Worker threads for speculative pre-computation (brittle, OC-internal coupling)
- Delta/merge approaches (worse quality, still requires LLM call)

### If Ghost Compact MUST Happen (Future State)

The only architecturally sound way would require **OC-side changes**:
1. OC exposes a `context_fill_level` event or hook parameter
2. OC exposes the "messages that would be summarized" before compaction actually fires (a `pre_compaction_preview` hook)
3. kasett uses the preview to start work early, then validates against the actual messages at trigger time
4. If messages match (no new ones since preview), return cached result
5. If messages diverged, fall through to full summarization

This makes ghost compact a **two-phase** operation with a clean validation gate. But it requires upstream cooperation and the complexity may not justify the ~5-10 second savings that a fast model already provides.

---

## 7. Summary Table

| Approach | Latency Reduction | Complexity | Quality Risk | Recommended? |
|----------|------------------|------------|--------------|--------------|
| Fast compaction model | 50-70% | None (config only) | Low | ✅ Yes |
| Reduce max_tokens | ~50% | Trivial (1 config field) | Medium | ✅ Yes |
| Ghost compact (Zero's proposal) | 90-100% (in theory) | High | **High** (stale data) | ❌ No |
| Delta/hybrid | 30-50% | High | Medium-High | ❌ No |
| Streaming (upstream) | Perceived ~80% | Moderate (requires OC change) | None | 🟡 Request |
| Parallel + validate | Variable | High | Medium | ❌ Not yet |

---

## 8. Open Questions

1. **Does OC show a "compacting..." indicator to the user?** If yes, the perceived delay may already be acceptable. If no, adding one is far simpler than ghost compact.
2. **What's the actual measured latency?** We're estimating 10-20s. Actual measurement (add timing logs to `summarize()`) would clarify whether this is even a problem worth solving.
3. **Would OC accept a PR for streaming CompactionProvider?** If yes, that's the cleanest path to near-zero perceived delay without sacrificing quality.
