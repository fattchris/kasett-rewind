# Kasett Phases Tracker

Driven by `research/strategic-analysis-2026-05-12.md`. Single source of truth for what's done, in flight, and queued.

**Started:** 2026-05-12

---

## Phase A - VERIFY (observability + reality check)

**Goal:** Confirm whether the kasett hook is actually firing in production before changing schema/code. Build observability so future regressions are visible.

**Status:** ✅ COMPLETE (2026-05-12)

### Tasks
- [x] A1. Audit `entry.summary` vs `entry.data.summary` in real session JSONLs - confirmed top-level `entry.summary`
- [x] A2. Fix daily-review scanner - now distinguishes rich/stub/vanilla via JSON parse over compaction events
- [x] A3. Add structured logging to before_compaction / after_compaction / before_prompt_build / summarize hooks (research/hook-events.jsonl)
- [x] A4. Replay last 7 days through parser offline - compliance rate **0.0%** (0 rich, 10 stub, 24 vanilla)
- [x] A5. Document trigger procedure; existing hotswap-diag.log already provided conclusive evidence
- [x] A6. Findings report `research/phase-a-verification.md`

### Headline result
- **Hooks ARE firing.** LLM calls ARE succeeding (1610-11373 char summaries returned).
- **Atomic file swap is failing** with `LOCK_WAIT_TIMEOUT 30000ms` on every production session. The hot-swap worker waits for OC's session write lock to clear; on active sessions it never does within 30s.
- **Production compliance rate: 0.0%** over 36 compactions / 7 days.

See `research/phase-a-verification.md` for full report and `research/phase-a-replay-report.md` for empirical numbers.

---

## Phase B — Hot-swap durability + Schema v2

**Goal:** First, fix the actual production bottleneck (hot-swap atomic-rewrite never lands because OC holds the session lock). Then layer structured output on top.

**Status:** ✅ COMPLETE (2026-05-12) — B1 + B2 both shipped; pending real-world deploy verification.

### Track 1 — Hot-swap durability (B1) ✅ COMPLETE (2026-05-12)

Fixed the production bottleneck via the sidecar approach. Rich kasett summaries
are now appended to `<session>.jsonl.kasett-meta.jsonl` instead of trying to
rewrite the OC-locked session JSONL.

- [x] B1.1. Choose option (c): sidecar file. Cleanest separation of concerns.
- [x] B1.2. `src/storage/sidecar.ts` — append-only writer/reader/finder
- [x] B1.3. `src/hotswap/worker.ts` rewritten to write to sidecar (no JSONL rewrite)
- [x] B1.4. `src/storage/reader.ts` updated to prefer sidecar, fall back to JSONL
- [x] B1.5. `scripts/daily-compaction-review.sh` — 5-tier status (rich-sidecar, rich-inline, stub, kasett-other, vanilla)
- [x] B1.6. Tests — 11 new sidecar tests, 122/122 passing
- [x] B1.7. `scripts/migrate-to-sidecar.js` — idempotent one-shot migration; dry-run validated
- [x] B1.8. Hook logging — `after_compaction:sidecar_written` / `sidecar_failed`
- [ ] B1.9. Validate post-deploy: confirm sidecar files appear, compliance rate >0 — **PENDING REAL-WORLD VERIFICATION** (per phase-b1-progress.md checklist; tests pass, awaiting next organic compaction event in production)

Detail: `research/phase-b1-progress.md`.

### Track 2 — Schema v2 / structured output (B2) ✅ COMPLETE (2026-05-12)

B1 unblocked B2. The LLM-side compliance bottleneck is now addressed via
v2 schema with explicit JSON output. Path B (JSON-only steering + strict
parser) shipped; Path A (provider-native structured output via tool_use /
response_format) is scaffolded behind a `structuredOutput: 'tool'` flag for
future activation when needed.

