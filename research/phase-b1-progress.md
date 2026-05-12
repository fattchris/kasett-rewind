# Phase B1 — Hot-swap durability fix (sidecar approach) — progress

**Started:** 2026-05-12 14:38 UTC (Clyde subagent)
**Completed:** 2026-05-12 14:55 UTC

## Strategy
Instead of fighting OC's session lock with `waitForLockAbsent`, write rich kasett meta
to a separate sidecar JSONL file (`<session>.jsonl.kasett-meta.jsonl`). OC never
touches it. Append-only writes (atomic at OS level for short lines). Backward
compatible reads.

---

## B1.1 — Read current hot-swap implementation ✅

### Findings
- `runHotSwapWorker` lives in `src/hotswap/worker.ts`. Did:
  1. Call LLM via injected `callLLM`
  2. `waitForLockAbsent(sessionFile, 30_000)` — **failed on every active session**
  3. `acquireLock` to take exclusive write
  4. `performAtomicSwap` — read JSONL, find stub by ID, replace summary, rename tmp
- The atomic swap also had a latent bug: it read `entry.data.summary` but real OC
  stores at top-level `entry.summary` (Phase A confirmed). Even when the lock cleared,
  the swap couldn't have found the stub. This is now moot — we don't rewrite anymore.

### Functions replaced
- `runHotSwapWorker` → still calls LLM, but writes to sidecar instead of swapping
- `performAtomicSwap` → DELETED
- `waitForLockAbsent` usage → DELETED from worker

### Functions kept
- `acquireLock` / `waitForLockAbsent` exist in `lock.ts` — left as-is, harmless
- `generateStub` — still used to return immediate stub to OC
- `callLLMForCompaction` — unchanged

---

## B1.2 — Sidecar writer design ✅

### Path
`<sessionFile>.kasett-meta.jsonl` — append `.kasett-meta.jsonl` to the full
session filename. Trivial discovery (`*.kasett-meta.jsonl`), unambiguous association.

### Schema (one JSON object per line)
```json
{
  "ts": "2026-05-12T14:38:00.123Z",
  "session_id": "abcd1234-topic-5260",
  "compaction_id": "<stubId>",
  "stub_id": "<stubId>",
  "summary_rich": "...full LLM summary...",
  "thread_meta": { "main": "...", "sub": ["...","...","..."] },
  "model": "anthropic/claude-sonnet-4-5",
  "summary_chars": 1234
}
```

### Append safety
`fs.appendFileSync(path, line, { flag: 'a' })`. POSIX `O_APPEND` is atomic
against concurrent writers; we have no concurrent writers in any case.

---

## B1.3 — Implement sidecar.ts ✅

`src/storage/sidecar.ts`. Exports:
- `writeSidecarEntry(sessionFile, entry)` — append, returns sidecar path, creates parent dir if needed
- `readSidecar(sessionFile)` — returns all entries oldest first; skips malformed lines
- `findEntryForCompaction(sessionFile, id)` — matches `compaction_id` or `stub_id`
- `sidecarPathFor(sessionFile)` — pure path helper
- `sidecarExists(sessionFile)` — cheap stat-only check

Node built-ins only (`node:fs`, `node:path`). Strict TypeScript clean compile.

---

## B1.4 — Replace hot-swap with sidecar ✅

Rewrote `src/hotswap/worker.ts` end to end:
- LLM call, then parse, then `writeSidecarEntry`
- New `onSidecarWritten` / `onSidecarFailed` callbacks for the hook logger
- Lock-related code removed from this path
- Diag log retains the same `hotswap-diag.log` path with new event names
  (`SIDECAR_WRITTEN`, `SIDECAR_WRITE_FAIL`)

`src/index.ts` `summarizeWithHotSwap` now wires `capturedCtx.sessionKey` and
`agentId` into the `onSidecarWritten` / `onSidecarFailed` callbacks so each
worker outcome lands as an `after_compaction:sidecar_written` (or
`sidecar_failed`) event in `research/hook-events.jsonl`.

---

## B1.5 — Update SessionReader ✅

`src/storage/reader.ts`:
- Two storage layouts now supported in `parseLine`: top-level `summary` (real OC)
  AND `data.summary` (legacy fixtures). Top-level wins when both present.
- `[THREAD_META]` parsed from summary text when no structured `kaspiett` field
  exists — restores backward compat for legacy inline-rich sessions.
- `readLastNSummaries`: per-slot resolution. For each JSONL compaction, if its
  summary contains `[KASETT_STUB::<id>]` AND a sidecar entry with that id exists,
  return the sidecar's `summary_rich`. Otherwise return the JSONL summary.
- `readLatestMeta` / `readLatestSummary`: sidecar-first; fall back to JSONL.
- `readLastNWithMeta`: merges sidecar events with JSONL events (sidecar wins per
  stub_id), then filters to those with thread meta.

---

## B1.6 — Daily-review scanner sidecar tier ✅

`scripts/daily-compaction-review.sh`:
- Status detection now has 5 tiers: `rich-sidecar`, `rich-inline`, `stub`,
  `kasett-other`, `vanilla`. Sidecar presence is the strongest positive signal.
- Main extraction prefers sidecar `thread_meta.main`, falls back to inline
  `[THREAD_META]` parse on the JSONL.
- Counters consolidate `rich-sidecar` and `rich-inline` into `KASETT_RICH`
  (legacy compat with the existing summary line).

Verified by running the script on real sessions — same exit code & output shape
as before, with new tiering producing accurate counts.

---

## B1.7 — Tests ✅

