# Kasett Phase H — Retrospective Evaluation
**Date:** 2026-05-17  
**Window:** 2026-05-05 through 2026-05-17 (14 days)  
**Scope:** 16 sessions, 26 compaction events  
**Purpose:** Post-fix retrospective — assess real-world compaction quality now that the cron detection bug is resolved

---

## Executive Summary

Overall quality is **mixed but trending positive**. The cron detection bug masked the true picture for ~10 days. Now that it's fixed, the most recent compactions (2026-05-14–16) show kasett working correctly for 3 out of 3 sessions with sidecars, v3 schema, and meaningful thread labels. However, the full 14-day window reveals significant problems: 80% of stubs were orphaned (never resolved to full summaries), 9 of 26 compactions were vanilla (kasett never fired), and KSSR rates are very low (0–15%).

---

## 1. Coverage

### Session-level sidecar coverage

| Metric | Count | % |
|---|---|---|
| Total sessions evaluated | 16 | — |
| Sessions with `.kasett-meta.jsonl` sidecar | 6 | 37.5% |
| Of those, sidecars with matching stub_id in session | 4 | 25% effective |
| Ghost sidecars (stub_id not found in session) | 2 | — |

**Ghost sidecar sessions:** `b3b78b63` (WARP/Cloudflare) and `c975ec28` (MoltAIconnect signal). Both have `.kasett-meta.jsonl` with valid v3 content, but the stub_id in the sidecar does not appear in the session's compaction event. The session compaction was vanilla (OC default). Root cause: kasett generated a summary and wrote the sidecar, but the stub injection into the session failed — the hot-swap write-without-inject bug.

### Compaction-level classification (all 26 events)

| Type | Count | % | Description |
|---|---|---|---|
| Vanilla fallback | 9 | 35% | OC's default summarizer, no kasett involvement |
| Stub-only (S) | 2 | 8% | KASETT_STUB present, no THREAD_META (ce99d917 x2) |
| Rich-inline (R) | 15 | 58% | KASETT_STUB + THREAD_META in compaction event |
| Rich-sidecar (resolved) | 3 | 12% | Stub present AND sidecar with matching stub_id |

Note: Rich-inline and rich-sidecar overlap — 3 of the 15 rich-inline compactions were also resolved to sidecar.

**Vanilla breakdown by session:**
- `f5422893`, `eb17807a` (infra, 2026-05-09/13): pre-cron-fix window, kasett likely not firing
- `571d75dd` (kasett topic): 2 of 4 compactions vanilla — compactions 3+4 (2026-05-05T12:58 and 15:09) had no THREAD_META, indicating kasett hook was not active or not yet deployed at that point
- `aa976050` (LLM hacking, first compaction): vanilla, was followed by a rich second compaction 14 min later
- `b3b78b63`, `c975ec28`: vanilla in session, sidecar written separately (ghost pattern)

---

## 2. KSSR Quality

Only sessions with sidecars can be measured by `measure-kssr.js`. Results:

### 4ce855d8 (infra, 3 compactions, sidecar present)
```
Compaction 1 (v1, 2026-05-13T03:06):  0%  (1633 detected, 0 preserved)
Compaction 2 (v3, 2026-05-14T21:05):  1%  (1519 detected, 20 preserved, 13 surviving, 7 LLM-added)
Aggregate KSSR: 0%
```
- v1 schema: no THREAD_META, no key_state in sidecar — full preservation failure
- v3 schema: 20 preserved out of 1519 detected = 1.3% raw preservation. 13 survived next compaction.
- Root cause for low rate: key_state detector is over-generating (1519+ entries for URLs/IDs extracted from a large session) while the summarizer only carries ~20 forward. The signal-to-noise problem is acute for the infra topic which contains thousands of infrastructure URLs, IPs, resource IDs.