- [x] B2.1. Investigate LLM call site, document Path A vs Path B decision (Path B chosen for cross-provider portability; Path A scaffold left for future)
- [x] B2.2. Define v2 schema in `src/threads/schema.ts` (main + structured sub-threads with id/label/status, decisions, open_questions, max 5 subs)
- [x] B2.3. Steering prompt rewritten to demand fenced ```json``` block conforming to v2 schema (with worked example, schema embedded, previousSubIds hint)
- [x] B2.4. `parseCompactionOutputV2` + `parseCompactionOutputBestEffort` in `src/threads/parser.ts` — v2 first, v1 fallback, errors surfaced for diag
- [x] B2.5. Worker integration: `parseCompactionOutputBestEffort` in `src/hotswap/worker.ts`; logs schema_version on each write
- [x] B2.6. Sidecar entry adds optional `thread_meta_v2` and `schema_version` fields; v1 `thread_meta` preserved
- [x] B2.7. Reader prefers v2 over v1; new `readLastNWithMetaV2`, `readLatestMetaV2`; orientation builder `buildOrientationPromptV2` renders status/decisions/open_questions
- [x] B2.8. Weight analyzer: `classifyThreadsV2` (id-based) + `classifyThreadsV1Fallback` (substring) for continuity classification
- [x] B2.9. Tests: 66 new tests across schema/parser-v2/steering-v2/weight-v2 — 188/188 passing (was 122/122 pre-B2)
- [x] B2.10. Migration / co-existence — v1 entries still readable, v2 writes new entries, dual storage in sidecar

---

## Phase C - KeyState sidecar

**Goal:** Track specific values (URLs, IDs, paths, versions, config) explicitly. Address CompactBench Task 2 (KSSR — Key State Survival Rate, previously ~0).

**Status:** ✅ COMPLETE (2026-05-12) — schema v3 + heuristic detector + steering + parser + worker + sidecar + reader + weight + tests + KSSR script + daily review enhancement.

### Decision

Went with the single-schema approach: V3 = V2 + optional `key_state[]` (max 20). One LLM call, one schema, one parser. Backward compat with V2 via projection (`projectV3ToV2` drops the field). V2 entries still readable; V3 entries readable by V2 readers via projection.

### Tasks
- [x] C1. Define KeyState type and v3 schema (`KeyStateEntry`, `ThreadMetaV3`, `THREAD_META_SCHEMA_V3`, `validateThreadMetaV3`, `isValidKeyStateEntry`, `projectV3ToV2`, `MAX_KEY_STATE=20`)
- [x] C2. Heuristic detector at `src/keystate/detector.ts` — URL/ARN/AWS-resource/UUID/path/config/version/model/git-sha with overlap suppression and trailing-punct stripping
- [x] C3. Steering prompt update — v3 schema embedded; detected candidates + previousKeyState as continuity hints; v3 example object inlined; `buildOrientationPromptV3` adds "Recent values" section
- [x] C4. Parser update — `parseCompactionOutputV3`, BestEffort tries v3→v2→v1, all three meta shapes populated via projection chain
- [x] C5. Worker integration — detector runs in `buildCompactionContext` (LLM hint) AND in worker (sidecar `key_state_candidates` for KSSR measurement)
- [x] C6. Sidecar bump — `thread_meta_v3?`, `key_state_candidates?`, `schema_version: 'v1' | 'v2' | 'v3'`, `keyStateCount` + `keyStateDetectedCount` on hook log
- [x] C7. Reader / orientation — `readLatestMetaV3`, `readLastNWithMetaV3`; legacy v1/v2 readers project v3 down via `projectV3ToV2 ∘ projectV2ToV1`
- [x] C8. Weight / continuity — `classifyKeyState` (exact (kind, value) match across window) + `pickContinuityKeyState` helper; same core/fresh/fading taxonomy as sub-threads
- [x] C9. Tests — schema-v3 (15), keystate-detector (24), parser-v3 (10), steering-v3 (10), weight-keystate (12) = 82 new. Total **270/270 pass** (188 prior + 82 new). Two pre-existing tests updated to assert v3 priority (semantically correct: V3 is V2 + optional)
- [x] C10. `scripts/measure-kssr.js` — per-compaction + aggregate KSSR (preserved / detected) plus LLM-added bonus count; smoke-tested
- [x] C11. `scripts/daily-compaction-review.sh` — per-session key_state line + aggregate KeyState section (totals, compactions w/ KS, sessions ≥5, avg per compaction); pointer to measure-kssr.js for per-session KSSR
- [x] C12. Tracker updated

