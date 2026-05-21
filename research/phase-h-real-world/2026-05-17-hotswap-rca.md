# Hot-Swap Completion Bug — Root Cause Analysis

**Date:** 2026-05-17  
**Investigator:** Clyde (subagent kasett-hotswap-rca-20260517)  
**Session:** `4ce855d8-ecce-403f-aa8f-6bac7858790c-topic-5392`  
**Scope:** 7 production compactions post-phase-g (2026-05-12 21:38 UTC → 2026-05-17)

---

## Executive Summary

The hot-swap "completion" problem is actually **two separate bugs** operating at different layers. The first prevents the sidecar from being written at all when `sessionFile` is null. The second prevents the sidecar from being *read back* into the model even when the sidecar is successfully written. Together they explain 0/7 effective hot-swaps.

---

## Bug 1 — `before_compaction` Hook Fires Without `sessionKey` in Certain Compaction Paths

### What happens

In some compaction code paths inside OC's `pi-embedded-runner`, `before_compaction` is invoked **as fire-and-forget** (`.catch(...)` only, no `await`), or is called from the `runOwnsCompactionBeforeHook` closure which guards on `contextEngine.info.ownsCompaction !== true`. In these paths either:

(a) The hook fires but **without a `sessionKey`** in the `hookCtx` — so kasett's `before_compaction` handler sets `pendingCompactionCtx` with an empty/null `sessionKey`, and `resolveSessionFileFromState` returns a wrong-path candidate or null.

(b) The hook **doesn't fire at all** before `summarize()` is called (race condition or guard failure) — so `pendingCompactionCtx` is null when `summarize()` consumes it.

### Evidence

From `hook-events.jsonl`, working compactions (May 13, May 14) emit `captured_ctx` events with full `sessionId`/`agentId`:

```json
{"hook":"before_compaction","sessionId":"agent:main:telegram:group:-1003723465246:topic:5392","agentId":"main","action":"captured_ctx"}
```

Failing compactions (May 15, May 16, May 17) emit **only `context_built`** with no prior `captured_ctx` and no `sessionId`/`agentId` in the event:

```json
{"hook":"before_compaction","action":"context_built","detail":{"mode":"hotswap","lifecycle_count":0}}
```

This means `pendingCompactionCtx` was null when `summarize()` ran → `buildCompactionContext()` returns `sessionFile: null` → `runHotSwapWorker` is skipped entirely (the `if (sessionFile)` guard in `summarizeWithHotSwap`).

### OC Code Path Responsible

In `pi-embedded-runner-C72h-nWV.js` line 1410, the main-session compaction path fires `before_compaction` **without await**:

```js
if (hookRunner?.hasHooks("before_compaction")) hookRunner.runBeforeCompaction({
    messageCount: ctx.params.session.messages?.length ?? 0,
    messages: ctx.params.session.messages,
    sessionFile: ctx.params.session.sessionFile
}, { sessionKey: ctx.params.sessionKey }).catch((err) => {
    ctx.log.warn(`before_compaction hook failed: ${String(err)}`);
});
```

This is fire-and-forget. When kasett's async `before_compaction` handler writes to `pendingCompactionCtx`, OC may already be calling `summarize()` on the synchronous/fast path before the async write lands. The `context_built` event fires from *inside* `buildCompactionContext()` which runs *after* `pendingCompactionCtx` is read — so if the race is lost, `capturedCtx` is null.

The `runOwnsCompactionBeforeHook` closure path (line 8462) has `contextEngine.info.ownsCompaction !== true` guard. When `ownsCompaction` is true (kasett owns it), this *does* `await` — but the `sessionFile` passed is `params.sessionFile`, which is the **session file the context engine was initialized with**. If `contextEngine` was initialized with a stale/wrong `sessionFile` during session rotation, this path may pass an incorrect value.

### Why it started failing around May 15

The evidence shows working compactions on May 12–14 used the `model-context-tokens` compaction path (which calls `runBeforeCompactionHooks` synchronously before the provider). From May 15 onward, compactions appear to route through the `pi-embedded-runner` overflow/timeout recovery path (`runOwnsCompactionBeforeHook`) or the fire-and-forget main-session path — likely because the session (`4ce855d8`) grew very large (14 MB JSONL) and triggered a different code path. The `ghost-compact-analysis.md` may have related context.

