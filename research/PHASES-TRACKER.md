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

**Goal:** Track specific values (URLs, IDs, paths, versions) explicitly. Address CompactBench KSSR (currently ~0).

**Status:** 🔵 NEXT (B2 unblocks C)

### What B2 revealed about C

With v2 schema in place we now have a typed `decisions[]` and `open_questions[]`
field, plus stable sub-thread `id`s. KeyState (Phase C) can plug into the
same structured-output path:

- Add a top-level `key_state[]` to v2 schema as the v3 increment, OR
- Add a parallel sidecar `*.kasett-keystate.jsonl` that the LLM populates on
  the same compaction call (single LLM call, two structured outputs)

Leaning toward the former (single schema, single output, single parser) for
simplicity. Only escalate to a separate sidecar if KeyState volume bloats v2
entries beyond ~5KB.

### Tasks (preview)
- [ ] C1. Define KeyState type: `{ kind: 'url'|'id'|'path'|'version'|'config', value: string, label?: string }`
- [ ] C2. Detect candidate values in pre-compaction messages (regex pass)
- [ ] C3. Steering prompt addition: "preserve these specific values"
- [ ] C4. Storage: separate keystate field on compaction event
- [ ] C5. context_load injection: re-surface key values

---

## Phase D - Thread Identity (embedding-based continuity)

**Goal:** Replace 50% substring matching with embedding-based similarity for thread evolution tracking.

**Status:** ⏸ QUEUED

### Tasks (preview)
- [ ] D1. Add stable LLM-supplied IDs to sub-threads (best fix; cheap)
- [ ] D2. Optional: local embedding for similarity backup
- [ ] D3. Thread merge / split detection
- [ ] D4. Sub-thread lifecycle (created/active/blocked/completed)

---

## Phase E - Multi-session threads

**Goal:** Threads that span topics/sessions (e.g., a feature spanning multiple chats).

**Status:** ⏸ QUEUED

### Tasks (preview)
- [ ] E1. Cross-session thread index
- [ ] E2. Migration when topics merge
- [ ] E3. Aggregation views

---

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

---

## Open Questions (carried from strategic analysis)

1. ~~Is the CompactionProvider hook actually being invoked in production?~~ **YES - confirmed by Phase A.**
2. ~~If hook fires, is the LLM ignoring the [THREAD_META] format?~~ **No - LLM produces substantive output (1.6-11.4k chars).**
3. ~~If LLM emits [THREAD_META], is the parser failing?~~ **No - parser succeeds on 80% of inputs containing the marker; the 20% are conversation transcripts not actual kasett output.**
3a. **(NEW)** If hook fires, LLM succeeds, parser works - why is production compliance 0%? **Hot-swap atomic rewrite times out on OC's session lock.** (Phase A new finding.)
4. What's the right cap on sub-threads - 3, 5, dynamic?
5. Should kasett be one plugin or split (thread tracking + key state + identity = 3 plugins)?