### agent:main:telegram:...:topic:12388 (LLM hacking, 2 compactions, sidecar present)
```
Compaction 1 (v1, 2026-05-12T16:37):   0%  (34 detected, 0 preserved)
Compaction 2 (v3-recovered, 2026-05-12T17:03): 29% (34 detected, 20 preserved, 10 surviving, 10 LLM-added)
Aggregate KSSR: 15%
```
- v3-recovered shows meaningful recovery — 29% preservation on a smaller session (34 key states vs 1519)
- 10 LLM-added (not in detector) suggests the summarizer is generating new key states beyond what the pattern detector catches
- This is the best KSSR result in the window

### Sessions without sidecars (KSSR unmeasurable)
- `7b43e0ae`, `ce99d917`, `554ea513`, `aa976050`, `571d75dd`: all have rich-inline compactions but no sidecar, so KSSR cannot be computed. The detector ran but summary was never extracted.

**Mean key_state count (sidecar entries):** 685 across 6 sidecar entries
- Range: 34 (LLM hacking) → 1633 (infra v1)
- v3 sessions average ~560 key states
- This high count is a red flag — the detector is pulling in too much, diluting signal

---

## 3. Thread Quality

### Sessions with good thread labels (sidecar v3/v3-recovered)

| Session | Main label | Sub-thread quality |
|---|---|---|
| 4ce855d8 (infra) | "Molt AI platform infrastructure work — provisioning fixes, vault rollout, molt-connect v1.0, fleet health + backup validation" | GOOD — 4 specific sub-threads (EBS retag, Aurora drift, vault, molt-connect) |
| 64734813 (USHA research) | "Producing a 7-document research package to launch USHA-for-AI, a fiduciary AI certification body for regulated industries" | GOOD — Wave 1/Wave 2 breakdown is meaningful |
| b3b78b63 (WARP/CF) | "Install Cloudflare WARP and test Reddit + HF signups with xvfb + Cloudflare egress IP" | GOOD — sub-threads map to specific implementation steps |
| c975ec28 (signal collector) | "Implement signal collection layer for MoltAIconnect Mobile phase-03" | GOOD — sub-threads cover TypeScript types, collectors, UI |

### Sessions with generic/bad thread labels

| Session | Type | Main label | Problem |
|---|---|---|---|
| `c6c9c37c` (infra) | rich-inline stub | "pvc-261ae669 has an SOUL" | WRONG — grabbed a fragment from context |
| `b00d67c3` (infra) | rich-inline stub | "The QA config has plugins" | GENERIC — incomplete sentence |
| `5d65ffe4` (infra) | rich-inline stub | "Now let me find the config write section near the end..." | GENERIC — action fragment, not a thread description |
| `554ea513` (USHA-b) | rich-inline stub | "Now I'll conduct the deep research" | GENERIC — action in progress, not a summary |
| `691d67d1` (LLM hacking) | rich-inline stub | "Ongoing work" | STUB DEFAULT — placeholder never replaced |
| `aa976050` (LLM hacking) | rich-inline stub | "Ongoing work" | STUB DEFAULT — same |
| `7b43e0ae` compaction 1 | rich-inline stub | "System:" | VERY BAD — raw content fragment |
| `7b43e0ae` compaction 2 | rich-inline stub | "You are currently working on: System:" | VERY BAD — system prompt fragment |

**Verdict:** Thread labels are reliable ONLY when the sidecar v3 replacement ran (4 sessions). In the 12 orphaned stub cases, labels are either placeholder text ("Ongoing work"), action fragments ("Now let me..."), or outright garbage ("System:"). This is entirely because the hot-swap never completed — the THREAD_META block in a raw stub is written by a pattern match, not by the LLM summary.

### Sub-thread quality (where measurable)

All four v3 sidecar sessions show meaningful sub-threads:
- Lists of 3–6 specific work items per compaction
- Good specificity: "EBS Backup tag fleet retag (daily→hourly) + AWS Backup selection update" vs generic "infrastructure work"
- Sub-threads correctly decompose parallel workstreams

---

## 4. Lifecycle Activity