---

## Bug 2 — `before_prompt_build` Reads Wrong Session File (Session Rotation)

### What happens

`before_prompt_build` fires every turn and is supposed to inject the rich sidecar summary as orientation context. But it consistently reports `"action":"no_summaries"` for topic:5392 even after the sidecar was successfully written on May 14.

### Root Cause

`sessions.json` maps `agent:main:telegram:group:-1003723465246:topic:5392` → **`5ab439f7-14cf-47a1-82c1-24b320e4f13a-topic-5392.jsonl`** (the *current* session, created after the compaction).

The sidecar with rich summaries lives alongside **`4ce855d8-ecce-403f-aa8f-6bac7858790c-topic-5392.jsonl`** (the *old* session, now archived).

When `resolveSessionFile()` in `before_prompt_build` does a `sessions.json` lookup for the session key, it gets the current session's file path. The current session has **0 compactions** — so `readLastNSummaries()` returns `[]` → `no_summaries`.

The rich sidecar from the old session is orphaned: it exists on disk but `before_prompt_build` never finds it.

### Evidence

```bash
# sessions.json:
agent:main:telegram:group:-1003723465246:topic:5392
  → sessionFile: .../5ab439f7-14cf-47a1-82c1-24b320e4f13a-topic-5392.jsonl (0 compactions)

# Sidecar:
4ce855d8-ecce-403f-aa8f-6bac7858790c-topic-5392.jsonl.kasett-meta.jsonl (2 good entries, 635+8341 chars)
```

This happens whenever OC creates a new session UUID for the same topic (session rotation on restart/reconnect). The session key stays stable but the UUID changes.

---

## Concrete Verification: Session `4ce855d8` Compaction 2 (Stub `a2b4499a`)

**JSONL record** (compaction 2, 2026-05-14T21:03:58.134Z):
```
summary: "[KASETT_STUB::a2b4499a-eafe-472d-87b1-46a5b82e189f]\n\nSession compaction in progress..."
```
The stub was stored in OC's JSONL — ✓ stub written correctly.

**Sidecar entry** (same stub):
```json
{
  "stub_id": "a2b4499a-eafe-472d-87b1-46a5b82e189f",
  "ts": "2026-05-14T21:05:20.399Z",
  "summary_chars": 8341,
  "schema_version": "v3",
  "thread_meta_v3": {...}
}
```
The rich summary was written to the sidecar 1m22s after the stub — ✓ worker completed.

**Why the model still saw `KASETT_STUB`**: The design intention (per `worker.ts` comment block) is "Reads prefer the sidecar (rich), fall back to the JSONL for legacy entries." The `before_prompt_build` hook is the only consumer that re-reads the sidecar. But `before_prompt_build` looked at the **wrong session file** (5ab439f7, 0 compactions), so the sidecar was never consulted.

The `previousSummary` passed into `summarize()` by OC for compaction 3 came directly from OC's internal session store — which contains the stub text, not the sidecar content. OC never reads the sidecar; only kasett does. So the "hot-swap" loop requires that kasett's `before_prompt_build` re-inject the rich content — and that link was broken by session rotation.

---

## Bug 3 (Minor) — Orphaned Sidecar at Session-Key Path

One sidecar landed at `agent:main:telegram:group:-1003723465246:topic:12388.jsonl.kasett-meta.jsonl` — the session key used as a literal filesystem path. This was fixed in Phase F (`resolveSessionFilePath`) for new writes, but the old file remains as an orphan. Not blocking, but indicates the Phase F fix was not retroactively applied.

---

## Proposed Fixes

### Fix 1 — Make `buildCompactionContext` Resilient When `capturedCtx` Is Null

The current fallback when `capturedCtx` is null: "No session context captured — summarizing without full history" and `sessionFile = null`. The worker is then skipped entirely.

**Option A (preferred): In-band session file resolution from `params`**

OC passes `previousSummary` to `summarize()`. That string, if it contains `[KASETT_STUB::...]`, gives us the old stub's session. But we need the *current* session file.

