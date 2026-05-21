# Hot-Swap Patch Notes — 2026-05-17

**Patch file:** `research/phase-h-real-world/2026-05-17-hotswap-patch.diff`
**Target:** `src/index.ts`
**Base commit:** `589aa8665f1e607b358f78ab5555e4400d49c258`
**Status:** Applies cleanly — `git apply --check` passes

---

## Summary

Two fixes addressing the 0/7 hot-swap completion rate documented in the RCA
(`2026-05-17-hotswap-rca.md`). Both are additive, non-breaking changes to
`src/index.ts` only. No schema changes. No sidecar format changes.

---

## Lines Changed

| Change | Lines added | Lines removed | Net |
|--------|-------------|---------------|-----|
| imports (path + fs/promises) | +1 | -1 | 0 |
| `pendingCompactionCtx` type | +2 | 0 | +2 |
| `before_compaction` handler | +9 | -2 | +7 |
| `buildCompactionContext` Fix 1b | +9 | -6 | +3 |
| `before_prompt_build` Fix 2 | +38 | -1 | +37 |
| `findSiblingSessionForTopic` helper | +52 | 0 | +52 |
| **Total** | **111** | **10** | **+101** |

---

## Helpers Added

### `findSiblingSessionForTopic(sessionsDir, currentFilename, topicId)`

- **Location:** new function at bottom of `src/index.ts`, before `isAbortError`
- **Purpose:** Scans `sessionsDir` for `*-topic-<topicId>.jsonl` files, excluding
  the current file, sidecar files (`*.kasett-meta.*`), and checkpoint files.
  Returns the path of the most recently modified sibling (by `stat.mtimeMs`).
- **Used by:** `before_prompt_build` when `readLastNSummaries` returns empty for
  the current session (post-rotation scenario).
- **Failure mode:** Non-throwing — returns `null` on any error. The existing
  `no_summaries` path is taken if `null`.

---

## Fix 1 — `before_compaction` + `buildCompactionContext`

### What changed

**1a — `before_compaction` handler (line ~281):**
- Added `const eventSessionFile = event?.sessionFile ?? null`
- Extended `pendingCompactionCtx` with `sessionFile: eventSessionFile`
- Updated log breadcrumb: `captured_ctx` event now includes `sessionFile` field
- Updated `api.logger.debug` message to show the captured path

**1b — `buildCompactionContext` (line ~873):**
- Added fast-path: `if (capturedCtx.sessionFile) { sessionFile = capturedCtx.sessionFile; }`
  before calling `resolveSessionFileFromState`
- `resolveSessionFileFromState` (which includes the Strategy 3 lock-file scan)
  remains as fallback when event payload had no `sessionFile`

### OC payload verification

Confirmed in `pi-embedded-runner-C72h-nWV.js`:
- **Line 1410** (fire-and-forget path): `sessionFile: ctx.params.session.sessionFile`
- **Line 7087** (ownsCompaction await path): `sessionFile: params.sessionFile`

The field is `event.sessionFile` (flattened by `runBeforeCompaction` → `runVoidHook`).
Not `event.params.session.sessionFile` — the RCA's description of the OC internals
was correct but the consumer field name is the flattened form.

---

## Fix 2 — `before_prompt_build` sibling session scan

### What changed

After `readLastNSummaries(sessionFile, ...)` returns empty:
1. Extract `topicId` from `sessionKey` via `/:topic:(\d+)$/`
2. Call `findSiblingSessionForTopic(dirname(sessionFile), basename(sessionFile), topicId)`
3. If a sibling is found, read its summaries with the same `readLastNSummaries` call
4. Log a new `sibling_fallback` event if summaries are found

Existing code path for `recentSummaries.length > 0` is unchanged.

---

## Log Breadcrumbs

New/changed log events in `hook-events.jsonl`:

| Event | New fields | Meaning |
|-------|-----------|---------|
| `before_compaction` / `captured_ctx` | `sessionFile` | Shows whether OC passed sessionFile in event payload |
| `before_prompt_build` / `sibling_fallback` | `siblingFile`, `summaryCount` | Sibling scan found prior-session summaries |

**Diagnostic question after deploy:** If `captured_ctx` shows `sessionFile: null`,
Bug 1 is not fully fixed by 1a alone — means OC is calling the hook via a path
that doesn't pass `sessionFile`. Fallback 1b (lock-file scan via
`resolveSessionFileFromState` Strategy 3) should still catch it.

---

## Test Plan

### Unit tests (existing harness)

1. **`src/tests/hotswap.test.ts`** — add test where `before_compaction` fires
   with `event.sessionFile` populated. Assert `pendingCompactionCtx.sessionFile`
   matches. Assert `buildCompactionContext` uses it without calling
   `resolveSessionFileFromState`.

2. **`src/tests/hotswap.test.ts`** — add test where `before_compaction` fires
   with `event.sessionFile = undefined`. Assert fallback to
   `resolveSessionFileFromState` is called.

3. **`src/tests/sidecar-path-resolution.test.ts`** (new or extend) — create
   two JSONL files for same topic (different UUIDs), write fake compaction
   summaries to the older one. Set sessions.json to point to the newer.
   Run `before_prompt_build` logic. Assert `sibling_fallback` event fires
   and summaries are non-empty.

### Synthetic integration test

```bash
# 1. Write a fake compaction summary into <old-uuid>-topic-5392.jsonl
# 2. Create empty <new-uuid>-topic-5392.jsonl
# 3. Point sessions.json to new UUID
# 4. Trigger before_prompt_build for session key :topic:5392
# 5. Assert hook-events.jsonl contains sibling_fallback event
# 6. Assert prependContext is non-empty
```

### Production verification

After deploying:
1. **Fix 1 verified:** next `captured_ctx` event should show
   `"sessionFile": "/home/node/.openclaw/.../sessions/XXXX-topic-5392.jsonl"`
   instead of `null`. If still `null`, check which OC call path is being used.
2. **Fix 2 verified:** next `before_prompt_build` for topic:5392 should show
   `"action": "sibling_fallback"` then `"action": "inject_orientation"` (if
   metas parse correctly) rather than `"action": "no_summaries"`.
3. **Worker start verified:** check `hotswap-diag.log` for `WORKER_START` with
   a real `sessionFile=` path on next compaction.

---

## Risk Assessment

| Fix | Risk level | Rationale |
|-----|-----------|-----------|
| Fix 1a — event.sessionFile passthrough | **Low** | Additive field in type + constructor. Null guard preserved. No logic change when field is absent. |
| Fix 1b — fast-path in buildCompactionContext | **Low** | Replaces one call with a guard. Fallback path (resolveSessionFileFromState + Strategy 3 lock scan) unchanged. |
| Fix 2 — sibling scan in before_prompt_build | **Low-Medium** | Read-only file operations. Mtime-based sibling selection could theoretically pick a stale session if topic was recycled for unrelated work. Mitigated: only fires when current session has 0 summaries; oldest sessions naturally get lower mtime. |

---

## Rollback

```bash
cd repos/kasett-rewind
git restore src/index.ts
```

Returns to commit `589aa86` exactly. No data files affected. No sidecar format changes.

---

## PAL Classification

Both fixes are **PAL-class** per RCA recommendation:
- Fix 1 modifies core data-capture mechanism (`pendingCompactionCtx`) — operational-critical path
- Fix 2 modifies what the model sees every turn (cognitive effect)

Main session should run PAL review before applying via `git apply`.