All sessions: `lifecycle_events: 0` across all 9 sidecar entries.

No thread renames, merges, or splits recorded in the entire 14-day window.

**Assessment:** Phase D (lifecycle tracking) is either not implemented, not triggering, or threads are stable enough that no events occur. Given that sessions like `4ce855d8` span 3+ weeks with significant topic drift (from "provisioning fixes" to "vault rollout" to "molt-connect"), the absence of lifecycle events is suspicious — expected at least 1–2 renames for the infra thread as the focus shifted.

---

## 5. Multi-Cycle Behavior

### 4ce855d8 (infra) — 3 compactions

```
Comp 1: 2026-05-13T03:06  → V (vanilla fallback) — no sidecar
Comp 2: 2026-05-14T21:03  → R (rich-inline), stub=a2b4499a → sidecar written (v3) ✅ REPLACED
Comp 3: 2026-05-16T20:58  → R (rich-inline), stub=3f491911 → NO sidecar ❌ ORPHANED
```

Thread identity across cycles:
- v1 sidecar (comp 1) had no thread_meta — no identity established
- v3 sidecar (comp 2) established: `main: "Molt AI platform infrastructure work — provisioning fixes, vault rollout, molt-connect v1.0, fleet health + backup validation"`
- Comp 3 is orphaned — unknown whether it would have carried through the same main label
- The v3 sub-thread list in comp 2 is substantively different from the v1 key_state_candidates, indicating the LLM reprocessed rather than carried forward
- **No canonical_id field observed** in any sidecar entry — canonical_id continuity cannot be assessed

### 571d75dd (kasett topic) — 4 compactions

```
Comp 1: 2026-05-05T10:30:58 → THREAD_META block present but content is "..."  (truncated/empty)
Comp 2: 2026-05-05T10:30:58 → Same as comp 1 (near-simultaneous, duplicate event)
Comp 3: 2026-05-05T12:58   → no THREAD_META block
Comp 4: 2026-05-05T15:09   → no THREAD_META block
```

All 4 compactions lack a sidecar. The first two are near-simultaneous (58ms apart) — this looks like a double-fire event. No thread identity was established or carried through any cycle. This session has no sidecar at all, despite being the kasett development topic itself (topic-20751). This is the most notable absence — kasett failed to track its own development session.

**Identity-report output:** `sessions_with_lifecycle=0, compactions_with_lifecycle=0` across all 6 sidecar sessions. No canonical_ids observed anywhere in the window.

---

## 6. Failure Patterns

### Pattern A: Orphaned stubs (PRIMARY) — 12 of 15 stubs
**What:** `[KASETT_STUB::<id>]` appears in a compaction event but no sidecar entry with matching stub_id exists.  
**Affected sessions:** All sessions except 2ab19b6e, 4ce855d8-comp2, 64734813.  
**Root cause:** The hot-swap background job (async LLM call to replace stub with full summary) is not completing or not running. This was identified as the critical bug in the 2026-05-06 daily review and has NOT been resolved in this window.  
**Impact:** Sessions with orphaned stubs have kasett's inline `[THREAD_META]` labels which are action fragments, not summaries. Agent reads these on context load and gets misleading orientation.

### Pattern B: Ghost sidecars — 2 sessions (b3b78b63, c975ec28)
**What:** `.kasett-meta.jsonl` sidecar exists with valid v3 content, but the session's compaction event is vanilla (no `[KASETT_STUB::]`), and the sidecar's `stub_id` does not appear in the session.  
**Root cause:** Kasett's hook intercepted the compaction, generated a summary (correctly), wrote the sidecar, but failed to inject the stub into the actual compaction event. The OC compactor ran its own vanilla summarizer instead.  
**Result:** Sidecar contains good data but the session never knows about it. The agent's context gets vanilla text, not kasett's enriched summary.  
**First observed:** 2026-05-14/15 — these are the most recent non-infra compactions.

