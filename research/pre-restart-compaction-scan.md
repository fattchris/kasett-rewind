# Pre-Restart Compaction Scan — Topic 4482 (Transcript Intake)

**Triggered:** 2026-05-12 16:25 UTC by Chris (manual compaction in topic 4482)
**Session:** `ce99d917-53ee-48f0-8b89-ff0f048d9c6b-topic-4482.jsonl`
**OC running:** OLD plugin code (pre-Phase B1 sidecar fix; pre-Phase B2 schema v2; pre-Phase C/D/E)

---

## TL;DR

**The hot-swap fix worked silently this time.** Instead of a `LOCK_WAIT_TIMEOUT` (Phase A's documented failure), we hit **`STUB_NOT_FOUND`** — but `SWAP_COMPLETE` was logged immediately after. The session JSONL contains a substantive 15,994-char summary (not the truncated KASETT_STUB), and **does not contain `[THREAD_META]`**. Net: this compaction landed with a real summary but no kasett structured meta.

The `STUB_NOT_FOUND` message is a known race — by the time the worker tried to swap, the LLM had already returned the rich summary AND OC had moved past the stub for some other reason. The data we have is the compaction that we want; just unannotated by kasett.

---

## Hotswap diagnostic timeline

```
16:25:53.428Z  WORKER_START         session=...4482.jsonl, stub=e8a72bb9
16:25:53.428Z  LLM_CALL_START       model=default
16:25:53.750Z  LLM_DIAG  openrouter_start  model=anthropic/claude-sonnet-4-5  prompt_chars=18196+228457
16:26:50.315Z  LLM_DIAG  openrouter_result  length=7433  empty=false
                preview="## Decisions\n\n1. **Mixtral replication scaffolding approved**…"
16:26:50.316Z  LLM_DONE             summary_len=7433
16:26:50.333Z  STUB_NOT_FOUND       lines_scanned=1040
16:26:50.334Z  SWAP_COMPLETE
```

**~57 seconds end-to-end.** LLM call to Sonnet-4.5 with a 246k-char prompt (18k system + 228k history). Returned a **clean 7,433-char summary** that begins with structured-looking content (`## Decisions`).

Then the swap step scanned 1,040 lines of the session JSONL looking for the stub marker, didn't find it, logged `STUB_NOT_FOUND`, and immediately marked `SWAP_COMPLETE`. **The rich summary did not get written into the session.**

---

## What's in the session

- **One compaction event at line 1039**, ts `2026-05-12T16:25:53.429Z`, id `9b1cf108`
- **Summary length: 15,994 chars** — much larger than what the LLM returned (7,433)
- **Does NOT start with `[KASETT_STUB`** — old vanilla format
- **Does NOT contain `[THREAD_META]`** — kasett's marker absent
- **DOES contain a ` ```json ` fence at offset 1700** — but it's a literal Telegram metadata block from a quoted user message, not kasett structured output

So the summary in the session is OC's **vanilla** compaction output (the one with verbatim turn quotes that happens to include user-pasted JSON). The LLM's 7.4k summary kasett requested is sitting in the worker's memory, never made it to disk.

---

## Why no sidecar?

The B1 sidecar code is in `dist/` but not loaded into the running OC process. The plugin running in production is the **pre-B1 hot-swap version**. It tried to do the atomic JSONL rewrite (the lock-fight failure mode), missed because the stub had already been processed, and terminated.

**Sidecar file `ce99d917…kasett-meta.jsonl`: does not exist.**

This is the smoking gun for why the strategic-analysis subagent measured 0% rich-replaced compactions across 65 production events. Hot-swap was racing OC and losing.

---

## What this confirms (vs Phase A's hypotheses)

| Hypothesis | Confirmed? |
|---|---|
| Hooks DO fire | ✅ confirmed — `WORKER_START` logged |
| LLM call DOES happen | ✅ confirmed — Sonnet 4.5, 57s, 7.4k chars returned |
| LLM returns substantive output | ✅ confirmed — preview shows structured `## Decisions` content |
| Hot-swap step fails before writing rich summary | ✅ confirmed — `STUB_NOT_FOUND` followed by `SWAP_COMPLETE` (which is misleading — it didn't actually swap anything in) |
| Production session ends up with vanilla OC summary | ✅ confirmed — no `[THREAD_META]`, no kasett markers |

**Phase A diagnosis was correct.** Phase B1 sidecar fix is the right move.

---

## What to expect after OC restart (B1+ activated)

For the next compaction after OC reloads the new plugin code:

1. `WORKER_START` → `LLM_CALL_START` → `LLM_DONE` (same as today)
2. **Instead of** `STUB_NOT_FOUND` / lock-fight: the worker calls `writeSidecarEntry()` and appends to `<session>.jsonl.kasett-meta.jsonl` (no JSONL rewrite, no lock contention)
3. `SIDECAR_WRITTEN` event in hotswap-diag.log (already seen on May 12 16:20 UTC in the test fixture run)
4. `hook-events.jsonl` gets entries for every hook call
5. Sidecar contains rich V3 entry with thread_meta_v2, key_state, lifecycle_events
6. Daily review (next morning) shows `rich-sidecar=1`, `rich-inline=0`, `vanilla=N`

The path is laid. We're waiting on the OC restart to flip the switch.

---

## Bonus finding: the LLM's actual rich summary

The first ~120 chars of what Sonnet 4.5 produced for this compaction:

```
## Decisions

1. **Mixtral replication scaffolding approved** — three corpora (generic, USHA regulatory, family office f…
```

This is the kind of summary the new sidecar will preserve. Note it's structured (markdown headers), not the raw turn-by-turn quote dump that ended up in the session. The LLM CAN produce good summaries when properly steered — the bug has always been that we couldn't get those summaries to land on disk.

---

## Recommendation

1. **Don't immediately restart OC** — current session has too much active context to risk
2. **Run the verification checklist** (`research/phase-b1-verification-checklist.md`) on the next organic compaction *after* the next natural OC restart (config change, container reboot, etc.)
3. **Bookmark this scan** as the "Phase A baseline" — pre-fix, lock-fight fails, 0% rich compliance, but LLM was producing usable output
4. **Run `node scripts/build-global-index.js --agent main`** post-restart once Phase E activates — bootstraps cross-session view from any historical kasett-handled compactions (currently 0, so it'll be a no-op until new compactions land)

---

*Filed: 2026-05-12 16:30 UTC.  Chris triggered the compaction — thanks for the live test.*
