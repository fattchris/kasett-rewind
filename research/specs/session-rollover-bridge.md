# Spec: Session-Rollover Bridge

**Status:** Draft
**Author:** Clyde
**Date:** 2026-05-26
**Target version:** kasett-rewind v0.3.0
**Tracking:** Topic-35868 cold-start incident, May 24/26 2026

---

## 1. Problem

Kasett-rewind currently hooks two events:

- **`summarize()` (CompactionProvider):** fires only when OC triggers compaction (session > threshold).
- **`before_prompt_build`:** fires every turn, reads last N compaction summaries from the session JSONL (with sibling-session fallback for `:topic:N` keys) and injects a light `[THREAD_META]` orientation string.

Both hooks depend on **prior compaction events existing** to produce useful state.

**Failure case (observed 2026-05-26):** topic-35868 had ~8 hours of light activity on 2026-05-24 (compactionCount=0). 41 hours of idle. On re-engagement, OC created a fresh sessionId. The new session's `before_prompt_build` hook fired, looked for compactions in the current session (none) and in the most-recent sibling session (also none → compactionCount=0). Result: **cold start with no orientation injected**, even though a rich prior transcript existed on disk.

Vanilla pre-May-8 OC behavior aggressively summarized prior sessions into the new one via its built-in safeguard compaction at session creation. Kasett replacing the compaction provider broke that seeding path.

## 2. Goal

When a new session is created for a `sessionKey` that has prior session JSONLs on disk, seed the new session with orientation derived from the most recent prior session — **whether or not that session ever triggered compaction**.

Non-goals:
- Reconstructing full message-level history (that's the user's job via /resume or explicit recall).
- Cross-topic memory sharing (each topic remains its own continuity boundary).
- Modifying OC core. All work lives in the plugin.

## 3. Design

### 3.1 New hook: `before_prompt_build` cold-session branch

Extend the existing `before_prompt_build` handler. Today it checks current session → sibling session for **compaction summaries**. Add a third tier:

```
Tier 1 (existing): current session has summaries        → use them
Tier 2 (existing): sibling session has summaries        → use them
Tier 3 (NEW):      sibling session has raw turns only   → generate a rollover summary on demand
```

Trigger condition for Tier 3:
- Current session JSONL has zero compaction summaries AND fewer than `coldStart.minTurns` user/assistant turns (default 2). This is the "I just started fresh" signal.
- A sibling session file exists for the same `sessionKey` (same `:topic:N` suffix, or same root sessionKey if no topic).
- The sibling's `mtime` is within `coldStart.maxIdleHours` of now (default 168 hours = 7 days). Older = stale; don't auto-seed.

### 3.2 Rollover summary generation

When triggered, generate one of two things based on the sibling's state:

**(a) Sibling has summaries** → already handled by existing sibling-fallback. No change.

**(b) Sibling has raw turns only (no compactions)** → run the same compaction pipeline that `summarize()` uses, but against the sibling's full message log. Produce a fresh `[THREAD_META] + summary` blob. Write it as a **rollover sidecar** to:

```
<stateDir>/sessions/<agentId>/<sessionKey>.rollover.json
```

Schema:
```json
{
  "schemaVersion": 1,
  "sourceSessionFile": "abc123-topic-35868.jsonl",
  "sourceSessionMtimeMs": 1779700000000,
  "generatedAtMs": 1779850000000,
  "turnsConsumed": 47,
  "threadMeta": { /* parsed ThreadMeta v1 */ },
  "summary": "<full markdown summary>",
  "stub": false
}
```

On next `before_prompt_build` for the new session, inject:
- `[THREAD_META]` orientation (light, every turn) — same as today
- **PLUS** a one-shot `[ROLLOVER_CONTEXT]` block injected only on the FIRST turn of the new session, containing the full summary

The rollover sidecar is consumed-once: after first injection, write a `.consumed` marker (or rename `.rollover.json` → `.rollover.consumed.json`). Subsequent turns fall back to normal `[THREAD_META]`-only injection. This prevents re-injection cost on every turn.

### 3.3 Hot-swap pattern (avoid blocking the first turn)

The summarization LLM call costs 3–15 seconds. We can't block the user's first prompt on that.

Mirror the existing hot-swap design from `summarize()`:

1. On first `before_prompt_build` of a cold session, detect rollover candidate.
2. **Synchronously** generate a stub `[ROLLOVER_CONTEXT]` from the sibling's last user message + last assistant message (cheap, no LLM):
   ```
   [ROLLOVER_CONTEXT]
   Last session ended ~Xh ago. Last user turn: "<truncated>". Last assistant turn: "<truncated>".
   Full summary loading in background…
   ```
3. **Asynchronously** spawn a worker that runs full summarization, writes the rollover sidecar, and the NEXT turn picks up the rich summary.
4. If the user only ever does one turn, they got the stub. Good enough.

This matches kasett's existing zero-delay philosophy.

### 3.4 Config

Add to plugin config schema:

```json
{
  "coldStart": {
    "enabled": true,
    "minTurns": 2,
    "maxIdleHours": 168,
    "hotSwap": true,
    "hotSwapTimeoutMs": 30000,
    "maxSourceTurns": 200
  }
}
```

`maxSourceTurns`: cap on how many turns from the sibling session feed the rollover summary LLM call (prevents runaway cost on very long prior sessions). Default 200, take from tail.