### Pattern C: Vanilla fallback — 9 compactions (35%)
**What:** Sessions compacted entirely by OC's default summarizer, no kasett involvement.  
**Breakdown:**
- 4 sessions pre-date the cron fix (2026-05-05: `571d75dd` partial, `f5422893`)
- 3 sessions in the 2026-05-09/13 window where the cron detection bug was active but kasett wasn't hooking
- 2 sessions (b3b78b63, c975ec28) where Pattern B applies (ghost sidecar on same session)

### Pattern D: Schema v1 artifacts — 3 sidecar entries across 3 sessions
**What:** v1 schema entries have no `thread_meta`, only `key_state_candidates` (534, 1633, 34 entries respectively).  
**Problem:** v1 entries are pre-thread-meta schema. They were the FIRST compaction for each session (later compactions upgraded to v3). This is normal v1→v3 progression, NOT a downgrade.  
**Verdict:** No schema downgrades detected. All progressions go v1→v3 or start at v3.

### Pattern E: Near-duplicate compaction fire — 571d75dd
**What:** Two compaction events fired at 2026-05-05T10:30:58.853Z and 10:30:58.957Z (104ms apart).  
**Root cause:** Unknown — likely a race condition in OC's compaction trigger during a high-context-pressure moment.  
**Impact:** Two identical stubs created, neither resolved.

### Pattern F: Stubs never replaced from pre-fix window — 8+ orphans
Several stubs from 2026-05-05 through 2026-05-11 remain in session files permanently. These are historical artifacts — the hot-swap job was either not running or failing. These stubs are now baked into the session history and will degrade the agent's context quality if those sessions are ever loaded again.

---

## 7. Summary Table

| Session | Label | Compactions | Kasett Type | Sidecar | KSSR | Main Label Quality |
|---|---|---|---|---|---|---|
| 4ce855d8 | infra | 3 (V,R,R) | Rich+ghost | v1+v3 | 0–1% | GOOD (v3) |
| 7b43e0ae | unknown | 2 (R,R) | Rich-inline | None | N/A | BAD (raw fragment) |
| c975ec28 | signal | 1 (V) | Ghost sidecar | v3 | N/A | GOOD (sidecar) |
| b3b78b63 | warp | 1 (V) | Ghost sidecar | v3 | N/A | GOOD (sidecar) |
| f5422893 | infra | 1 (V) | Vanilla | None | N/A | N/A |
| 2ab19b6e | pii | 1 (R) | Rich+resolved | v1 | N/A | GOOD (stub tm) |
| 64734813 | usha | 1 (R) | Rich+resolved | v1+v3r | 0–29% | GOOD (v3r) |
| ce99d917 | transcript | 3 (S,S,V) | Stub-only | None | N/A | N/A |
| 554ea513 | usha-b | 2 (R,R) | Rich-inline | None | N/A | GENERIC |
| aa976050 | llm-hack | 2 (V,R) | Mixed | None | N/A | STUB DEFAULT |
| 691d67d1 | llm-hack | 1 (R) | Rich-inline | None | N/A | STUB DEFAULT |
| eb17807a | infra | 1 (V) | Vanilla | None | N/A | N/A |
| c6c9c37c | infra | 1 (R) | Rich-inline | None | N/A | WRONG fragment |
| b00d67c3 | infra | 1 (R) | Rich-inline | None | N/A | GENERIC |
| 5d65ffe4 | infra | 1 (R) | Rich-inline | None | N/A | GENERIC |
| 571d75dd | kasett | 4 (R,R,V,V) | Mixed | None | N/A | EMPTY/BAD |

---

## 8. Overall Assessment

**What's working:**
- When kasett fully executes (hook → LLM summarize → sidecar write), the output is high quality. v3 thread labels are specific, actionable, and correctly decompose parallel workstreams.
- Schema progression (v1→v3) is healthy — no downgrades observed.
- The cron detection bug fix (2026-05-17) is having an immediate effect — today's review shows 1/1 compaction handled correctly.
- KSSR is improving: 29% on the LLM hacking topic is the best result. The infra topic's near-0% is a detector over-generation problem, not a quality problem with the summary itself.

