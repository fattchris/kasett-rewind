# Phase E Progress — Cross-Session Threads

**Started:** 2026-05-12

Building cross-session continuity: threads can now be matched across session boundaries via a global index living next to the per-session sidecars.

## Architecture

- **Global index file:** `~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.jsonl` (append-only)
- **Snapshot file:** `.kasett-global-threads.snapshot.json` (atomic temp+rename)

The index records every sub-thread observation as a `GlobalThreadRecord`. The snapshot is a derived, periodically-rebuilt projection of the index into a per-canonical-thread view.

## Subtasks

- [x] E1 — `src/global/types.ts`: types + validators
- [x] E2 — `src/global/index-writer.ts`: append + read
- [x] E3 — `src/global/matcher.ts`: cross-session matcher (defends against bare-label false positives via minLexicalTokens=3)
- [x] E4 — `src/global/snapshot.ts`: snapshot builder + atomic write + lazy read
- [x] E5 — `src/hotswap/worker.ts`: integrate global index writes — sub-threads + main thread, snapshot refresh after every batch
- [x] E6 — `src/global/orientation.ts`: cross-session context for current session
- [x] E7 — `src/threads/steering.ts`: orientation V3 accepts CrossSessionContext, renders "Active threads in other sessions"
- [x] E8 — Tests: 65 new across global-types/global-index-writer/global-matcher/global-snapshot/global-orientation. All 321 existing tests still pass. **386/386 passing.**
- [x] E9 — `scripts/global-thread-report.js` standalone CLI: total active, cross-session spread, per-thread detail; `--status`, `--since 7d`, `--agent` filters.
- [x] E10 — `scripts/daily-compaction-review.sh` adds Cross-Session Threads section: global record count, today-bucket counts, top threads by session-spread.
- [x] E11 — `scripts/build-global-index.js` idempotent migration; dedup by `(ts, session_id, thread_id, is_main)`; resolves canonicals at replay; `--dry-run` supported. Tested clean against current empty fleet.
- [x] E12 — PHASES-TRACKER updated; Phase E marked complete; decision log entries added; B1 verification gate flagged as still pending.

## Test counts

- Pre-Phase E: 321/321
- Phase E new: 65 across `global-types` (16), `global-index-writer` (12), `global-matcher` (16), `global-snapshot` (15), `global-orientation` (10) — actual count by `node --test`: 65 new tests, 19 new suites.
- **Total: 386/386 passing.**
- TypeScript compiles clean with `npx tsc` (strict mode, no errors).

## Edge cases addressed

- **Same label different work (“deploy”):** matcher defaults `minLexicalTokens=3` so bare labels can’t cross-merge. Semantic tier is off by default for cross-session.
- **Concurrent appends:** O_APPEND atomicity; lines never interleave.
- **Snapshot staleness:** worker refreshes after each batch; reader falls back to building from records when snapshot file is missing.
- **Index growth:** append-only by design. Future retention policy noted in tracker but not implemented (premature for current scale).