A more reliable approach: scan the sessions directory directly for the locked file (OC holds a `.jsonl.lock` while compacting):

```typescript
// In buildCompactionContext, when capturedCtx is null:
// Fallback: find the currently-locked session file
const stateDir = api.runtime.state.resolveStateDir();
const sessionsDir = path.join(stateDir, 'agents', 'main', 'sessions');
const lockFiles = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl.lock'));
if (lockFiles.length === 1) {
  sessionFile = path.join(sessionsDir, lockFiles[0].replace(/\.lock$/, ''));
}
```

This already exists in `resolveSessionFilePath()` (Strategy 3) but is not called from `buildCompactionContext`. Wire it in.

**Option B (belt-and-suspenders): Pass `sessionFile` directly from the OC hook event**

In `pi-embedded-runner`, OC calls `runBeforeCompaction` with `sessionFile: ctx.params.session.sessionFile`. Kasett's `before_compaction` handler already has this in `event.sessionFile`. Wire that through to `pendingCompactionCtx`:

```typescript
// In before_compaction handler:
api.on('before_compaction', async (event: BeforeCompactionEvent, ctx: HookContext) => {
  pendingCompactionCtx = {
    sessionKey: ctx.sessionKey?.trim() || ctx.sessionId,
    agentId: ctx.agentId?.trim() || 'main',
    stateDir: api.runtime.state.resolveStateDir(),
    sessionFile: event.sessionFile ?? null,  // NEW: take it directly from the event
  };
});

// In buildCompactionContext:
// If capturedCtx.sessionFile is present, use it directly — no resolution needed
if (capturedCtx?.sessionFile) {
  sessionFile = capturedCtx.sessionFile;
}
```

The `BeforeCompactionEvent` interface already declares `sessionFile?: string`. OC passes it from `ctx.params.session.sessionFile` in both the fire-and-forget path (line 1410) and the `hookRunner.runBeforeCompaction` paths.

**Recommendation:** Implement both A and B. B is the primary fix (clean path from OC). A is the fallback for when the hook fires without the field.

### Fix 2 — Cross-Session Sidecar Lookup in `before_prompt_build`

When `readLastNSummaries()` returns empty for the current session, before giving up, scan sibling sidecar files in the sessions directory for the same topic ID:

```typescript
// After readLastNSummaries returns [] for current sessionFile:
// Scan for sibling sessions with the same topic suffix
const topicMatch = sessionKey.match(/:topic:(\d+)$/);
if (topicMatch && recentSummaries.length === 0) {
  const sessionsDir = dirname(sessionFile);
  const topicId = topicMatch[1];
  const suffix = `-topic-${topicId}.jsonl`;
  const siblings = readdirSync(sessionsDir)
    .filter(f => f.endsWith(suffix) && !f.includes('.checkpoint.') && f !== basename(sessionFile))
    .sort((a, b) => statSync(join(sessionsDir, b)).mtimeMs - statSync(join(sessionsDir, a)).mtimeMs);
  for (const sibling of siblings.slice(0, 3)) {
    const siblingFile = join(sessionsDir, sibling);
    const siblingEntries = await reader.readLastNSummaries(siblingFile, config.compaction.windowSize);
    if (siblingEntries.length > 0) {
      // Found rich summaries in a prior session for this topic
      recentSummaries = siblingEntries;
      break;
    }
  }
}
```

This makes the orientation hook resilient to session rotation, which is normal OC behavior on restart.

---

## Risk Assessment

| Fix | Risk | Rollback |
|-----|------|---------|
| Fix 1 — `capturedCtx.sessionFile` passthrough | **Low** — additive field, existing null-guard preserved. Small code change to `before_compaction` handler and `buildCompactionContext`. | Revert the two changed lines; `pendingCompactionCtx` ignores the new field and falls through to existing strategy. |
| Fix 1B — lock-file fallback in buildCompactionContext | **Low-Medium** — heuristic (lock file scan). Could pick wrong session if multiple sessions compact simultaneously (rare). Guarded by `lockFiles.length === 1` check. | Remove fallback; no behavior change for normal cases. |
| Fix 2 — sibling session scan in `before_prompt_build` | **Low-Medium** — read-only scan, file operations only. Risk: exposing summaries from a now-irrelevant old session if the topic was heavily reused for something else. Mitigate: take only the most recent sibling. | Revert. Returns to current `no_summaries` behavior (no regression vs today). |

