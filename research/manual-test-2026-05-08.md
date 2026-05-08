# Manual End-to-End Test — kasett-rewind Hot-Swap Compaction
**Date:** 2026-05-08T08:47–08:48 UTC  
**Tester:** Clyde subagent  
**Verdict: ✅ PIPELINE WORKS — after fixing wrong model IDs**

---

## Summary

The hot-swap compaction pipeline works end-to-end. All 5 stages verified:

1. ✅ **Stub returned immediately** — 0ms, no LLM call
2. ✅ **Background worker fires** — WORKER_START logged, not killed by abort signal
3. ✅ **LLM call succeeds via OpenRouter** — `anthropic/claude-sonnet-4-5`, 673 chars, ~15s
4. ✅ **Atomic file rewrite completes** — SWAP_COMPLETE, stub replaced in JSONL
5. ✅ **Full summary contains valid [THREAD_META]** — properly structured

---

## Root Cause Found (and Fixed)

**Bug:** Wrong model IDs in `src/index.ts` — `anthropic/claude-sonnet-4-20250514` is not a valid model ID on either OpenRouter or Anthropic's API.

| Provider | Wrong ID | Correct ID |
|---|---|---|
| OpenRouter | `anthropic/claude-sonnet-4-20250514` | `anthropic/claude-sonnet-4-5` |
| Anthropic direct | `claude-sonnet-4-20250514` | `claude-sonnet-4-5` |

**Fix applied:** `src/index.ts` lines 592, 620 updated. Build clean (`npm run build`).

---

## Evidence

### Diag log entries (stub `bf170d7b-98f9-4439-ae12-0ca5483ac1aa`)

```
[2026-05-08T08:47:44.563Z] WORKER_START stub=bf170d7b... sessionFile=/tmp/kasett-live-test-bc374a71-...jsonl signal_aborted=undefined
[2026-05-08T08:47:44.564Z] LLM_CALL_START stub=bf170d7b... model=anthropic/claude-sonnet-4-5
[2026-05-08T08:48:00.311Z] LLM_DONE stub=bf170d7b... summary_len=673
[2026-05-08T08:48:00.313Z] SWAP_COMPLETE stub=bf170d7b...
```

### Final JSONL compaction summary (after swap)

```
React hooks debugging session resolved — fixed stale closure in useEffect by adding userId to 
dependency array, then traced cascading dependency issue back to incorrectly configured useMemo. 
Added AbortController cleanup to prevent race conditions on unmount. Implemented loading and error 
state management patterns using useState with proper state transitions.

[THREAD_META]
main: React hooks debugging and state management
sub1: useEffect dependency arrays and stale closures
sub2: AbortController cleanup patterns
sub3: Loading and error state implementation
[/THREAD_META]
```

### Timing

| Stage | Time |
|---|---|
| generateStub() | 0ms |
| LLM call (OpenRouter) | ~15.7s total worker time |
| Atomic swap | <5ms after LLM done |

---

## Pre-fix failure mode (for the record)

Before the fix, the diag log showed `model=undefined` (integration tests) or `model=anthropic/claude-sonnet-4-20250514` with OpenRouter returning:

```json
{"error":{"message":"anthropic/claude-sonnet-4-20250514 is not a valid model ID","code":400}}
```

And Anthropic returning `404 not_found_error: model: anthropic/claude-sonnet-4-20250514`.

This caused `LLM_EMPTY` → worker exits → stub remains in JSONL forever.

---

## Notes on OPENROUTER_API_KEY

The key is **not in `process.env`** at plugin runtime — it's not set in `openclaw.json`'s `env.vars`. The test was run with `OPENROUTER_API_KEY` manually exported from `data/.secrets/openrouter-clyde.env` (`OR_RUNTIME_KEY`).

The plugin falls through to Anthropic direct API when `OPENROUTER_API_KEY` is absent. With the corrected model name `claude-sonnet-4-5`, that path also works.

**Action item:** Decide whether to set `OPENROUTER_API_KEY` in openclaw.json env vars so the plugin uses OpenRouter at runtime, or rely on Anthropic fallback. Either works now that model IDs are correct.

---

## Recommendation

1. ✅ **Model ID fix is already applied** to `src/index.ts` and rebuilt — deploy/restart OC to pick it up
2. **Optional:** Add `OPENROUTER_API_KEY` to `openclaw.json` `env.vars` so the plugin uses OpenRouter routing (better latency control, fallbacks, logging)
3. **Monitor:** Next natural compaction should write a full summary. Check `hotswap-diag.log` for `LLM_DONE` + `SWAP_COMPLETE` entries with `model=anthropic/claude-sonnet-4-5`
