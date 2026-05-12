# Kasett Thread Tracking — Strategic Analysis

**Date:** 2026-05-12
**Author:** Clyde (subagent, depth 1/1)
**Status:** Strategic — drives next sprint
**Audience:** kasett-rewind core team

---

## 1. Executive Summary

Kasett's thread-tracking model is a small, opinionated schema (`{ main: string, sub: [string, string, string] }`) wrapped in a markdown sentinel block (`[THREAD_META]`). The architecture is sound — separating heavy compaction-time blending from light per-turn orientation is the right two-axis design — but the **empirical evidence is brutal**: across 65 stored compaction events on this Clyde instance, **zero contain a successfully-produced [THREAD_META] block**. Production output is split between (a) hot-swap stubs whose `main:` field is a random sentence fragment (`"What about error state"`, `` "`pvc-261ae669` has an SOUL"``, `"Now let me find the config write section near the end of the build section: 1..."`), and (b) older legacy summaries with no thread tracking at all. The hot-swap worker either never ran at runtime (until 2026-05-08's model-ID fix), or it produced LLM output that landed somewhere other than the structured `data.summary` field we audit. The rich `[THREAD_META]` blocks visible in the daily-review dashboard are coming from test fixtures and embedded examples in conversations, not from real production compactions.

**What's working:** The architectural split (CompactionProvider + before_prompt_build hook), the fallback parser tolerance, the 80s-aesthetic mental model, and the steering-prompt structure. The hot-swap pipeline mechanically works end-to-end (verified 2026-05-08).

**What's not:** (1) thread continuity across compactions is fuzzy substring matching, which collapses immediately when the LLM rewords; (2) sub-threads are unordered, untyped strings with no lifecycle, no status, no relationships; (3) there is no key-state tracking — URLs, IDs, paths, decisions vanish at every compaction; (4) the [THREAD_META] format gets ignored or malformed in real runs (compliance rate at the storage layer is effectively 0% in production); (5) the steering prompt's "happy path" collapses into a single fragmented `main:` line under the stub fallback when the LLM never executes.

**Top three improvements (ranked):**

1. **Replace [THREAD_META] markdown sentinel with structured output (JSON schema via tool-call / response_format) and validate at parse-time.** Every LLM mainstream provider supports this in 2026; the markdown sentinel is the single largest reliability tax we are paying. Estimated compliance lift: ~0% → ~95%.
2. **Promote sub-threads from `string` to `{ id, label, status, last_seen, parent? }`** with an LLM-supplied lifecycle event (`new` / `update` / `complete` / `merge`) and a stable thread-id that survives rewording. This lets thread continuity work without fuzzy matching and unlocks meaningful trajectory measurement.
3. **Add a "key state" sidecar (`KeyState`)** — a flat list of `{ value, type, first_seen, last_seen, salience }` for URLs, IDs, paths, version numbers, file paths, secrets-prefix tokens. This is what users actually need to survive compaction, and what CompactBench's KSSR task measures. We currently score ~0 on it because we don't track it at all.

The rest of this document expands each finding with empirical evidence, prior-art comparison, and a concrete implementation roadmap.

---

## 2. Current State Assessment

### 2.1 The architecture (objective summary)

Two separate hooks, two separate concerns:

- **Compaction-time (CompactionProvider.summarize):** Reads last N stored compaction summaries from session JSONL → pairs them with temporal-decay weights `[1.0, 0.6, 0.3]` → builds steering prompt → calls LLM → returns full output (`summary + [THREAD_META]`). Hot-swap variant returns a stub immediately and runs the LLM in the background.
- **Per-turn (before_prompt_build):** Reads the last N compaction summaries → parses each `[THREAD_META]` block → builds an orientation string showing current thread + trajectory → injects via `prependContext`. No LLM call, no weights.

This split is genuinely good. Per-turn orientation must be cheap (it runs every turn); compaction-time blending must be heavy enough to make information-loss decisions. We should preserve this split through every change in §4.

### 2.2 The schema

```ts
type ThreadMeta = {
  main: string;           // 1 main thread
  sub: [string, string, string];  // exactly 3 sub-threads
};
```