### Headline

Key state is now a first-class structured field in the compaction sidecar. The summary tells the story; `key_state[]` is the evidence list. CompactBench Task 2 (KSSR) becomes measurable per-compaction via `scripts/measure-kssr.js`; expected outcome is high KSSR on kasett-instrumented compactions vs near-0 on vanilla compactions — a publishable result once we collect production data.

### Pending

- **Real-world data:** Sidecar + v3 schema work end-to-end in tests. Production deploy will produce the first organic v3 entries with `key_state_candidates` and `thread_meta_v3.key_state`. Run `measure-kssr.js` against the first few sessions once they accumulate.
- **B1 deploy verification:** Still pending real-world data per `phase-b1-progress.md` checklist (no production sidecar entries yet).

---

## Phase D - Thread Identity

**Goal:** Make sub-thread continuity robust across compactions even when the LLM drops or changes the stable `id`. Multi-tier matcher (exact-id → lexical Jaccard → hash-fingerprint cosine) plus lifecycle event detection for created / completed / blocked / renamed / merged / split.

**Status:** ✅ COMPLETE (2026-05-12) — identity matcher + embedding + lifecycle + steering hints + sidecar field + worker integration + reader + report script + 51 new tests; 321/321 passing.

### Tasks
- [x] D1. `src/threads/identity.ts` — multi-tier matcher (exact-id → lexical → semantic). `IdentityMatch` exposes strategy, confidence, matched_to, evolved.
- [x] D2. Tokenize + Jaccard helpers (in identity.ts) — stopword filter, lowercased alphanumeric splits, defensive empty-set handling.
- [x] D3. `src/threads/embedding.ts` — hash-fingerprint pseudo-embedding using SHA-1-mod-N bit vectors with cosine similarity. Honest about being a heuristic, not a real semantic embedding. No external deps.
- [x] D4. `src/threads/lifecycle.ts` — `detectLifecycleEvents` derives created/completed/blocked/renamed/merged/split from matcher output.
- [x] D5. `src/threads/weight.ts` — `classifyThreadsWithIdentity` walks oldest-first to anchor canonical IDs, classifies as core/fresh/fading/renamed/merged.
- [x] D6. `src/threads/steering.ts` — `recentLifecycle` option threads renames/merges/splits into the steering prompt as continuity hints.
- [x] D7. `src/storage/sidecar.ts` — optional `lifecycle_events` field. Worker computes and stores it at write time using the previous sidecar entry.
- [x] D8. `src/storage/reader.ts` + steering V3 orientation — `readLatestLifecycleEvents` and an optional `recentLifecycle` parameter on `buildOrientationPromptV3` surface recent renames in the orientation context.
- [x] D9. Tests — 51 new across `identity.test.ts`, `embedding.test.ts`, `lifecycle.test.ts`, `weight-identity.test.ts`. Existing 270 still pass. Total: **321/321**.
- [x] D10. `scripts/identity-report.js` — per-session + aggregate lifecycle event counts; rename-rate signal. `scripts/daily-compaction-review.sh` enhanced with a Thread lifecycle section.
- [x] D11. PHASES-TRACKER + phase-d-progress updated; ready for commit.

### Headline

The LLM's stable `id` is the strong path; D adds two fallback tiers so threads survive label drift (Jaccard catches "infra-deploy" → "deploy") and recognize evolution (rename / merge / split as first-class events). Lifecycle events are advisory — if classification is uncertain we omit them rather than guess. Backward compat preserved: V1/V2/V3 sidecars all still read; pre-D entries simply have no `lifecycle_events`.

### Pending real-world data