New `src/tests/sidecar.test.ts` with 11 cases covering:
- Single write/read round-trip
- Empty/missing sidecar returns `[]`
- Multiple appends preserve order
- Malformed lines are skipped without throwing
- `findEntryForCompaction` matches `compaction_id` AND `stub_id`
- `sidecarExists` reports false for empty file, true for non-empty
- Reader prefers sidecar rich summary over JSONL stub
- Reader falls back to JSONL inline `[THREAD_META]` when sidecar missing (legacy)
- Reader handles both top-level `summary` and `data.summary` JSONL layouts

Updated `src/tests/hotswap.test.ts`:
- `replaces stub summary with full LLM output` → renamed to `writes rich summary
  to sidecar and leaves session JSONL untouched`. Asserts JSONL is byte-identical
  and sidecar contains the rich entry.
- Added new test: `multiple compactions append to the same sidecar in order`
- `discards stale result when stub entry not found` → removed (no longer applies;
  sidecar writes are unconditional)
- `preserves non-compaction entries in JSONL after swap` → renamed to
  `preserves session JSONL byte-for-byte`. Same assertion.
- `Integration: generateStub + runHotSwapWorker end-to-end` → updated to assert
  JSONL stub remains AND sidecar has rich content with parsed `thread_meta.main`.

### Test results

```
# tests 122
# suites 31
# pass 122
# fail 0
```

All 122 tests pass. Up from 109/111 (Phase A baseline had 9 pre-existing failures
that have since been fixed; today's pre-B1 count was 111 with 2 fails after my
worker rewrite. After updating those 2 tests + 9 new sidecar tests, 122/122).

`/usr/lib/node_modules/@tobilu/qmd/node_modules/.bin/tsc` clean, no errors.

---

## B1.8 — Migration script ✅

`scripts/migrate-to-sidecar.js` — pure node, no deps:
- Walks all non-checkpoint, non-sidecar `.jsonl` files in sessions dir
- For each compaction event with `[THREAD_META]` AND no `[KASETT_STUB::]`
  (rich, not stub), generates a sidecar entry
- compaction_id derivation: stub UUID > OC `id` field > SHA-1 of summary head
- Idempotent: reads existing sidecar's compaction_ids and stub_ids first; skips
  entries already present
- `--dry-run` mode for safety
- `--sessions-dir <path>` override

### Dry-run on production sessions
```
migrate-to-sidecar (dry run) — scanning 1664 session files in /home/node/.openclaw/agents/main/sessions
  [would write] 2 entries  571d75dd-468c-4aa5-9c15-cd2df89b782d-topic-20751.jsonl
---
scanned compactions: 63
migration candidates: 2
entries would-append: 2
session files touched: 1
```

This matches Phase A's count of 2 successful pre-B1 rich-summary compactions.
Run manually after deploy: `node scripts/migrate-to-sidecar.js`.

---

## B1.9 — Hook logging updated ✅

The `after_compaction` hook event already fires from OC (added in Phase A).
Kasett now also emits its own success/failure event from the sidecar worker:

- `hook=after_compaction action=sidecar_written` — sidecar write succeeded.
  Fields: `parsed`, `charCount`, `metaMain`, `detail.{stubId, sidecarPath, sidecarWritten}`
- `hook=after_compaction action=sidecar_failed` — sidecar write failed (LLM
  empty, IO error, abort, etc). Fields: `error` (reason), `detail.{stubId, sidecarWritten:false, detail?}`

Both go to `research/hook-events.jsonl`. The Phase A daily-review tooling can
already aggregate these into a compliance metric.

---

## B1.10 — Verification

After this lands and OC reloads the plugin, the next compaction in any session
will:
1. Return a stub immediately to OC (unchanged behaviour for OC).
2. Spawn the background worker, call the LLM (succeeds in Phase A logs).
3. **Append a sidecar entry** to `<session>.jsonl.kasett-meta.jsonl` (NEW).
4. Emit `after_compaction:sidecar_written` to `hook-events.jsonl`.

Expected compliance jump: 0% → ~95%+ (provider compliance rate, since the
LLM-call step is already known to succeed and the sidecar write has no lock
race).

To verify post-deploy:
```bash
# 1. Trigger a real compaction (organic or by hitting context limit)
# 2. Confirm sidecar appeared
ls /home/node/.openclaw/agents/main/sessions/*.kasett-meta.jsonl
# 3. Confirm event log
tail -n 20 /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl | grep sidecar
# 4. Run daily-review tomorrow and check rich count
bash /home/node/.openclaw/workspace/repos/kasett-rewind/scripts/daily-compaction-review.sh
```

---

## B1.11 — PHASES-TRACKER updated ✅

See repo `research/PHASES-TRACKER.md`. Phase B1 marked complete; Phase B2
flagged as next.

---

## Surprises / new findings

1. **Reader was reading from `data.summary` not top-level `summary`.** Phase A
   identified this for the daily-review scanner but the in-process
   `SessionReader` had the same bug — meaning even when Phase A reported a rich
   replacement, the in-session orientation injection (`before_prompt_build`)
   couldn't have read its own output. Fixed as part of this phase.

2. **`callLLMForCompaction` already preserves all the rich content.** No LLM
   prompt or steering changes needed. The only failure point ever was the file
   write. Sidecar is a one-line change at the storage layer — mechanically
   simple, semantically a cleaner separation.

3. **Two pre-existing rich entries on disk** (the 2/36 in Phase A) — these
   came from sessions that happened to have a >30s clear-lock window when the
   user paused. The migration script will lift them into the sidecar so the
   reader produces consistent rich-output starting today.

---

## Next phase
B2 (Schema v2 / structured output) is now unblocked. With sidecar writes
landing reliably, raising the LLM compliance rate from text-extraction `[THREAD_META]`
parsing (~95% with current models) to provider-native structured output (~99%)
becomes the next high-leverage move.