Validation rules (`isValidThreadMeta`):
- `main` must be non-empty string
- `sub` must be exactly 3 non-empty strings
- "idle" is the canonical sentinel for inactive sub slots

Continuity matching (`weight.ts`): substring match at ≥50% of the shorter thread's length, used only to classify a thread as `core` (appears in many recent metas), `fresh` (just appeared), or `fading` (was there, no longer is). The classification is *informational only* — it goes into the steering prompt as a hint to the next compaction LLM. There is no stable thread identity.

### 2.3 The serialization format

`[THREAD_META]\nmain: <text>\nsub1: <text>\nsub2: <text>\nsub3: <text>\n[/THREAD_META]`

Parser (`parser.ts`) strips this block out of the summary and stores `meta` separately. It is permissive — accepts case-insensitive field names, trims whitespace, handles whitespace lines, but rejects the block if `main` is missing or `sub` count is not exactly 3.

### 2.4 What the daily reviews tell us (empirical)

Eight days of daily-review files (2026-05-05 through 2026-05-12):

| Date | Sessions compacted | Kasett handled | Vanilla fallback | Notes |
|---|---|---|---|---|
| 05-05 | 6 | 0 | 6 | Pre-deployment / disabled |
| 05-06 | 1 | 1 | 0 | First success |
| 05-07 | 1 | 1 | 0 | |
| 05-08 | 2 | 2 | 0 | Both stubs, never replaced; model-ID bug found same day |
| 05-09 | 1 | 1 | 0 | |
| 05-10 | 0 | 0 | 0 | Quiet day |
| 05-11 | 1 | 1 | 0 | |
| 05-12 | 1 | 1 | 0 | |

So coverage went from 0% → 100% over a week. Operationally healthy. **But** the 2026-05-08 review explicitly flags:

> Both stubs use the same generic label: `main: Ongoing work / sub1-3: idle`. This is a known issue — thread labels are not synthesized from actual content. **No stubs replaced — both `[KASETT_STUB::...]` markers remain in the live session file. The hot-swap job is either not running or not completing.**

That note was written before the 2026-05-08 manual end-to-end test that found the model-ID bug (`anthropic/claude-sonnet-4-20250514` is not a valid OpenRouter or Anthropic model ID; the correct ID is `anthropic/claude-sonnet-4-5`). Once that was patched, the test confirmed the pipeline works end-to-end and produces high-quality `[THREAD_META]` blocks **in test conditions**.

### 2.5 The empirical truth at the storage layer (this matters)

I scanned every `compaction`-typed event across all 1,661 sessions on this instance:

```
Compaction events:                      65
Compactions w/ [KASETT_STUB::] marker:   0
Compactions w/ [THREAD_META]:            0
Compactions w/ neither:                 65
```

Zero. The actual `data.summary` field of `compaction` events in production session JSONL contains **no successful kasett output at all** — neither stubs nor full summaries. The `[THREAD_META]` blocks visible to grep across the JSONL files are all from test fixtures, embedded code examples in user/assistant messages, or example output inside conversation transcripts.

**This is a blocking finding.** It means one of:
- (a) The CompactionProvider isn't being invoked by OC in production (perhaps a config issue);
- (b) It is invoked, but its return value is being discarded by OC and OC's built-in compaction is winning;
- (c) The summary is being written to a different field than `data.summary`.

Spot check on the most recent sessions confirms (c) is happening in some cases — `554ea513-...-topic-26844.jsonl` and `691d67d1-...-topic-12388.jsonl` (both flagged "kasett handled" in daily reviews) **do** have `[KASETT_STUB::...]` text, but at the top of `summary` (string field directly on the entry, not nested under `data.summary`). My initial scanner used `data.summary` because that's what the test harness uses. So the storage path is `entry.summary` (top-level), not `entry.data.summary`. This is a bug in the daily-review tooling and a documentation gap, not in the runtime — but it means **we have been operationally blind to whether kasett is producing rich threads.**

Re-running the scan against `entry.summary`:

