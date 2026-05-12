# Kasett Phases Tracker

Driven by `research/strategic-analysis-2026-05-12.md`. Single source of truth for what's done, in flight, and queued.

**Started:** 2026-05-12

---

## Phase A — VERIFY (observability + reality check)

**Goal:** Confirm whether the kasett hook is actually firing in production before changing schema/code. Build observability so future regressions are visible.

**Status:** 🟡 IN PROGRESS

### Tasks
- [ ] A1. Audit `entry.summary` vs `entry.data.summary` in real session JSONLs — confirm where kasett's output actually lands
- [ ] A2. Fix daily-review scanner to read the correct path (was blind to production output)
- [ ] A3. Add structured logging to before_compaction / after_compaction hooks (timestamps, session, parsed-or-not, char counts)
- [ ] A4. Replay last 7 days of compactions through the parser offline → produce compliance rate report
- [ ] A5. Manually trigger one compaction in a controlled session to confirm the LLM is actually receiving the steering prompt
- [ ] A6. Document findings in `research/phase-a-verification.md`

### Exit criteria
- Empirical compliance rate measured (% of compactions producing valid [THREAD_META])
- Daily review scanner shows accurate kasett-handled vs vanilla numbers
- Clear answer: hook firing? prompt reaching LLM? format compliance? parser working?

---

## Phase B — Schema v2 (structured output)

**Goal:** Replace markdown `[THREAD_META]` sentinel with JSON schema / structured output. Lift compliance from ~0% to ~95%.

**Status:** ⏸ QUEUED

### Tasks (preview)
- [ ] B1. Design JSON schema for thread meta (main + structured sub-threads)
- [ ] B2. Use provider-native structured output (Anthropic/OpenAI tool calling or response_format)
- [ ] B3. Update parser to read JSON from a function call result, not text extraction
- [ ] B4. Backward compat: read old [THREAD_META] format from existing sessions
- [ ] B5. Re-run benchmark, measure compliance rate delta

---

## Phase C — KeyState sidecar

**Goal:** Track specific values (URLs, IDs, paths, versions) explicitly. Address CompactBench KSSR (currently ~0).

**Status:** ⏸ QUEUED

### Tasks (preview)
- [ ] C1. Define KeyState type: `{ kind: 'url'|'id'|'path'|'version'|'config', value: string, label?: string }`
- [ ] C2. Detect candidate values in pre-compaction messages (regex pass)
- [ ] C3. Steering prompt addition: "preserve these specific values"
- [ ] C4. Storage: separate keystate field on compaction event
- [ ] C5. context_load injection: re-surface key values

---

## Phase D — Thread Identity (embedding-based continuity)

**Goal:** Replace 50% substring matching with embedding-based similarity for thread evolution tracking.

**Status:** ⏸ QUEUED

### Tasks (preview)
- [ ] D1. Add stable LLM-supplied IDs to sub-threads (best fix; cheap)
- [ ] D2. Optional: local embedding for similarity backup
- [ ] D3. Thread merge / split detection
- [ ] D4. Sub-thread lifecycle (created/active/blocked/completed)

---

## Phase E — Multi-session threads

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

---

## Open Questions (carried from strategic analysis)

1. Is the CompactionProvider hook actually being invoked in production? **(Phase A answers this)**
2. If hook fires, is the LLM ignoring the [THREAD_META] format? **(Phase A measures compliance)**
3. If LLM emits [THREAD_META], is the parser failing? **(Phase A replay test answers)**
4. What's the right cap on sub-threads — 3, 5, dynamic?
5. Should kasett be one plugin or split (thread tracking + key state + identity = 3 plugins)?