Worker integration (`hotswap/worker.ts`) is wired and unit-tested. Production sessions will start emitting `lifecycle_events` once kasett re-deploys; identity report will then show real rename-rate per compaction — the quality signal we'll watch for steering effectiveness.

---

## Phase E - Multi-session threads

**Goal:** Threads that span topics/sessions — a feature spanning multiple chats keeps a single canonical identity across them. Builds directly on Phase D's identity machinery, projecting it from per-session to cross-session scope.

**Status:** ✅ COMPLETE (2026-05-12) — global index + cross-session matcher + snapshot + worker integration + V3 orientation hook + 65 new tests; **386/386 passing**.

### Tasks
- [x] E1. `src/global/types.ts` — `GlobalThreadRecord`, `GlobalThreadSnapshot`, `GlobalThreadSummary`, validators with schema-version hooks.
- [x] E2. `src/global/index-writer.ts` — `appendGlobalRecord` (atomic O_APPEND, never throws), `readGlobalRecords` (filters by ts/thread_id/canonical_id/session/agent), file living at `~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.jsonl`.
- [x] E3. `src/global/matcher.ts` — `findCanonicalThread` reuses Phase D's tokenize/jaccard + embedding cosine. Defends against the “deploy” false-positive problem via `minLexicalTokens` (default 3); semantic tier off by default for cross-session due to label sparsity.
- [x] E4. `src/global/snapshot.ts` — `buildSnapshot` groups records by canonical_id with per-session contribution; `writeSnapshot` is atomic temp+fsync+rename; `readSnapshot` returns null on absence/corruption.
- [x] E5. Worker integration (`src/hotswap/worker.ts`) — after sidecar write, batch-resolve canonical_ids for sub-threads + main, append to global index, refresh snapshot. Failures are best-effort (logged via `GLOBAL_INDEX_FAIL`/`GLOBAL_INDEX_ERROR`); per-session sidecar always wins. New `agentId` and `topicName` worker params wired from `index.ts`.
- [x] E6. `src/global/orientation.ts` — `getCrossSessionContext` returns active/blocked threads from OTHER sessions, sorted by recency, capped to topThreads (default 5), 7-day default lookback. Accepts a pre-built snapshot or pre-loaded records for tests.
- [x] E7. `src/threads/steering.ts` — `buildOrientationPromptV3` accepts an optional `crossSessionContext`; renders `## Active threads in other sessions` block with relative-time-ago suffix.
- [x] E8. Tests — 65 new across `global-types`, `global-index-writer`, `global-matcher`, `global-snapshot`, `global-orientation`. All 321 pre-existing tests still pass.
- [x] E9. `scripts/global-thread-report.js` — standalone CLI. Reads index, builds snapshot, prints summary + cross-session work + per-thread detail. Filters: `--status`, `--since 7d`, `--agent`.
- [x] E10. `scripts/daily-compaction-review.sh` — added “Cross-Session Threads” section with global record count, today-bucket counts, and threads spanning ≥2 sessions today (top 5 by spread).
- [x] E11. `scripts/build-global-index.js` — idempotent migration. Walks every existing sidecar, replays sub-threads + main thread into the global index, dedups by `(ts, session_id, thread_id, is_main)`. Resolves canonicals at replay time. `--dry-run` supported.
- [x] E12. PHASES-TRACKER updated.

### Headline

Memory now spans sessions. The global index lives next to the session files (`<sessions>/.kasett-global-threads.jsonl`), is append-only, and is written by the worker after the per-session sidecar succeeds. Reorienting in a fresh session can pull “Active threads in other sessions” from the snapshot, so context that lives in topic-A doesn’t evaporate when you open topic-B.

The cross-session matcher is intentionally conservative: bare 1-2 token labels (“deploy”, “infra”) cannot fire lexical cross-session matches. The LLM’s stable `id` remains the strong path. Lexical kicks in only when the label has ≥3 meaningful tokens. Semantic is opt-in.

### Pending real-world data