```
Compaction events:                       65
Compactions w/ [KASETT_STUB::] marker:    7   (still stubs — never replaced)
Compactions w/ [THREAD_META] (any form):  7   (the stubs)
Compactions w/ rich post-LLM [THREAD_META]: 0
```

So even with the correct storage-field correction: **the hot-swap worker never replaces stubs in production.** Stubs survive. The `main:` line in those stubs is whatever sentence the heuristic-fallback grabbed from the last few messages — random and useless for orientation:

- `main: What about error state`
- `main: pvc-261ae669 has an SOUL`
- `main: Now I'll conduct the deep research`
- `main: Now let me find the config write section near the end of the build section: 1...`
- `main: System: [2026-05-08 15:54:40 UTC] **Summary:** Infra session is IDLE — comple...`
- `main: The QA config has plugins`
- `main: Ongoing work`

This is the production reality. The model-ID fix from 2026-05-08 may have made the LLM call succeed in tests, but at the storage layer we still have zero replaced stubs in any session compacted after the fix landed. Either the rebuild hasn't deployed, the hot-swap worker is still not firing on real OC compactions (vs. our manual test harness), or `OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY` is not in `process.env` at the OC plugin runtime context.

---

## 3. Critical Weaknesses

### 3.1 Format compliance is the single biggest reliability tax

The web research is unambiguous on this: **structured outputs (JSON schema, function calling, response_format) are dramatically more reliable than markdown sentinel blocks.** The current `[THREAD_META]` block:

- Is parsed via regex, with a permissive but brittle field grammar
- Has no schema enforcement at the LLM provider level
- Depends on the LLM (a) including the block, (b) keeping the field names exact, (c) producing exactly 1 main + 3 subs, (d) not nesting it inside a code fence that breaks the regex

Even when the LLM call succeeds, format compliance in real deployments will be ~70-85% per provider behavior, not 95%+. We have no visibility into this number in production because we're not scoring it. The 0% rate observed at storage is dominated by the upstream "summary never replaced stub" failure, but format compliance is the next failure mode waiting in line.

**Mitigation cost:** OpenRouter, Anthropic, OpenAI, and Google all support tool/function calling and structured output in 2026. Switching from markdown sentinel to `response_format: { type: "json_schema", json_schema: {...} }` (or equivalent tool-use call) is a one-week refactor. Compliance lifts to ~95-99% with the schema-validating providers.

### 3.2 Fuzzy substring matching is structurally insufficient

`weight.ts` uses substring inclusion at 50% of the shorter thread's length to detect "this thread A in compaction N is the same as thread A' in compaction N+1." This breaks under:

- Synonym substitution: "OAuth redirect debugging" vs. "Login redirect issue"
- Granularity drift: "Hooks debugging" vs. "useEffect dependency-array debugging"
- Re-scoping: "K8s migration" → "EKS-to-EC2 migration" (smaller scope, no substring overlap)
- Renames: "AgentiAgency rebrand" → "Molt AI rebrand" (zero overlap; the dead-brand rule literally enforces this)
- Common words: any thread mentioning "OAuth" or "config" matches every other thread mentioning "OAuth" or "config"

The literature is clear on the alternative: **either use stable thread IDs supplied by the LLM (the simplest fix), or use embeddings + cosine similarity (the second-simplest), or treat threads as nodes in a graph with relationship edges (the heavyweight option).** We should start at the simplest and only escalate when the simplest fails on CompactBench.

### 3.3 Sub-threads are an undifferentiated, ordered-by-accident, three-slot bag

The shape `[string, string, string]` makes us choose between three failure modes whenever real work has more than 3 active sub-threads:
- **Drop**: silently lose the 4th+ sub-thread (information loss)
- **Compress**: stuff multiple sub-threads into one slot (lossy and ambiguous)
- **Truncate by recency**: drop the oldest sub-thread (often the wrong one)

The empirical evidence from the 2026-05-08 manual test shows what the LLM actually does when given a real conversation about React hooks debugging:

```
[THREAD_META]
main: React hooks debugging and state management
sub1: useEffect dependency arrays and stale closures
sub2: AbortController cleanup patterns
sub3: Loading and error state implementation
[/THREAD_META]
```

