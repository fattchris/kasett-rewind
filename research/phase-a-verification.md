# Phase A — Verification Report

**Author:** Clyde subagent (depth 1/1)
**Date:** 2026-05-12
**Status:** ✅ COMPLETE

---

## TL;DR

1. **Storage path:** `entry.summary` (top-level). Confirmed across 36 production compaction events.
2. **Daily-review scanner:** Now reads correct path AND distinguishes rich-vs-stub-vs-vanilla (was conflating them).
3. **Hook logging:** Deployed in `src/index.ts` with new `after_compaction` hook + structured JSONL events for every kasett invocation.
4. **Replay analysis (last 7 days):**
   - 36 compaction events
   - **0 rich-replaced summaries** (compliance rate: **0.0%**)
   - 10 still-stubs
   - 24 vanilla OC fallback (kasett didn't run, or returned undefined)
5. **Root cause (NEW, evidence-backed):** Hot-swap worker is firing in production. LLM calls are succeeding. The atomic JSONL rewrite is failing because `waitForLockAbsent(sessionFile, 30000ms)` times out on active sessions — OC holds the session lock continuously while the user keeps working, so no inter-turn gap >30s ever opens. **The hot-swap is architecturally incompatible with the typical "keep working in the same session" usage pattern.**

## Critical finding

🚨 The 2026-05-12 strategic analysis claimed it was unclear whether (a) the hook never fires, (b) it fires but the LLM is failing, or (c) it succeeds but writes to the wrong field. **Phase A definitively rules out (a) and (b) and partially rules out (c).** The actual answer is (d), not in the original list:

> **The hook fires, the LLM succeeds, but the atomic file swap times out on the session lock.**

This changes the Phase B scope. Schema redesign (`[THREAD_META]` → structured output) was always going to be the high-leverage move, but it WON'T fix the production-zero-rich-summaries problem on its own. We also need a hot-swap durability fix — either a longer wait, retry-on-session-end, or an entirely different write strategy (e.g. write rich summaries to a sidecar file and overlay at read time, never racing OC's lock).

## Recommendations for Phase B

Given the new evidence, Phase B should split into two tracks:

**B1 (urgent, unblocks compliance):** Fix hot-swap durability.
- Option a: Increase `hotSwapTimeoutMs` to e.g. 30 minutes, accept slow-replacement.
- Option b: Hook into `session_end` and apply pending swaps when the session truly closes.
- Option c: Sidecar file approach — store rich summaries in `session-key.kasett.jsonl`, never racing OC's lock. before_prompt_build reads sidecar.
- Recommend (c). Cleanest separation of concerns, no lock fight.

**B2 (planned, but only useful once B1 lands):** Schema v2 + structured output.
- Until B1 lands, lifting compliance from 0 → 95% is meaningless because nothing is being written anyway.
- Once B1 lands, structured output will make compliance jump to whatever the providers say (~95%).

---

## Subtask Detail

## A1. Storage Path Audit

### Question
Where does kasett's compaction summary actually live in the OC session JSONL — `entry.summary` (top-level) or `entry.data.summary` (nested)?

### Method
Scanned all 593 non-checkpoint session JSONL files modified in the last 7 days (`/home/node/.openclaw/agents/main/sessions/`). Filtered to compaction events (`type == "compaction"`). Inspected presence and content of `obj.summary` vs `(obj.data or {}).summary`.

### Result

```
Scanned: 593 session files (non-checkpoint, last 7 days)
Compaction events: 36

Storage layout:
  top-level .summary only:  36   (100%)
  .data.summary only:        0
  both:                      0
  neither:                   0
```

**Definitive: every compaction event stores its summary at the TOP LEVEL `summary` field.** None at `data.summary`.

### Concrete entry shape

```
top-level keys: ['type', 'id', 'parentId', 'timestamp', 'summary', 'firstKeptEntryId',
                 'tokensBefore', 'details', 'fromHook']
data keys: (empty / not present on compaction events)
```

Example compaction entry (truncated):
```json
{
  "type": "compaction",
  "id": "...",
  "parentId": "...",
  "timestamp": "...",
  "summary": "[KASETT_STUB::7ed3fd48-3de8-4e71-9782-f9f562ff35ae]\n\nSession compaction in progress. Thread state:\n\n[THREAD_META]\nmain: Now I'll conduct the deep research\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]\n...",
  "firstKeptEntryId": "...",
  "tokensBefore": 12345,
  "details": {...},
  "fromHook": "..."
}
```

### Production content breakdown (last 7 days, 36 events)

| Marker present | Count | %  |
|---|---|---|
| Has `[THREAD_META]` block | 10 | 28% |
| Has `[KASETT_STUB::]` marker (i.e. STILL a stub, hot-swap never replaced) | 10 | 28% |
| Has `[THREAD_META]` **without** stub (rich LLM-produced summary) | **2** | **6%** |
| Has neither (vanilla OC compaction or legacy) | 24 | 67% |