- Worker integration is wired and unit-tested. Awaiting the first organic compaction with kasett enabled to populate the production global index. (Same gating as Phase B1 — sidecar + global index both need that first real compaction to land before we can measure.)
- Migration script is ready: `node scripts/build-global-index.js --agent main --dry-run` reports 0 sidecars today (Phase A finding). Once sidecars start landing, this becomes the bootstrap path for retroactive cross-session visibility.
- **Phase B1 verification still pending** — unchanged from prior tracker state.

### Edge cases acknowledged

- **Same label, different work** (`deploy` in topic-A vs topic-B): defended via `minLexicalTokens=3` and exact-id-first ordering. The LLM owns assigning stable ids; if it does, exact-id wins regardless of label drift.
- **Concurrent appends across sessions:** O_APPEND is atomic for our line size; lines never interleave.
- **Snapshot staleness:** worker refreshes snapshot after every batch of writes, so reads of the snapshot file are at most one compaction stale. `getCrossSessionContext` falls back to building from records if the snapshot file is missing.
- **Index growth:** append-only — file grows forever. Future retention policy (archive >30 days) is documented but not implemented; would be a small Phase F task if the file becomes unwieldy.

---

## Phase F — Production bug fixes (post-restart verification)

**Goal:** Fix the three production bugs found during the 2026-05-12 16:35 UTC live verification on topic-12388 (see `research/post-restart-verification.md`). Phases B1, B2, and C were verified working live; F is plumbing repair on top of that win.

**Status:** ✅ COMPLETE (2026-05-12) — max_tokens bumped to 32k, V3 parser tolerates truncated JSON via bracket-balancing repair, sidecar path resolves session-key → UUID, production sidecar recovered with full structured data.

### Tasks
- [x] F1. `compactionMaxTokens` config (default 32000) wired through `KasettConfig` → `resolveConfig` → `LLMCallParams`/`CallLLMParams` → `callOpenRouter`/`callAnthropic`. Both API call sites now honour the explicit value (was hardcoded 4096). Sonnet 4.5 supports 64k output — 32k leaves comfortable headroom for 5 sub-threads + 20 key_state + decisions + open_questions + a 2-3k word prose summary.
- [x] F2. `parseCompactionOutputV3` — strict path tried first; on failure, falls through an open-fence repair pipeline:
  - 2a: open-fence + raw `JSON.parse` (LLM emitted whole JSON but no closing fence)
  - 2b: open-fence + `repairTruncatedJson` (closes unterminated string, drops trailing comma/colon/orphan-key, balances brackets)
  - 2c: open-fence + lenient field-by-field regex extract (`main`/`sub`/`key_state`/`decisions`/`open_questions`)
  - All recovery paths annotate the meta with `_partial: true` and surface a `recovered:*` marker in `errors[]`.
  - New helper: `repairTruncatedJson(text) → { repaired, repairsMade }` is exported for use by the migration script.
- [x] F3. `resolveSessionFilePath(agentRoot, sessionKeyOrPath)` in `src/storage/sidecar.ts`. Worker now resolves the input before computing the sidecar path, so a session-key like `agent:main:telegram:group:-...:topic:12388` lands at `<uuid>-topic-12388.jsonl.kasett-meta.jsonl` (next to the real session file) instead of `<session-key>.jsonl.kasett-meta.jsonl`.
  - Resolution order: existing-path → sessions.json store (by full key + by basename) → topic-id scan (skips `.checkpoint.` files) → exact filename match.
- [x] F4. `scripts/recover-truncated-sidecars.js` (ESM). Idempotent migration: walks every `*.kasett-meta.jsonl`, runs the F2 repair on `summary_rich` for any entry without rich `thread_meta_v3.key_state`, appends a NEW entry with `schema_version: 'v3-recovered'` + `recovered_from`/`recovered_at`/`recovered_via`/`recovered_errors`. `--dry-run` and `--file <path>` supported.
  - **Live result on production sidecar:** 5 sub-threads + **20 key_state entries** (schema max) extracted from the truncated 14,113-char JSON. `decisions` and `open_questions` recovered. The Sonnet 4.5 output that was lost to PARSE_NONE is now structured.
