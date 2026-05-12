# Phase C — KeyState sidecar (progress)

**Started:** 2026-05-12
**Status:** ✅ COMPLETE (2026-05-12)

Phase C makes specific values (URLs, IDs, paths, versions, config strings) a first-class structured field in the compaction sidecar. Direct response to CompactBench Task 2 (KSSR — Key State Survival Rate).

## Architectural decision

Add `key_state[]` as an optional top-level field to the existing v2 thread-meta schema, calling the result schema **v3**. Backward compat with v2 is preserved (the field is optional and omitted by default). Single LLM call, single schema, single parser; no separate sidecar file.

## Tasks

- [x] C1 — Define KeyState type and v3 schema in `src/threads/schema.ts` (KeyStateKind, KeyStateEntry, ThreadMetaV3, THREAD_META_SCHEMA_V3, isValidKeyStateEntry, validateThreadMetaV3, projectV3ToV2). MAX_KEY_STATE=20.
- [x] C2 — Heuristic detector at `src/keystate/detector.ts` (URL/ARN/AWS-resource/UUID/path/config/version/model/git-sha with overlap-suppression and trailing-punct stripping)
- [x] C3 — Steering prompt update for `key_state[]` (schema v3 embedded; detected candidates and previousKeyState carry-forward both surfaced; V3 example object inlined). Added `buildOrientationPromptV3` with "Recent values" rendering.
- [x] C4 — Parser update for v3 (`parseCompactionOutputV3`, BestEffort updated to try v3→v2→v1, projectV3ToV2 + projectV2ToV1 chain populates all three meta shapes)
- [x] C5 — Worker integration: detector runs in `buildCompactionContext` (hint to LLM) AND in worker (for sidecar `key_state_candidates` storage). Schema v3 parsed; `thread_meta_v3`, `key_state_candidates`, `schema_version: 'v3'` written to sidecar.
- [x] C6 — Sidecar schema bump: `thread_meta_v3?` and `key_state_candidates?` fields, `schema_version: 'v1' | 'v2' | 'v3'`, `keyStateCount`/`keyStateDetectedCount` on `onSidecarWritten` callback (logged via `logHookEvent` detail).
- [x] C7 — Reader / orientation update: `readLatestMetaV3`, `readLastNWithMetaV3`; existing v1/v2 readers project v3→v2→v1; `parseLine` tries v3 fence first; `buildOrientationPromptV3` already added in C3.
- [x] C8 — Weight / continuity for key state: `classifyKeyState` (exact (kind,value) match across window) + `pickContinuityKeyState` helper. Same core/fresh/fading taxonomy as sub-threads.
- [x] C9 — Tests: schema-v3 (15), keystate-detector (24), parser-v3 (10), steering-v3 (10), weight-keystate (12). Total 270/270 pass (188 prior + 82 new). Two pre-existing tests updated to assert v3 priority and v3 schema embed (semantically correct since V3 is V2+optional).
- [x] C10 — `scripts/measure-kssr.js`: per-compaction + aggregate KSSR (preserved / detected) plus LLM-added bonus count. Smoke-tested with synthetic sidecar (60% aggregate, 1 LLM-added).
- [x] C11 — `scripts/daily-compaction-review.sh`: per-session key_state line, aggregate KeyState section (totals, compactions with KS, ≥5 sessions, avg/compaction). Pointer to `measure-kssr.js` for per-session KSSR. Bash syntax check passes.
- [x] C12 — PHASES-TRACKER.md updated: Phase C marked complete with full task breakdown; Phase D promoted to NEXT with refined task list; decision log entries added for V3-as-superset, advisory detector, and dual-store rationale.

## Notes