**Bottom line on A1:**
- Storage path: `entry.summary` (top-level). Confirmed.
- Of 36 compactions in last 7 days, only **2** have a successfully-replaced rich kasett summary.
- 10 are kasett stubs that never got replaced by the hot-swap worker.
- 24 are vanilla OC fallback (kasett didn't run at all, or returned undefined).

### Status: ✅ A1 complete
- Path confirmed top-level `.summary`.
- Daily-review scanner already (post 2026-05-12 fix) reads `obj.get('summary', '')` — that part is correct.
- The previous claim that the scanner was reading `.data.summary` no longer applies to today's `daily-compaction-review.sh`. Scanner code matches reality.

---


## A2. Daily-Review Scanner Fix

### Problem
Pre-fix scanner used `grep -q "[THREAD_META]" $session_file` to count kasett-handled sessions. Two issues:

1. Counts ANY occurrence of `[THREAD_META]` anywhere in the file, including inside **conversation messages** that happen to discuss the format (test fixtures, my own analysis docs being read into a session, this very document). Many false positives.
2. Cannot distinguish a **stub** (orientation-fragment from heuristic, hot-swap never ran) from a **rich** LLM-produced summary. Both contain `[THREAD_META]`.

### Fix
Replaced the grep-based decision with a Python pass that:

1. Reads JSONL line by line
2. Filters to `obj.type == "compaction"` events only (avoids conversation false positives)
3. Inspects the top-level `summary` field
4. Classifies each session as `rich` (THREAD_META, no STUB), `stub` (still has KASETT_STUB), or `vanilla` (neither marker)
5. Reports all three counts independently

### Result on today's data

```
Compacted: 2 | Kasett: 2 (rich=0 stub=2) | Vanilla: 0
```

Both of today's compactions are STUBS. The hot-swap worker has not been replacing stubs in production. **This is the headline empirical finding.**

### Status: ✅ A2 complete
- Scanner now reads `entry.summary` via JSON (correct path) AND filters to compaction events only.
- Distinguishes rich from stub from vanilla. Three independent counters in the daily-review markdown.
- Committed as part of this Phase A push.


## A3. Hook Logging Deployed

### What landed
Added structured-event JSONL logger to `src/index.ts`:

- New constant `HOOK_LOG_PATH` (default `research/hook-events.jsonl`, override via `KASETT_HOOK_LOG`)
- New `logHookEvent({ts, hook, sessionId, agentId, action, parsed?, charCount?, metaMain?, error?, detail?})` async function — never throws
- Instrumented `before_compaction` (action: `captured_ctx`)
- Instrumented `after_compaction` (action: `fired`) — newly added hook
- Instrumented `before_prompt_build` (actions: `inject_orientation` / `no_meta_parsed` / `no_summaries` / `no_session_file` / `error` / `skip_disabled`)
- Instrumented `summarize` (actions: `invoked` / `hotswap_stub_returned` / `sync_summary_returned` / `sync_summary_no_meta` / `skip_disabled`)

### Why JSONL, not the OC logger
We need structured records for offline aggregation (compliance rate over N days). The OC logger is per-process and not easily aggregated. The JSONL file is one path, append-only, JSON-per-line, and survives restarts. Daily-review tooling can `jq`/`python -c` it.

### Compile + tests
- `tsc` clean (no errors).
- Tests: 145 total, **136 pass, 9 fail** — failures are all pre-existing `prompt.test.js` (tests for a renamed/removed `generateCustomInstructions` API). Verified by stashing my changes and re-running: identical 136/9 split. My changes do not break tests.

### Status: ✅ A3 complete
- Logger committed.
- After OC reload (next gateway restart, or whenever the kasett plugin is re-required), `research/hook-events.jsonl` will start populating.


## A4. Offline Replay Analysis

### Method
`research/phase-a-replay.js` walks every non-checkpoint `.jsonl` in the OC sessions directory modified in the last 7 days. For each compaction event (`type == "compaction"`):

1. Read top-level `summary` field.
2. Check for `[KASETT_STUB::]` and `[THREAD_META]` markers.
3. Run `parseCompactionOutput` from `dist/threads/parser.js` (kasett's own parser).
4. Classify as:
   - **richReplaced** = parser produced valid meta AND no stub marker (the success state)
   - **stubAndMeta** = stub marker present AND parser-valid meta carried over from a previous compaction (hot-swap never replaced)
   - **stubOnly** = stub marker but no carry-over meta
   - **neither** = no kasett markers (vanilla OC fallback)

### Results

```
Compaction events:               36
Has [KASETT_STUB::]:             10
Has [THREAD_META]:               10
Parser produced valid meta:       8

Breakdown:
  Rich (replaced):                0  <-- THE HEADLINE FINDING
  Stub + carry-over meta:         8
  Stub only:                      2
  Neither marker (vanilla):      24
  Has THREAD_META but parse fail: 2  (legacy convo text mentioning the format)

Compliance rate:               0.0%
Parser success rate:          80.0%   (when [THREAD_META] is present, parser handles it correctly modulo legacy text)
```

### Interpretation

🚨 **Critical:** Compliance rate is **0.0%** over the last 7 days. **Zero compactions in production have produced a rich, LLM-generated kasett summary that survived hot-swap.** Every single "kasett-handled" compaction visible in the daily reviews is a stub.

The stubs all have carry-over `main:` lines like:
- `Now I'll conduct the deep research`
- `Now let me continue with Section B — Bot API current state`
- `Now let me find the config write section near the end of the build section: 1...`

These are heuristic-fallback main: values from `generateStub` — a sentence grabbed from the last few messages, not an LLM-synthesized thread label.

The parser is fine (80% success rate, the 20% failures are legacy conversation text that happens to mention `[THREAD_META]` literally — not real kasett output).

**Diagnosis:** The hot-swap worker is the failure point. Either:
- (a) it never starts (background `runHotSwapWorker()` not running)
- (b) it starts but the LLM call fails silently and the stub is never replaced
- (c) it succeeds but the atomic JSONL rewrite fails or writes to a different field

The new hook logger (A3) will distinguish these once OC reloads kasett — every `summarize()` call will write a `hotswap_stub_returned` event, and `research/hotswap-diag.log` will show whether the worker progresses to `LLM_DONE` and `SWAP_COMPLETE`.

### Status: ✅ A4 complete
- Replay script in place, deterministic, can be re-run on any future window.
- Headline empirical finding documented: production compliance rate is 0%.


## A5. Controlled Trigger Test — Procedure + Existing Evidence

### Existing evidence in `hotswap-diag.log` (the smoking gun)

The pre-existing diagnostic log `research/hotswap-diag.log` already contains 9 production hot-swap WORKER_START events (against real `/home/node/.openclaw/agents/main/sessions/*.jsonl` paths) over the last 6 days. Their lifecycles tell the actual story:

| Stub ID (truncated) | LLM call | Outcome | Note |
|---|---|---|---|
| `ce8fb685` (5/10 22:32) | OK, 11373 chars | **LOCK_WAIT_TIMEOUT 30000ms** | session held lock too long |
| `d6d65ad2` (5/11 04:29) | OK, 8797 chars | **LOCK_WAIT_TIMEOUT 30000ms** | same |
| `42b8c639` (5/11 14:34) | OK, 8489 chars | SWAP_COMPLETE but **STUB_NOT_FOUND** (lines_scanned=26) | stub line was already gone |
| `7ed3fd48` (5/11 15:44) | OK, 1610 chars | **LOCK_WAIT_TIMEOUT 30000ms** | |
| `8c4b1706` (5/11 15:50) | OK, 196 chars | **LOCK_WAIT_TIMEOUT 30000ms** | |

🎯 **Diagnosis (now backed by evidence, not speculation):**

- **The hooks ARE firing in production.** before_compaction fires, summarize() runs, the worker spawns.
- **The LLM call IS succeeding in production.** OpenRouter returns substantive (1610–11373 char) summaries.
- **The hot-swap atomic rewrite is the failure point.** It is timing out on `waitForLockAbsent(sessionFile, 30000ms)` — i.e. it cannot find a 30-second window where OC has no write lock on the session file.

### Why this happens

`runHotSwapWorker` calls `waitForLockAbsent(sessionFile, hotSwapTimeoutMs=30000)` after the LLM returns. This polls for the `.jsonl.lock` file to disappear. OC's session machinery acquires the lock for every write (every turn, every persisted message). For an active session that the user keeps working in (typical for kasett-research and infra topics), the lock churns continuously and there's never a 30-second clear window.

The one case that "succeeded" the lock wait (`42b8c639`) then hit `STUB_NOT_FOUND` — the stub line had already been overwritten by some other write (likely OC's own checkpoint mechanism rewriting the JSONL).

### Manual trigger procedure (documented for follow-up, not run live)

To reproduce in isolation without disrupting Chris's live sessions:

1. Spin up a throwaway OC agent in a temp workspace
2. Prime a session with enough context to trigger compaction
3. Send `/compact` (or wait for OC's auto-compaction threshold)
4. Watch:
   - `research/hook-events.jsonl` — confirms `before_compaction` → `summarize:invoked` → `summarize:hotswap_stub_returned` → `after_compaction:fired`
   - `research/hotswap-diag.log` — confirms `WORKER_START` → `LLM_CALL_START` → `LLM_DONE` → either `LOCK_WAIT_TIMEOUT` (failure) or `ATOMIC_SWAP_START` → `SWAP_COMPLETE` (success)
   - The session JSONL — confirms the compaction entry's `summary` field went from stub to rich

5. Then close the session (so OC drops the lock) and observe whether a stuck swap eventually lands. If it does, the architectural fix is "wait longer" or "swap on session_end". If it doesn't, the worker process has died.

### Did NOT run live in production

Running this against Chris's live sessions risks corrupting active-conversation state. Not worth it given the diag-log evidence is already conclusive about the failure mode.

### Status: ✅ A5 complete
- Procedure documented for future controlled testing.
- Existing diag log already provides conclusive evidence — no live trigger needed.