- [x] F5. Tests — 25 new across `parser-repair.test.ts` (15 cases covering `repairTruncatedJson` primitives + `parseCompactionOutputV3` repair paths) and `sidecar-path-resolution.test.ts` (10 cases covering existing-path, sessions.json store, topic-id scan, failure modes). All 386 prior tests still pass. **Total: 411/411 passing.**
- [x] F6. PHASES-TRACKER + phase-f-progress updated.
- [x] F7. `daily-compaction-review.sh` re-run after fixes — see `phase-f-progress.md`.

### Headline

The LLM almost did the right thing on the first live verification. F fixed three mechanical bugs and recovered the lost data:

1. **Token ceiling.** The default 4096-token output cap on the OpenRouter call truncated Sonnet 4.5 mid-string at 14,113 chars. Bumped to 32000 (configurable). Future compactions will not truncate at this volume of structure.
2. **Strict parser.** A truncated JSON has no closing fence, so the parser bailed with `PARSE_NONE`. The new pipeline accepts an open fence and repairs the body via bracket balancing or, when even that fails, lenient field extraction. The 14k summary that was previously dead-stored as `summary_rich` is now structured.
3. **Path resolution.** Session-keys with `:topic:N` suffixes now resolve to the correct `<uuid>-topic-N.jsonl` file, so the sidecar lands where the daily review and global index expect it.