`enabled: false` cleanly disables the entire rollover path — useful for debugging.

## 4. Architecture diagram

```
[New session created by OC]
         ↓
before_prompt_build fires
         ↓
  Tier 1: current session compactions? → inject, done
         ↓ no
  Tier 2: sibling session compactions? → inject, done
         ↓ no
  Tier 3: cold-start branch
    ├─ Find newest sibling JSONL for same topic
    ├─ Check mtime within maxIdleHours
    ├─ Check sibling has ≥ minTurns content
    ├─ Generate STUB [ROLLOVER_CONTEXT] (sync, no LLM)
    ├─ Inject stub + [THREAD_META]
    └─ Spawn background worker:
         ├─ Run summarize() pipeline against sibling messages
         ├─ Parse [THREAD_META] from result
         ├─ Write <sessionKey>.rollover.json
         └─ Next turn: before_prompt_build reads sidecar, injects rich [ROLLOVER_CONTEXT], renames to .consumed
```

## 5. Implementation plan

Estimated ~200 LOC, split:

| File (new or modified) | LOC | What |
|---|---|---|
| `src/rollover/detector.ts` (new) | 40 | Find sibling, check mtime/turns gates, decide if Tier 3 applies |
| `src/rollover/stub.ts` (new) | 30 | Build cheap synchronous [ROLLOVER_CONTEXT] from last turns |
| `src/rollover/worker.ts` (new) | 60 | Background worker: read sibling, call LLM, write sidecar |
| `src/rollover/sidecar.ts` (new) | 30 | Read/write/consume `.rollover.json` |
| `src/index.ts` (modified) | ~40 | Wire Tier 3 into `before_prompt_build` |
| `src/types.ts` (modified) | ~10 | Add `ColdStartConfig` |
| `openclaw.plugin.json` (modified) | ~15 | Schema for `coldStart` block |
| `src/tests/rollover.test.ts` (new) | 80 | Unit + integration tests |

Total: ~305 LOC including tests.

## 6. Test plan

Cases to cover:

1. **Cold session, sibling with compactions:** existing Tier 2 path still wins. No regression.
2. **Cold session, sibling with raw turns only:** stub injected immediately. Background worker generates sidecar. Next turn injects rich context. Sidecar renamed `.consumed` after read.
3. **Cold session, no sibling found:** no injection, no error. Logs `cold_start_no_sibling`.
4. **Cold session, sibling too old (> maxIdleHours):** skipped. Logs `cold_start_stale`.
5. **Cold session, sibling too thin (< minTurns):** skipped. Logs `cold_start_too_thin`.
6. **Cold session, sibling exists but worker crashes:** stub remains. Logs error. No retry on subsequent turns (rate limit via a `.failed` marker).
7. **Warm session after rollover injection:** sidecar already consumed. Only [THREAD_META] injected, no duplicate [ROLLOVER_CONTEXT].
8. **Two cold sessions for same sessionKey rapidly created:** second one sees `.rollover.json` already exists OR `.consumed`, skips re-generation.
9. **Disabled via config:** entire Tier 3 path inert.

## 7. Rollout

Phased:

1. **Phase 1 (v0.3.0-rc1):** Ship behind `coldStart.enabled: false` default. Manual flip for Clyde's agent. Log everything aggressively for 48h.
2. **Phase 2 (v0.3.0-rc2):** Default `coldStart.enabled: true` for Clyde only. Other agents stay opt-in.
3. **Phase 3 (v0.3.0):** Default-on fleet-wide after 1 week of clean Clyde data.

Rollback: set `coldStart.enabled: false` in config and restart. Reversible single-line change. No on-disk schema changes (sidecar files can be left in place; they're inert without the consumer).

## 8. Open questions

1. **Stale `.consumed` cleanup.** Should we GC old rollover sidecars? Proposal: lifecycle job deletes `.rollover.consumed.json` older than 30 days. Low priority.
2. **Token budget for rollover summary.** Should it be smaller than a normal compaction summary (lighter touch) or the same? Proposal: same — the cold session has full budget available.
3. **Multi-topic group chats.** A sessionKey like `default:telegram:-1003723465246:topic:20751` resolves cleanly. But what about non-forum chats where there's no `:topic:` suffix? Proposal: same logic, match on full sessionKey root. Worth a test case.
4. **Failure mode if `summarize()` itself is broken.** The worker calls the same internal compaction pipeline. If that's broken, the rollover fails the same way. Acceptable — fix the underlying bug, both paths heal.
5. **Should we ever auto-trigger this from `summarize()` retroactively?** I.e., the very first compaction on a new session — should it incorporate prior-session summary as `previousSummary`? Probably yes, separate small improvement. Out of scope for this spec.

## 9. Decision point

Recommend proceeding with this design. The fix lives entirely in the plugin, follows kasett's existing hot-swap pattern, is reversible via config, and closes the observed gap without expanding OC's surface area.

If approved, I'll open a tracking issue in the kasett repo with this spec linked, and the kasett coding agent (topic-20751) can pick up implementation.

---

**Companion separate work (not this spec):**

- Test #1 fastest revert path (`compaction.mode: "safeguard"`) on a non-prod agent to confirm the pre-May-8 behavior still works as remembered. Useful as a fallback if rollover ships late.
- Audit other kasett "fire on event X" gaps that could have the same shape (e.g., agent restart mid-session, gateway hot-reload).
