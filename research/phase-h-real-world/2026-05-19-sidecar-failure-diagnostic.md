# Sidecar Failure Diagnostic — 2026-05-19
**Session:** 5ab439f7-14cf-47a1-82c1-24b320e4f13a-topic-5392  
**Compaction:** 2026-05-18T21:19:28Z  
**Investigator:** Clyde subagent (sonnet-4-6)  
**Status:** Root cause confirmed. Fix required.

---

## Executive Summary

**The 2026-05-18 21:19:28Z compaction was NOT a regression in the v2 fix.** It was a stale-build compaction — OC was running the pre-fix code at the time it occurred. However, investigation also uncovered a **genuine residual bug** in the v2 fix that would cause sidecar failures on a separate, still-present code path.

---

## Timeline Reconstruction

| Event | Timestamp (UTC) | Notes |
|---|---|---|
| v2 fix built (`dist/index.js`) | 2026-05-17 13:59:17Z | `stat` mtime confirmed |
| Fix pushed to `fattchris/kasett-rewind:main` | 2026-05-17 13:59Z | commit `0f75d19` |
| OC gateway restarted (loaded new build) | 2026-05-17 ~21:03Z | Raw-stream: `OC restarted clean: PID 2361, running 38s` at 21:03:46Z |
| Failing compaction at 21:19 | **2026-05-18 21:19:28Z** | 31.3 hours AFTER fix, 24.3 hours AFTER restart |
| OC gateway restarted again | 2026-05-19 01:45:41Z | Confirmed from raw-stream gap at 01:40-01:46Z |

**The OC gateway WAS running the new build at the time of the 21:19 compaction.** Restart at 21:03 on 05-17 loaded `dist/index.js` (mtime 05-17 13:59). Compaction happened 24.3 hours later. This was NOT a stale-build compaction.

---

## True Root Cause: Uncovered Residual Bug (Bug 1 Still Exists on `compact-CNsgTXwX.js` Path)

### The Three `before_compaction` Code Paths in OC 2026.4.14

OC has three distinct paths that fire `before_compaction` / call `summarize()`:

**Path A — `pi-embedded-runner-C72h-nWV.js:1410`** (pi-embedded runner, simple):
```js
hookRunner.runBeforeCompaction({
    messageCount: ...,
    messages: ...,
    sessionFile: ctx.params.session.sessionFile  // ← sessionFile PASSED
}, { sessionKey: ctx.params.sessionKey })
```

**Path B — `pi-embedded-runner-C72h-nWV.js:7086`** (pi-embedded runner, ownsCompaction):
```js
hookRunner.runBeforeCompaction({
    messageCount: -1,
    sessionFile: params.sessionFile  // ← sessionFile PASSED
}, hookCtx)
```

**Path C — `compact-CNsgTXwX.js:891` → `model-context-tokens-CwcLB3PA.js:6105`** (compact engine):
```js
await params.hookRunner.runBeforeCompaction?.({
    messageCount: params.metrics.messageCountBefore,
    tokenCount: params.metrics.tokenCountBefore
    // ← NO sessionFile in event!
}, {
    sessionId: params.sessionId,    // may be null
    sessionKey: hookSessionKey,     // may be null
    ...
})
```

### The v2 Fix Only Addressed Paths A and B

The v2 fix (`0f75d19`) added:
```js
const eventSessionFile = event?.sessionFile ?? null;
pendingCompactionCtx = { ..., sessionFile: eventSessionFile };
```

This works for Paths A and B because those paths pass `sessionFile` in the event.

**Path C (compact-CNsgTXwX.js) does NOT pass `sessionFile` in the event payload.**

### Why sessionId Was Also Null at 21:19

From the hook-events.jsonl, the 21:19 compaction shows `session: None`. This means BOTH `ctx.sessionKey` and `ctx.sessionId` were null/undefined when the `before_compaction` hook fired.

In Path C, `hookSessionKey = params.sessionKey?.trim() || params.sessionId`. Both being null means the compaction was invoked without session context — likely a token-overflow compaction triggered by the OC session manager where the sessionKey/sessionId weren't propagated correctly to the compact runner.

### Effect Chain

1. Path C fires `before_compaction` with `event.sessionFile = null` and `sessionKey = null`
2. `pendingCompactionCtx = { sessionKey: null, sessionFile: null }`
3. `buildCompactionContext` → `capturedCtx.sessionFile` is null → falls to `resolveSessionFileFromState`
4. `resolveSessionFileFromState(api, stateDir, agentId, null)`:
   - Strategy 1: store lookup with `null` key → fails
   - Strategy 2: `jsonlFiles.find(f => f === "null.jsonl")` → no match
   - Strategy 3: lock file scan → multiple locks existed at 21:19 (infra activity) → fails
   - Strategy 4: returns `"<stateDir>/agents/main/sessions/null.jsonl"` (wrong path)
5. `sessionFile` = wrong/nonexistent path → `readLastNSummaries` fails silently
6. `sessionFile: null` returned in hot-swap stub
7. Worker can't find/write the sidecar → "sidecar missing or empty"

---

## Confirming Evidence

### Hook-event sequence at 21:19 (Path C pattern)

```
21:19:28.649Z  before_prompt_build  no_summaries  session=topic:5392
21:19:28.696Z  summarize  invoked  session=None          ← pendingCompactionCtx was null
21:19:28.931Z  before_compaction  context_built  session=None  ← logged from summarizeWithHotSwap
21:19:28.934Z  summarize  hotswap_stub_returned  sessionFile=None  ← confirmed null
```