---

## PAL Classification

**Fix 1 is PAL-class (mechanism change)** — it modifies the core data-capture mechanism (`pendingCompactionCtx`) and the compaction context builder. These are in the operational-critical path; a bad change here causes silent sidecar failures. Run PAL before merging.

**Fix 2 is PAL-class** — modifies `before_prompt_build` behavior (what the model sees every turn). Direct cognitive effect on Clyde's context. Requires PAL review.

Both fixes together are a **medium-risk coordinated change** with clear rollback. Neither affects the sidecar file format or existing data.

---

## Test Plan

### Unit Tests (existing harness)
- `src/tests/hotswap.test.ts` — extend with a test where `before_compaction` fires without `sessionKey` in `ctx` (simulates the failing path). Verify `buildCompactionContext` still returns a valid `sessionFile` via the lock-file fallback.
- `src/tests/sidecar-path-resolution.test.ts` — add test for sibling-session lookup when current session has no compactions.

### Synthetic Integration Test
```bash
# 1. Create two sessions for same topic, first one with compaction
# 2. Point sessions.json to the second (current) session
# 3. Run before_prompt_build → expect it finds the sidecar from session 1
# 4. Run summarize() with no prior capturedCtx → expect sessionFile resolved via lock file
```

The `src/tests/integration.test.ts` file is the right place; it already has a multi-session test scaffold.

### Production Verification (without waiting for natural compaction)
1. After deploying Fix 1: manually trigger a compaction via `/compact` in a Telegram topic. Check `hotswap-diag.log` for `WORKER_START` with a real `sessionFile=` (not `.lock` path). Verify `SIDECAR_WRITTEN` appears within 2 minutes.
2. After deploying Fix 2: check `hook-events.jsonl` for `before_prompt_build` events showing `inject_orientation` instead of `no_summaries` for topic:5392 on the next turn.

---

## Implementation Recommendation

This subagent can draft the code patch (changes to `src/index.ts` only — `before_compaction` handler and `buildCompactionContext`). The changes are small and well-contained. However, because both fixes touch the mechanism layer (PAL-class), **implementation should proceed through the main session with PAL review** before merge.

The specific lines to change:
- `src/index.ts` line ~295: `before_compaction` handler — add `sessionFile: event.sessionFile ?? null` to `pendingCompactionCtx`
- `src/index.ts` line ~410-430: `buildCompactionContext` — add `capturedCtx?.sessionFile` fast-path before `resolveSessionFileFromState`
- `src/index.ts` line ~470-510: `before_prompt_build` sibling scan — add after empty result from `readLastNSummaries`

---

## Summary Table

| Compaction | Stub | Sidecar | Worker Ran | Model Saw Rich |
|-----------|------|---------|------------|----------------|
| 2026-05-13 #1 (pre-phase-g) | No (inline) | ✓ (635 chars, schema=none) | ✓ but wrong session | ✗ (Bug 2) |
| 2026-05-14 #2 | ✓ a2b4499a | ✓ (8341 chars, v3) | ✓ | ✗ (Bug 2: session rotated before next turn) |
| 2026-05-16 #3 | ✓ 3f491911 | ✗ (missing) | ✗ (Bug 1: sessionFile=null) | ✗ |
| 2026-05-15 10f41f7c | ✓ | ✗ (missing) | ✗ (Bug 1: sessionFile=null) | ✗ |
| 2026-05-15 26c08bef | ✓ | ✗ (missing) | ✗ (Bug 1: sessionFile=null) | ✗ |
| 2026-05-16 16449de5 | ✓ | ✗ (missing) | ✗ (Bug 1: sessionFile=null) | ✗ |

**Net result:** 0/7 hot-swap completions reaching the model. Bug 1 = worker never runs. Bug 2 = worker ran but model read the wrong session. Both must be fixed.