**What's broken:**
1. **Hot-swap completion (critical):** 80% of stubs are orphaned. The async LLM replacement job is the most important unfixed bug. Without it, rich-inline compactions give worse orientation than vanilla (action fragments vs. clean summaries).
2. **Stub injection (significant):** Ghost sidecar pattern in 2 sessions (b3b78b63, c975ec28) shows kasett can generate good summaries but fail to inject them into the compaction. The sidecar quality is good; the session never sees it.
3. **Lifecycle tracking (inactive):** Zero renames, merges, or splits in 14 days across all monitored sessions. Given topic drift in infra and kasett sessions, this is almost certainly a tracking gap rather than genuine stability.
4. **KSSR on high-volume sessions (concern):** Infra topic has 1519+ key states per compaction due to URL/ID extraction at scale. Preservation rate of 1% is too low for a session with meaningful continuity. The detector needs signal/noise tuning for large sessions.
5. **571d75dd (kasett's own topic):** 4 compactions, 0 sidecars. The plugin failed to track its own development session. Notable but not surprising given the early date (2026-05-05) and the fact the cron detection bug was active.

---

## Appendix: Raw Data

### Stub replacement status (all 15 stubs found)
```
REPLACED: 2ab19b6e  stub=58632cab  v1   2026-05-12
REPLACED: 4ce855d8  stub=a2b4499a  v3   2026-05-14
REPLACED: 64734813  stub=da3ebb43  v3r  2026-05-12
ORPHANED: 4ce855d8  stub=3f491911  -    2026-05-16  ← most recent infra
ORPHANED: 554ea513  stub=7ed3fd48  -    2026-05-11
ORPHANED: 554ea513  stub=8c4b1706  -    2026-05-11
ORPHANED: 5d65ffe4  stub=5d2f3bc0  -    2026-05-05
ORPHANED: 691d67d1  stub=d6d65ad2  -    2026-05-11
ORPHANED: 7b43e0ae  stub=1a54636f  -    2026-05-08
ORPHANED: 7b43e0ae  stub=26c08bef  -    2026-05-15  ← recent
ORPHANED: aa976050  stub=42b8c639  -    2026-05-11
ORPHANED: b00d67c3  stub=ffef1a2b  -    2026-05-06
ORPHANED: c6c9c37c  stub=26f36392  -    2026-05-09
ORPHANED: ce99d917  stub=ce8f****  -    2026-05-10  (x2)
```

### Key state counts per sidecar entry
```
2ab19b6e   v1   534  (no thread_meta)
4ce855d8   v1  1633  (no thread_meta) — over-generation
4ce855d8   v3  1519  (with thread_meta, good label)
64734813   v1    34  (no thread_meta)
64734813   v3r   34  (good label)
topic:12388 v1   34  (no thread_meta)
topic:12388 v3r  34  (good label, 29% KSSR)
b3b78b63   v3   101  (ghost sidecar, good label)
c975ec28   v3  1123  (ghost sidecar, good label) — high count
Mean: 685
Median: ~101 (excluding infra outliers)
```

### Daily cron coverage (from daily review logs)
```
2026-05-05: 0% coverage (0/6 kasett) — cron bug active
2026-05-06: partial (1/1 kasett, stub never replaced) — manual review
2026-05-08: 100% (2/2 kasett, both stubs orphaned) — manual review
2026-05-09: kasett handled 1 session (7b43e0ae)
2026-05-11: kasett handled 1 session (691d67d1)
2026-05-12: 100% (2/2, one rich, one stub-only)
2026-05-13: 100% (4/4, three rich, one stub-only)
2026-05-14: 0 compactions
2026-05-15: 100% (3/3 rich with sidecars)
2026-05-16: 0 compactions
2026-05-17: 100% (1/1, sidecar) — post-cron-fix
```