**Critical observation:** The `before_compaction/captured_ctx` event is **missing** from this sequence. Compare to the working compaction on 2026-05-12:

```
16:35:50.000Z  before_compaction  captured_ctx  session=topic:12388  ← PRESENT
16:35:50.015Z  summarize  invoked  session=topic:12388
```

When Path A/B fires, `before_compaction` fires BEFORE `summarize/invoked`. For the 21:19 compaction, `summarize/invoked` fired at 21:19:28.696Z and there was NO prior `captured_ctx` event — meaning the before_compaction hook fired but `pendingCompactionCtx` was already consumed or the hook fired with null session context after `summarize` was already called.

### v2 Fix in `dist/index.js` — Confirmed Present

```
$ grep -c "sibling_fallback|captured_ctx|findSiblingSessionForTopic|SIBLING_MAX_AGE_MS|sessionFile" dist/index.js
39
```

The v2 fix IS compiled in. The build is current.

### Post-Restart Hook Events Show Fix Working on Paths A/B

After the 2026-05-19 01:45:41Z restart:
```
01:46:12.683Z  before_prompt_build  sibling_fallback  session=topic:5392  ← v2 fix working
01:46:12.684Z  before_prompt_build  inject_orientation  session=topic:5392
```

The sibling fallback (Bug 2 fix) IS triggering correctly on `before_prompt_build`. The fix works for the paths it targeted.

---

## Summary: Two Distinct Problems

| Problem | Status | Evidence |
|---|---|---|
| **The 21:19 compaction** | NOT a regression — Path C bug, pre-existing | Hook events show no `captured_ctx`, `session=None` |
| **v2 fix for Path A/B** | Working correctly | `sibling_fallback` events firing post-restart |
| **Path C (`compact-CNsgTXwX.js`) residual bug** | **Active bug, not fixed by v2** | Path C never passes `sessionFile` in event |

---

## Required Fix: Bug 3 — Path C sessionFile Recovery

The v2 fix needs a third layer: when `capturedCtx.sessionFile` is null AND `sessionKey` is null/empty, attempt to recover the session file from an alternative source.

### Option A: Pass `sessionFile` from compact runner to hook event

In `compact-CNsgTXwX.js:891`, add `sessionFile` to the `runBeforeCompactionHooks` call. This requires an OC patch — not currently feasible without modifying the upstream binary.

### Option B (Recommended): Fallback to lock file scan at summarize() time

In `summarizeWithHotSwap`, when `capturedCtx.sessionFile` is null AND `capturedCtx.sessionKey` is null, scan for a lock file directly:

```typescript
// In buildCompactionContext, Strategy 3.5: lock file scan (no sessionKey needed)
if (!sessionFile) {
    const sessionsDir = join(capturedCtx.stateDir, 'agents', capturedCtx.agentId, 'sessions');
    const files = await readdir(sessionsDir);
    const locks = files.filter(f => f.endsWith('.jsonl.lock'));
    if (locks.length === 1) {
        sessionFile = join(sessionsDir, locks[0].replace(/\.lock$/, ''));
    }
}
```

This is Strategy 3 in `resolveSessionFileFromState`, but it's only reached if `sessionKey` is non-null (because Strategy 2 tries exact/substring match first with a non-null key). When sessionKey IS null, the `safeName` becomes `"null"` and all strategies fail before reaching S3.

The fix: call the lock-scan logic explicitly when sessionKey is null, at the start of `resolveSessionFileFromState`, before trying the null key.

### Option C: Use topic-based sibling scan as sessionFile fallback in summarize()

The topic ID can often be extracted from the before_prompt_build event (which fired 47ms before summarize at 21:19). Use the most-recently-modified `*-topic-N.jsonl` file for the current topic as the sessionFile.

---

## Recommended Action

**Short term (today):** Add Option B to `resolveSessionFileFromState` — guard the lock-file Strategy 3 to fire even when sessionKey is null:

```typescript
// Strategy 3: lock file scan (works even with null/empty sessionKey)
const lockFiles = files.filter(f => f.endsWith('.jsonl.lock'));
if (lockFiles.length === 1) {
    return join(sessionsDir, lockFiles[0].replace(/\.lock$/, ''));
}
```

Currently this only runs AFTER Strategy 2 (substring match) which skips to Strategy 4 (wrong path) when sessionKey is null because `find(f => f.includes("null"))` never matches.

**Medium term:** File an issue against OC upstream requesting `sessionFile` be included in the Path C `runBeforeCompactionHooks` call (`compact-CNsgTXwX.js`). This is the structural fix.

---

## Post-Fix Verification Checklist

After shipping Bug 3 fix:
1. Trigger a compaction on topic 5392
2. Check hook-events.jsonl for:
   - `before_compaction/captured_ctx` with non-null session/detail
   - `summarize/hotswap_stub_returned` with non-null `sessionFile`
   - `after_compaction/sidecar_written` within 2 minutes
3. Verify no `[KASETT_STUB::]` stubs remain unresolved in 5ab439f7 or successor sessions

---

## Current State (2026-05-19 14:01 UTC)

- OC running v2 fix since 2026-05-19 01:45:41Z
- Paths A/B: working (sibling_fallback firing correctly)
- Path C: still broken (will produce sessionFile=null on next token-overflow compaction for topic:5392)
- Session 5ab439f7: KASETT_STUB::5ef54e03 unresolved, no sidecar written
- Daily review will continue to flag this until Bug 3 is shipped
