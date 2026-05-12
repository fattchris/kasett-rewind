# Phase F Progress — Production Bug Fixes

**Started:** 2026-05-12 16:50 UTC

## Subtask Status

| ID | Description | Status |
|---|---|---|
| F1 | Bump max_tokens (configurable, default 32k) | ✅ done |
| F2 | Tolerant V3 parser with bracket-balancing repair | ✅ done (386/386 pre-F tests still pass) |
| F3 | Sidecar path resolution (session-key → UUID) | ✅ done |
| F4 | Migration script: recover truncated sidecars | ✅ done. Dry-run on production fixture extracted 5 sub-threads + 20 key_state entries (schema max). |
| F5 | Tests (parser-repair, sidecar-path-resolution) | ✅ done. 411/411 pass (386 prior + 25 new). |
| F6 | Update PHASES-TRACKER.md | ✅ done |
| F7 | Verify B1 checklist post-fixes | ✅ done. Daily review now reports `rich=1, key_state=20` for topic-12388 (was `rich=0, stub=1`). End-to-end recovery confirmed. |

## Live Notes
- Production sidecar fixture: `/home/node/.openclaw/agents/main/sessions/agent:main:telegram:group:-1003723465246:topic:12388.jsonl.kasett-meta.jsonl` (1 line, 17219 bytes, schema=v1, summary=14113 chars). Last value cut off mid-string at `"label": "Estimated cost for ` — confirms the truncation hypothesis.
- Tests baseline (pre-F): 386 passing per PHASES-TRACKER.
- **Tests post-F: 411 passing.** (+15 parser-repair, +10 sidecar-path-resolution)
- Build: `npm run build` (tsc + copy fixtures). Test: `npm test`.

## Verification Outcome

**Recovery on production sidecar (live, not dry-run):**
```
recovered=1 already=0 errors=0 skipped=0
+ da3ebb43-dd0e-47e4-a988-0e8255ee2921: v3 sub=5 key_state=20
```

**Daily review re-run after fix:**
```
Compacted: 2 | Kasett: 2 (rich=1 stub=1) | Vanilla: 0
... key_state: 20 across 1 compactions (max 20)
... Main: Producing a 7-document research package to launch USHA-for-AI, a fiduciary
    AI certification body for regulated industries
```

The truncated 14k-char Sonnet 4.5 summary that previously dead-stored as raw `summary_rich` (schema=v1, key_state=0) now exists as a `v3-recovered` entry alongside the original. **5 sub-threads, 20 key_state entries (schema max), 3 decisions, 3 open_questions** all preserved. The original v1 stub is untouched for audit.

**Note on bug-2 (sidecar path).** The fixed worker code will land sidecars correctly going forward. The existing production sidecar was at the wrong path due to the original bug; I copied (not moved — keeps original) it to the correct UUID-named path so the daily review picks it up. Future compactions on this session will append to the UUID-named sidecar via the F3-fixed code.

## Files Changed
- `src/types.ts` — added `compactionMaxTokens` to `KasettCompactionConfig` (default 32000)
- `src/index.ts` — wired `compactionMaxTokens` through `resolveConfig`, `LLMCallParams`, `callLLMForCompaction`, `callOpenRouter`, `callAnthropic`, and the worker invocation
- `src/hotswap/worker.ts` — accepts `compactionMaxTokens`; resolves session-key-style `sessionFile` to real path via new helper before sidecar write
- `src/storage/sidecar.ts` — new `resolveSessionFilePath(agentRoot, sessionKeyOrPath)` helper with sessions.json store + topic-id-scan + filename strategies
- `src/threads/parser.ts` — new `repairTruncatedJson` helper; `parseCompactionOutputV3` now has open-fence repair pipeline (raw → repaired → lenient)
- `src/cli/generate-config.ts` — default config gen includes `compactionMaxTokens`
- `src/tests/parser-repair.test.ts` — NEW (15 tests)
- `src/tests/sidecar-path-resolution.test.ts` — NEW (10 tests)
- `scripts/recover-truncated-sidecars.js` — NEW idempotent migration script (ESM)
- `package.json` — test script updated to include new test files
- `research/PHASES-TRACKER.md` — Phase F section + decision log entries
- `research/phase-f-progress.md` — this file


