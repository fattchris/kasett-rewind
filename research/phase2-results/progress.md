# Phase 2 — Validator Lenient-Truncate Fix + Tier-4 Rerun + Paper Draft

Subagent kicked off 2026-05-12 19:15 UTC.

## ITEM 1 — Validator lenient-truncate fix ✅
- Refactored `src/threads/schema.ts`:
  - `validateThreadMetaV2` accepts `{ mode: 'strict' | 'lenient' }` option, defaults to **strict** (preserves all 411 existing tests).
  - `validateThreadMetaV2Strict` / `validateThreadMetaV2Lenient` aliases for explicit call sites.
  - `validateThreadMetaV3` now defaults to **lenient** — oversized arrays truncated to cap, `_truncated_<field>: true` flag set instead of rejecting.
  - `validateThreadMetaV3Strict` available for ingestion tests / compliance reporting.
  - Type errors (wrong type, missing required, invalid status enum) STILL hard-fail in both modes.
- New test file: `src/tests/schema-truncate.test.ts` — 23 tests covering V2 lenient/strict, V3 lenient/strict, key_state truncation, multi-flag stacking, type-error hard-fail, and a realistic Tier-4 LLM payload regression.
- Total tests: **434/434 pass** (411 existing + 23 new). `tsc --noEmit` clean.
- Commit: `4a42da9` pushed to main.

## ITEM 2 — Re-run Tier 4 after fix ✅
- Built `research/phase2-results/run-benchmark-tier4-rerun.mjs` (same harness shape as `run-benchmark-v2.mjs`).
- Re-ran 5 Tier-4 sessions with lenient validator (~7 minutes, 10 LLM calls).
- Headline: **Tier 4 compliance 40% → 100%**, **Tier 4 SY 9.00 → 23.20**, **overall SY 13.47 → 18.20**.
- Mechanism: 3/5 Tier-4 sessions (11, 12, 15) had `sub[]` truncated. Sessions 11/12/15 went from PARSE_FALLBACK SY=0 to PARSE_OK SY=20-29.
- Outputs: `tier4-rerun-results.json`, `tier4-rerun-summary.md`.
- Commit: `45af114` pushed to main.

## ITEM 3 — Paper-ready writeup
- [ ] In progress: drafting `PAPER-1-DRAFT.md`
[2026-05-12T19:22:40.226Z] [tier4-rerun] Loading original results.json for Tier 1-3 carryover
[2026-05-12T19:22:40.230Z] [tier4-rerun] Re-running 5 Tier-4 fixtures with lenient validator
[2026-05-12T19:22:40.231Z] [tier4-rerun] [1/5] session-11 (Tier 4, 120 turns, 8 threads, 25 key state)
[2026-05-12T19:22:58.642Z] [tier4-rerun]   session-11 vanilla: TRR=0.500 KSSR=0.920 (18411ms)
[2026-05-12T19:23:31.252Z] [tier4-rerun]   session-11 kasett: TRR=0.625 KSSR=0.880 SY=29 status=PARSE_OK truncated={"sub":true,"key_state":false,"decisions":false,"open_questions":false} (30605ms)
[2026-05-12T19:23:33.253Z] [tier4-rerun] [2/5] session-12 (Tier 4, 100 turns, 6 threads, 20 key state)
[2026-05-12T19:23:44.438Z] [tier4-rerun]   session-12 vanilla: TRR=0.833 KSSR=1.000 (11184ms)
[2026-05-12T19:24:04.746Z] [tier4-rerun]   session-12 kasett: TRR=0.833 KSSR=0.900 SY=20 status=PARSE_OK truncated={"sub":true,"key_state":false,"decisions":false,"open_questions":false} (18305ms)
[2026-05-12T19:24:06.748Z] [tier4-rerun] [3/5] session-13 (Tier 4, 150 turns, 10 threads, 30 key state)
[2026-05-12T19:24:20.219Z] [tier4-rerun]   session-13 vanilla: TRR=0.700 KSSR=0.967 (13470ms)
[2026-05-12T19:24:43.085Z] [tier4-rerun]   session-13 kasett: TRR=0.600 KSSR=0.900 SY=24 status=PARSE_OK truncated={"sub":false,"key_state":false,"decisions":false,"open_questions":false} (20863ms)
[2026-05-12T19:24:45.086Z] [tier4-rerun] [4/5] session-14 (Tier 4, 80 turns, 5 threads, 15 key state)
[2026-05-12T19:24:54.539Z] [tier4-rerun]   session-14 vanilla: TRR=0.600 KSSR=1.000 (9452ms)
[2026-05-12T19:25:13.860Z] [tier4-rerun]   session-14 kasett: TRR=0.600 KSSR=1.000 SY=20 status=PARSE_OK truncated={"sub":false,"key_state":false,"decisions":false,"open_questions":false} (17320ms)
[2026-05-12T19:25:15.862Z] [tier4-rerun] [5/5] session-15 (Tier 4, 110 turns, 7 threads, 22 key state)
[2026-05-12T19:25:28.186Z] [tier4-rerun]   session-15 vanilla: TRR=0.571 KSSR=0.909 (12323ms)
[2026-05-12T19:25:49.891Z] [tier4-rerun]   session-15 kasett: TRR=0.857 KSSR=0.864 SY=23 status=PARSE_OK truncated={"sub":true,"key_state":false,"decisions":false,"open_questions":false} (19702ms)
[2026-05-12T19:25:49.898Z] [tier4-rerun] Wrote tier4-rerun-results.json
[2026-05-12T19:25:49.899Z] [tier4-rerun] Wrote tier4-rerun-summary.md
[2026-05-12T19:25:49.899Z] [tier4-rerun] === TIER 4 RERUN COMPLETE ===