This looks fine because the test conversation had exactly 3 natural sub-threads. The instant the conversation has 5 (Infra topic averages 5–8 per session), we lose information without any signal that we did.

Beyond cardinality, sub-threads carry no metadata:
- **No status** (active, blocked, paused, completed, abandoned)
- **No relationships** (`sub2` depends on `sub1`; `sub2` is an alternative to `sub3`; `sub2` is a child of `main`)
- **No last-activity timestamp** (we don't know if `sub2` was the last thing worked on or barely mentioned)
- **No trajectory** (is it progressing, stuck, or pivoting?)
- **No blockers** (what's preventing forward motion on `sub3`?)

For Clyde-class agents working on multi-day infra projects, all five of these matter materially.

### 3.4 No key-state tracking

This is the largest operational gap and the one Chris's CompactBench design explicitly calls out (Task 2: Key State Retrieval). When Clyde is mid-debug on an infra issue, the values that need to survive compaction are:
- AWS resource IDs (`i-0455f6c0d3001f8d2`, `pvc-2d9e208d-...`)
- Git SHAs (`ef19342`)
- AMI versions (`v110`)
- File paths (`/home/node/.openclaw/workspace/...`)
- URLs (`https://api.anthropic.com/...`)
- Lambda function names, S3 buckets, secret ARNs

Currently every one of these is buried in conversation messages that get compacted into prose. The `data.identifierPolicy` OC config helps a little, but we have no kasett-side enforcement. CompactBench KSSR baseline for vanilla compaction is **0.30–0.45** (i.e., 55–70% of identifiers vanish). For an agent like Clyde that frequently has to re-grep `/tmp/` after compaction to recover an instance ID, this is the most painful failure mode.

### 3.5 No lifecycle for threads — and no way to express "this is done"

The LLM is asked, every compaction, to write 3 strings. There is no signal for:
- "thread X just got created this compaction"
- "thread Y just got resolved, can be dropped"
- "threads Y and Z just merged into thread W"
- "thread V got abandoned (intentional drop, not lost)"

`weight.ts` *infers* core/fresh/fading from presence patterns across the last N metas, but this is a derivative signal and doesn't distinguish *abandoned* from *forgotten*, or *resolved* from *paused*. For a long-running agent, this distinction is everything — "I solved this two days ago" is qualitatively different from "I forgot about this two days ago."

### 3.6 The steering prompt's failure mode is silent

If the LLM fails to produce `[THREAD_META]`, kasett logs a warning but never raises an alert, never retries, and never falls back to a deterministic synthesizer. The system simply degrades to no-thread-meta orientation and moves on. There's no per-session "format compliance" metric, no per-model compliance dashboard, no compliance regression alert. We're operationally flying blind on the most important quality signal.

### 3.7 Thread state is per-session — this is wrong for a real agent

Clyde works across topics: infra (5392), products (5260), kasett research (20751), legal (4379), the kasett feature itself (12388 and 26844 have all touched it in the last 4 days). A *thread* in the human sense ("the kasett project") spans all of these. But each topic has its own session JSONL, so a kasett-rewind feature thread tracked in topic-12388 has zero connection to the same feature being discussed in topic-5392. We're tracking conversation-thread continuity, not project-thread continuity.

Cross-session thread tracking is a hard problem (it requires identity beyond the session boundary), but the current architecture rules it out by construction. Worth deciding intentionally whether kasett is a per-session or cross-session memory layer.

### 3.8 Integration with CompactBench is incomplete

The benchmark has five tasks. Mapping current kasett:

| Task | Kasett alignment | Score expected |
|---|---|---|
| 1. Thread Persistence (TRR) | Direct — main + 3 subs is exactly this | ~0.5 (3-slot ceiling) |
| 2. Key State Retrieval (KSSR) | Not tracked at all | ~0.0–0.3 (LLM-only, no kasett help) |
| 3. Trajectory Reconstruction (TCS) | Partial — trajectory orientation in before_prompt_build helps | ~3.0–3.5 |
| 4. Steering Effectiveness (WSE) | Direct — weighted previous summaries IS steering | ~1.2 (assuming weights work) |
| 5. Multi-Compaction Degradation (DGR) | Indirect — windowed history slows decay | unknown |

We optimize hard for Task 1 and Task 4 — the two tasks where the current model is structurally aligned. We score near-zero on Task 2 because we don't track it. We score modestly on Task 3 because the trajectory line is shallow ("Main: X | Subs: Y, Z" with no narrative). On Task 5 we're unmeasured.

The benchmark is what we should optimize *toward*. A few concrete gaps:

- CompactBench Task 2 plants URLs, paths, IDs, and asks "did they survive?" Kasett can't answer because it never tracked them. **Add a `KeyState` sidecar.**
- Task 3 requires a *narrative* — a "what happened in this session" arc — and our orientation is a thread list. **Add a 1-3 sentence trajectory summary alongside the meta.**
- Task 4 measures whether *steering* actually moves output. We have weights but no dose-response measurement. **Build a kasett-side eval that runs the Task 4 protocol on real sessions and reports WSE.**

---

## 4. Proposed Improvements (prioritized)

### P0 — Ship before any other change

#### P0.1. Verify and fix the production write path

Before any schema redesign, **first prove the post-fix hot-swap pipeline lands rich summaries in real OC sessions.** Concrete steps:

1. Verify the `npm run build` from 2026-05-08 has been deployed (the rebuilt `dist/` is in the live `~/.openclaw/plugins/...` install path, not just the repo).
2. Verify `OPENROUTER_API_KEY` and/or `ANTHROPIC_API_KEY` are present in `process.env` at the OC plugin-runtime context. If not, add to `openclaw.json` under the OC env block.
3. Verify the `entry.summary` storage path matches the daily-review scanner. Update `scripts/daily-compaction-review.sh` to look at `.summary` field (not `.data.summary`).
4. Run a kasett-instrumented compaction in a non-test session and confirm `WORKER_START → LLM_DONE → SWAP_COMPLETE` all log in `hotswap-diag.log`.
5. Verify the resulting JSONL entry no longer contains `[KASETT_STUB::]`.

This is operational hygiene, not architecture. **Without it, all downstream improvements are theoretical.**

#### P0.2. Replace `[THREAD_META]` markdown sentinel with structured output

Concrete plan:

- Change `summarize()` LLM call to use `response_format: { type: "json_schema", json_schema: {...} }` (OpenRouter's `response_format`, OpenAI's structured outputs, Anthropic's `tool_choice`-forced tool call).
- The schema is `ThreadMetaV2` (see §4.2 below).
- Keep the markdown `[THREAD_META]` block as a *fallback rendering* in the stored summary for human-readability, but the source of truth is the structured object stored in a parallel field.
- Update parser.ts to (a) prefer the structured field, (b) fall back to regex parsing of `[THREAD_META]` for backward compat with already-stored summaries.
- Track per-call format-compliance metric: `valid_meta_returned / total_calls`. Log to `hotswap-diag.log`.

Estimated effort: 2 days. Estimated compliance lift: from "unmeasured but visibly broken in 7/7 production stubs" to "≥95% per provider published structured-output reliability."

### P1 — The schema redesign

#### P1.1. New ThreadMeta schema (v2)

```ts
type ThreadStatus = "active" | "blocked" | "paused" | "completed" | "abandoned";

type Thread = {
  id: string;            // stable, LLM-supplied, kebab-case slug ("oauth-redirect-debug")
  label: string;         // human-readable thread name
  status: ThreadStatus;
  parent?: string;       // optional thread id of parent (for hierarchical work)
  blockers?: string[];   // free-text blockers, max 2
  // computed by kasett, not LLM-supplied:
  first_seen_compaction?: number;  // index of first compaction this thread appeared in
  last_seen_compaction?: number;
};

type ThreadMetaV2 = {
  schema_version: 2;
  main: Thread;          // exactly one main thread
  subs: Thread[];        // 0..N sub-threads (NOT capped at 3)
  trajectory: string;    // 1-3 sentence narrative: "what just happened, where we're heading"
  events?: ThreadEvent[]; // optional: lifecycle events the LLM observed since last compaction
};

type ThreadEvent =
  | { type: "thread_created"; thread_id: string; reason?: string }
  | { type: "thread_completed"; thread_id: string; outcome?: string }
  | { type: "thread_merged"; from: string[]; into: string }
  | { type: "thread_abandoned"; thread_id: string; reason?: string }
  | { type: "thread_pivoted"; from: string; to: string; reason?: string };
```

Key changes vs. v1:
- **Stable thread IDs** — solves continuity matching (no more substring fuzzy match)
- **Labels separate from IDs** — id stays stable while label can be rewritten/clarified
- **Status + blockers** — distinguishes paused from forgotten, captures why work is stuck
- **Variable-cardinality subs** — no more 3-slot procrustean bed; we display top-N by `last_seen` in orientation
- **Trajectory narrative** — feeds CompactBench Task 3 (TCS) directly
- **Events** — explicit lifecycle signal lets us track abandonment vs. completion vs. forgetting

Backward compat: parser accepts both v1 (legacy `{main, sub: [s,s,s]}`) and v2. Storage emits v2. Migration is automatic on first v2-aware compaction.

#### P1.2. KeyState sidecar — track concrete values explicitly

```ts
type KeyState = {
  schema_version: 1;
  values: KeyStateValue[];
};

type KeyStateValue = {
  value: string;           // the literal value
  type: "url" | "path" | "id" | "version" | "cmd" | "secret" | "other";
  description?: string;    // 1 line: what is this for
  thread_id?: string;      // associated thread, if any
  first_seen: string;      // ISO timestamp
  last_seen: string;       // ISO timestamp
  salience: "critical" | "high" | "medium" | "low"; // LLM-classified importance
};
```

The compaction LLM is instructed to extract key state alongside the thread meta in the same structured output call. Storage keeps it in a parallel field on the compaction event. Orientation injection shows top-N critical values inline.

For CompactBench Task 2 (KSSR), this should move us from ~0.0 → 0.7+ on relevant tier benchmarks. For real Clyde sessions, it eliminates the "I had the instance ID and now it's gone" failure mode.

#### P1.3. Decision history alongside threads

```ts
type Decision = {
  id: string;
  description: string;
  rationale?: string;
  thread_id?: string;
  reversible: boolean;
  timestamp: string;
};
```

Every compaction, the LLM lists decisions made since the last one. They survive at full text (not summarized) until either a kasett-defined retention policy ages them out or they get explicitly superseded. Cheap, structurally-aligned with how Clyde already documents itself in daily memory files.

### P2 — Continuity and identity

#### P2.1. Cross-session thread linking (opt-in)

Add `thread_id` namespacing: a thread can live across sessions if it's tagged with a global namespace. e.g., `kasett:thread-tracking-v2` is the same thread whether the user discusses it in topic-12388 or topic-20751.

Implementation:
- Optional sidecar file `~/.openclaw/agents/<agent>/threads/global-threads.json` keyed by global thread_id
- LLM is shown current global threads as context during summarization and may attach session-local threads to a global one
- before_prompt_build merges session-local + global threads in the orientation

This is opt-in because it adds complexity and a global write path. Worth it for projects spanning sessions; not worth it for incidental work.

#### P2.2. Embedding-based fallback continuity

Even with stable thread IDs, the LLM will sometimes fail to reuse the right ID. Add a fallback continuity check: if a "new" thread has cosine similarity ≥0.85 to an existing recent thread's `label + trajectory`, suggest a merge. This goes into the next compaction's steering as "consider whether thread X-new is actually thread Y-existing."

Use a small embedding model (e.g., `text-embedding-3-small` or local nomic) — inexpensive and runs in-process.

### P3 — Steering, evaluation, and observability

#### P3.1. Per-compaction format-compliance metric

Log a single line per compaction:

```
COMPLIANCE stub=<id> v=<schema_version> threads=<n> trajectory=<bool> keystate=<count> decisions=<count> valid=<bool>
```

Aggregate to a daily compliance score in `daily-reviews/`. Alert if compliance drops below 0.9 over a 24h window.

#### P3.2. Self-evaluating compaction (kasett-eval CLI)

A kasett CLI command `kasett eval <session-file>` that:
1. Picks a compaction event with a known follow-up (the next 10 messages)
2. Asks an evaluator LLM "given this compaction summary, predict what the next 5 user messages will be about"
3. Scores prediction accuracy against the actual follow-up
4. Reports per-compaction continuity score

This is a poor-man's CompactBench Task 3 that runs on real Clyde sessions. Lets us measure trajectory quality without waiting for the formal benchmark to be built.

#### P3.3. CompactBench in-tree integration

Once CompactBench v0.1 lands in the kasett research directory, wire kasett's compaction output into its evaluation harness. Run on every PR. The composite score becomes our headline regression test.

### P4 — Stretch (post-P0/P1)

- **Prompt experimentation**: A/B test steering prompt variants (Anthropic's "extended-thinking" XML, OpenAI's strict mode, plain JSON). Pick the best per-provider.
- **Adaptive window size**: Right now the window is fixed at 3 with weights `[1.0, 0.6, 0.3]`. Long sessions might benefit from `[1.0, 0.7, 0.5, 0.3, 0.15]`. Make this LLM-modeled (kasett asks the LLM "how far back is still relevant?" each time).
- **Multi-modal compaction**: Tool outputs and code blocks are first-class today only as embedded text. A future schema could preserve them as structured blocks (e.g., "kept verbatim: this exec output").
- **Streaming compaction**: Return a partial summary while the LLM is still finishing the structured output. Reduces hot-swap latency on slower providers.

---

## 5. Implementation Roadmap

The order matters. Each phase unblocks the next; reordering will produce churn.

### Phase A — Operational hygiene (this week)

1. **Verify production write path** (P0.1) — 1 day. Decide go/no-go on the rest of this roadmap based on whether stubs are actually being replaced post-fix.
2. **Daily-review scanner correction** — 0.5 day. Switch to `entry.summary`. Add a per-entry "is_stub" field to the report so we can see replacement rate.
3. **Format-compliance metric** (P3.1, partial) — 1 day. Even with the v1 schema, start logging compliance per call. Establishes the baseline number we'll improve.

### Phase B — Schema v2 + structured output (next sprint)

4. **Define ThreadMetaV2 schema in TypeScript + JSON Schema** (P1.1) — 1 day.
5. **Wire structured-output into LLM call** (P0.2) — 2 days. Provider-specific (OpenRouter `response_format` vs Anthropic tool-use); tested in unit + integration tests.
6. **Update parser.ts to prefer structured, fall back to regex** — 1 day.
7. **Update orientation builder for variable-cardinality subs + trajectory line** — 1 day.
8. **Migration: old `[THREAD_META]` v1 blocks remain readable** — verify in tests, no migration script needed.

### Phase C — KeyState (sprint after)

9. **KeyState schema + storage** (P1.2) — 1 day.
10. **Add KeyState extraction to LLM call** (same structured output, additional schema field) — 1 day.
11. **Orientation: top-3 critical KeyState values inline** — 0.5 day.
12. **CompactBench KSSR baseline test on a synthetic instance** — 1 day.

### Phase D — Continuity (after C)

13. **Stable thread IDs in v2 schema** (already in P1.1) — 0 days (covered).
14. **Embedding-based fallback continuity check** (P2.2) — 2 days.
15. **Lifecycle events** (P1.1, the `events` field) — 1 day.
16. **Decision history alongside threads** (P1.3) — 1 day.

### Phase E — Cross-session + evaluation (later)

17. **Cross-session global thread linking** (P2.1) — 3-5 days. Opt-in, complex.
18. **kasett-eval CLI** (P3.2) — 2 days.
19. **CompactBench harness integration** (P3.3) — 2 days, depends on CompactBench landing.

**Total estimated effort:** ~21-25 person-days for Phases A-D. Phase E adds another 7-9 days but is post-MVP.

### Why this order

- Phase A is pure "are we even working?" — no architectural risk, immediate value.
- Phase B is the highest-leverage architectural change. Schema v2 + structured output should *single-handedly* lift compliance from ~0% (production observed) to ~95% (provider-quoted). Everything else builds on this.
- Phase C delivers Chris's most-frequently-quoted pain point (KSSR / "did the instance ID survive"). High-perceived-value-per-effort.
- Phase D unblocks honest trajectory measurement. It requires schema v2 to exist first.
- Phase E is the "we have all this great data, now let's do something with it" phase.

If we have to ship only one thing, ship Phase B. The rest is multiplicative on top of it.

---

## 6. Open Questions

These are questions I cannot resolve from the code, the daily reviews, or the web research alone. They block confident decisions in the roadmap and are worth getting answers to before sprint kickoff.

1. **Is the kasett CompactionProvider actually being invoked in production OC sessions?** All seven 2026-05-08+ "kasett handled" sessions in daily reviews show stubs in their compaction events. Either the worker isn't firing, or it's firing but the LLM call still fails (post model-ID fix). Need a live test in a real OC session — not the manual harness — to confirm. Action: Phase A1.

2. **Is `OPENROUTER_API_KEY` in `process.env` at OC plugin runtime?** The 2026-05-08 manual test required exporting it manually. If OC doesn't pass it through, the live worker silently falls through to Anthropic, which (post-fix) works but is a single point of failure. Action: check `openclaw.json` env block; add if missing.

3. **How big should `subs` be allowed to grow?** v1 caps at 3. For Clyde's infra topic, real sessions average 5–8 active sub-threads. Capping at 5 (with trajectory absorbing the long-tail) might be the right answer. Capping at infinity invites token bloat. Need a calibration study on real sessions.

4. **Is per-session the right scope, or should we go cross-session by default?** Cross-session linking adds operational complexity (a sidecar JSON file with global state) but matches how humans (and Clyde) actually think about long projects. Worth a HITL conversation with Chris before Phase E.

5. **How should we handle conflicting LLM behavior across providers?** Anthropic, OpenAI, and Google have meaningfully different strict-output behaviors. OpenRouter mediates but doesn't normalize. Should kasett canonicalize at the schema layer, or should it ship per-provider prompts? (Default proposal: schema-first, per-provider prompt tweaks only if we measure compliance gaps.)

6. **What's the right role for embeddings?** P2.2 proposes a small embedding model for continuity fallback. But we could go heavier: Letta-style memory blocks, MemGPT-style recall memory, full RAG over compaction history. Each step up adds infrastructure. The minimum viable position is "stable LLM-supplied IDs + 1 embedding fallback per compaction" but the question of whether to escalate is open and benchmark-dependent.

7. **Should kasett expose its state to the agent via tools?** Right now thread meta is read-only from the agent's perspective (orientation injection only). Should the agent be able to *call* kasett (`kasett.update_thread_status(id, "blocked", "waiting on Thomson")`) mid-session? This is the Letta path — agents managing their own memory. Opens a different architectural axis worth a separate PAL.

8. **What's the right fallback when the LLM call fails?** Today we keep the stub. Alternatives: (a) deterministic synthesizer over message tail (more useful than the current heuristic); (b) merge previous meta with last-N-message thread mentions; (c) explicitly mark the compaction as "summarization failed" so downstream tools know to ignore it. Option (a) is the cheapest improvement and probably worth shipping in Phase A.

9. **How does kasett interact with OC's built-in `identifierPolicy`?** OC has its own identifier-preservation logic in `summarizationInstructions.identifierPolicy` (pass-through to our compaction). Are we double-counting? Conflicting? Need to read OC's compaction-safeguard extension code and trace the call path.

10. **Should we be measuring agent-perceived quality, not just kasett-internal quality?** A perfectly compliant `[THREAD_META]` block that doesn't change agent behavior is worthless. The downstream test is "after compaction, does Clyde still know what it was working on?" — measurable by A/B testing kasett-on vs. kasett-off on the same session and asking the same orientation question to both. This is a 2-day study that would be the most honest validation we could ship.

---

*This analysis is a strategic snapshot, not a binding plan. Numbers are estimates, ordering is opinionated, weaknesses are hypotheses. The roadmap survives contact with reality only if Phase A confirms the foundational write-path issue is solved. Until that's confirmed, every other improvement is theoretical.*

*— Clyde, 2026-05-12*