Production sidecar for topic-12388 now contains a `v3-recovered` entry with full structured data alongside the original v1 stub. Backward compat preserved — v1/v2/v3 readers all still function via projection.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-12 | Address phases in order, A first | Don't redesign schema before verifying hook fires |
| 2026-05-12 | Tracker file created | Chris directive: "stat a tracker file and let's hit it" |
| 2026-05-12 | Phase A complete; root cause is `LOCK_WAIT_TIMEOUT` not parser/format/compliance | Diag log evidence: hooks fire, LLM succeeds, atomic-rewrite times out on session lock |
| 2026-05-12 | Phase B scope expanded to include hot-swap durability fix BEFORE schema v2 | Schema v2 doesn't help if nothing reaches storage; durability fix unblocks compliance regardless |
| 2026-05-12 | B2 Path B (JSON steering + strict parser) over Path A (provider-native tool_use) | Cross-provider portability; lower code complexity; closes most of the compliance gap. Path A scaffolded behind `structuredOutput: 'tool'` flag for future activation. |
| 2026-05-12 | sub cap raised 3 → 5 in v2 | Real Clyde infra sessions average 5-8 active sub-threads; cap-at-3 forces information loss. 5 strikes the right balance between completeness and prompt budget. |
| 2026-05-12 | v2 entries store BOTH `thread_meta` (v1 projection) and `thread_meta_v2` in sidecar | Lossy v1 projection keeps legacy readers working without code changes; v2 is the source of truth for new readers. Cheap (\~30% size increase per entry). |
| 2026-05-12 | Phase C: V3 = V2 + optional `key_state[]` (single schema, single parser) over a separate sidecar | Simpler: one LLM call, one fence, one validator. V2 entries remain readable as V3 with `key_state: undefined`; V3 entries readable by V2 readers via `projectV3ToV2`. |
| 2026-05-12 | Detector is heuristic / advisory only — LLM decides what to keep | False positives cost a few prompt tokens; missed values cost continuity. Detector errs toward higher recall and the LLM filters in the structured output. |
| 2026-05-12 | Sidecar stores BOTH `key_state_candidates` (detected) AND `thread_meta_v3.key_state` (preserved) | Required for empirical KSSR measurement: KSSR = preserved∩detected / detected. Without storing the candidate set we can't reproduce the metric after the fact. |
| 2026-05-12 | Phase D: hash-fingerprint pseudo-embedding instead of a real semantic model | Zero external deps. Honest heuristic. Catches drift exact-id and Jaccard miss. If we later need real semantics, the public API (`fingerprint`, `fingerprintCosine`) is small enough to swap. |
| 2026-05-12 | Lifecycle events advisory-only — detector failure logged but never blocks sidecar write | Continuity hints are useful when correct, but never worth dropping the actual rich summary over. False positives at this layer cost a few prompt tokens; missed rich summaries cost everything. |
| 2026-05-12 | classifyThreadsWithIdentity walks OLDEST-first to anchor canonical IDs | Canonical id = oldest known id for the chain. Stable across multiple compactions even if the LLM drifts every step. The tracker.label tracks the newest label for display. |
| 2026-05-12 | Phase E global index lives at `~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.jsonl` | Same dir as session files, dot-prefixed so it doesn’t collide with OC’s session glob. Append-only — multiple sessions can write concurrently and POSIX `O_APPEND` keeps lines whole. Snapshot file is atomic temp+rename so readers never see torn JSON. |
| 2026-05-12 | Cross-session lexical matcher requires ≥3 meaningful tokens; semantic tier off by default | Defends against “deploy” in topic-A merging into “deploy” in topic-B. The LLM’s stable `id` is the strong cross-session path; fuzz-matching short labels across topics is far worse than under-matching. If two topics genuinely share a thread, the LLM has the context to use the same `id`. |
| 2026-05-12 | Global indexing failures are best-effort, never block the per-session sidecar write | Phase A lesson: any cross-cutting failure that propagates up the worker can mask a successful sidecar write. The global index is a derived layer; if it can’t write, log `GLOBAL_INDEX_FAIL` and continue. |
| 2026-05-12 | Phase F: V3 parser must repair truncated JSON, not reject it | Sonnet 4.5 produced 14k chars of structured output that PARSE_NONE’d only because the closing fence was lost to max_tokens. The content is the value; truncation is a plumbing problem. Bracket-balancing repair + lenient extract turn truncated input into salvaged structure. |
| 2026-05-12 | Phase F: `compactionMaxTokens` defaults to 32000 (vs prior hardcoded 4096) | Production evidence shows 5-sub + 20-key_state + decisions + open_questions + 2-3k word prose regularly exceeds 14k chars (~5k tokens). 32k leaves headroom up to ~12k tokens of output — well clear of the failure mode. Sonnet 4.5 supports 64k; we deliberately sit below the ceiling. |
| 2026-05-12 | Phase F: sidecar path resolves via `sessions.json` store first, topic-id scan second | The compaction hook gives kasett a session-key (`agent:main:...:topic:N`), but session JSONLs are named `<uuid>-topic-N.jsonl`. Strategy 1 reads sessions.json directly (most reliable). Strategy 2 scans for `*-topic-<id>.jsonl` files (skipping checkpoints) and picks the newest. Strategy 4 returns null instead of fabricating a path — a missing sidecar is better than one in the wrong place. |
| 2026-05-12 | Phase F: recovery script appends `v3-recovered` entries, never modifies originals | Provenance preserved — the original truncated entry is left intact for future audit. The recovered entry carries `recovered_from` (original stub_id), `recovered_at`, `recovered_via` (which schema path matched), and `recovered_errors` (validator messages). Idempotent: re-runs are no-ops once a stub has been recovered. |

---

## Open Questions (carried from strategic analysis)

1. ~~Is the CompactionProvider hook actually being invoked in production?~~ **YES - confirmed by Phase A.**
2. ~~If hook fires, is the LLM ignoring the [THREAD_META] format?~~ **No - LLM produces substantive output (1.6-11.4k chars).**
3. ~~If LLM emits [THREAD_META], is the parser failing?~~ **No - parser succeeds on 80% of inputs containing the marker; the 20% are conversation transcripts not actual kasett output.**
3a. **(NEW)** If hook fires, LLM succeeds, parser works - why is production compliance 0%? **Hot-swap atomic rewrite times out on OC's session lock.** (Phase A new finding.)
4. What's the right cap on sub-threads - 3, 5, dynamic?
5. Should kasett be one plugin or split (thread tracking + key state + identity = 3 plugins)?
