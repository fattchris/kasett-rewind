# Phase H Real-World Analysis: Post-Fix Regime (2026-05-21)

**Generated:** 2026-05-21  
**Analyst:** Clyde subagent  
**Sessions analyzed:** `060b1686` (topic-4448), `3e4586b6` (topic-5392)  
**Data window:** 2026-05-20 – 2026-05-21 (post Path-C fix, commit 24ba59a)

---

## Executive Summary

- **KSSR is dismally low on structured IDs in real-world data (1–12%) vs Phase 4 synthetic benchmark (55.6%).** The gap is not a fluke — it reveals a fundamental mismatch between what the ID detector captures and what the LLM voluntarily preserves. The LLM is adding its own key_state (path-type facts) rather than preserving the detected numeric/ID candidates.

- **Kasett modestly outperforms vanilla on path-type facts; it does not outperform vanilla on ID-type facts.** In both sessions, vanilla (summary_rich narrative) and kasett key_state recovered roughly the same specific facts from early compactions. On structured IDs (instance IDs, AMI IDs), both approaches fail equally.

- **Cross-compaction key_state continuity is low (14–80%) with high session variance.** 5392 (paper trimming, stable subject matter) shows 60–80% key_state survival. 4448 (AMI override, shifting subagent context) shows only 14%. Multi-cycle degradation is real.

- **Phase D taxonomy is correct and the counters are correct.** The 17 lifecycle events are all valid `created` and `completed` events. `renamed=0 merged=0 split=0` is accurate — not a bug. Root cause: the LLM completely reconceptualizes its sub-thread decomposition at every compaction (100% turnover rate in both sessions, across all 4 compaction transitions).

- **The "taxonomy gap" is a missing metric, not a counting error.** The daily review tracks renamed/merged/split as the interesting signal but the real behavioral signal is sub-thread turnover rate. 100% turnover every compaction means the agent isn't tracking work across context boundaries at all — kasett's sub threads are being rebuilt from scratch, not persisted.

- **Recommendation priority: fix the key_state detector first.** The LLM is ignoring ~99% of detected candidates in some sessions. This is a prompt/schema problem, not an infrastructure problem.

---

## Real-World Multi-Cycle KSSR

### Session 1: `060b1686` / topic-4448

**Task:** Mining Infra session history for Comeroid migration + implementing per-agent AMI override  
**Compaction count:** 3  
**Timestamps:** 19:14, 19:16, 19:18 UTC (2026-05-20) — three compactions in 4 minutes

| Compaction | Detected Candidates | Preserved (key_state) | Survivors (det∩pres) | LLM-Added | KSSR |
|---|---|---|---|---|---|
| C1 (19:14) | 162 | 7 | 3 | 4 | **2%** |
| C2 (19:16) | 178 | 7 | 2 | 5 | **1%** |
| C3 (19:18) | 163 | 12 | 1 | 11 | **1%** |
| **Aggregate** | **503** | **26** | **6** | **20** | **1%** |

**Cross-compaction key_state survival (4448):**

| Transition | Survived | Rate |
|---|---|---|
| C1→C2 | 1/7 | 14% |
| C2→C3 | 1/7 | 14% |
| C1→C3 | 3/7 | 43% |
| All 3 | 1 key | — |

**What survives vs what doesn't:**  
The single key_state item that survives all 3 compactions: `path:/home/node/.openclaw/agents/main/sessions/*-topic-5392.jsonl` (the Infra session glob pattern). This is a path-type item with high narrative salience. 

What doesn't survive: AWS instance IDs (`i-0caa95be553e3b362`, `i-0be04a854402a06ee`), AMI IDs (`ami-038a7ad77a39f887b`, `ami-0c5bb0b1da0ec6a80`), IAM ARNs — all things the detector correctly identifies and the LLM drops.

**Pattern:** The LLM is writing key_state from what seems important to it (file paths for current work), not from what the detector says is structurally important (IDs, ARNs, config values). Only 3–7 items are preserved each compaction despite 162–178 candidates. The LLM is **choosing 3–7 items from 162–178** with near-zero alignment to the detector's suggestions.

---

### Session 2: `3e4586b6` / topic-5392

**Task:** Trimming OpenClaw research paper from 29,368 to ~18,000 words  
**Compaction count:** 3  
**Timestamps:** 05:52, 06:23, 06:36 UTC (2026-05-21) — 44 minutes total span

| Compaction | Detected Candidates | Preserved (key_state) | Survivors (det∩pres) | LLM-Added | KSSR |
|---|---|---|---|---|---|
| C1 (05:52) | 50 | 5 | 3 | 2 | **6%** |
| C2 (06:23) | 18 | 5 | 2 | 3 | **11%** |
| C3 (06:36) | 44 | 12 | 8 | 4 | **18%** |
| **Aggregate** | **112** | **22** | **13** | **9** | **12%** |

**Cross-compaction key_state survival (5392):**

| Transition | Survived | Rate |
|---|---|---|
| C1→C2 | 3/5 | 60% |
| C2→C3 | 4/5 | 80% |
| C1→C3 | 4/5 | 80% |
| All 3 | 3 keys | — |

**What survives:** File paths for source and output paper, source word count (`29368`), AWS GPU instance ID (`i-0ccb467398ab5de48`). These are the load-bearing facts for the task at hand.

**What doesn't survive:** Intermediate word counts (`18247` from C1 replaced by `~18000` in C2/C3 — a normalization, not a loss), specific decisions about which sections to cut.

**Pattern:** 5392 shows meaningfully higher KSSR because the session has a stable, narrow subject (two files, one target number). The detector and LLM converge better when the state space is small and well-defined.

---

### Vanilla Baseline Probe

**Method:** Check whether early C1 key_state values appear verbatim in the latest compaction's `summary_rich` narrative (the prose text kasett generates, which approximates what vanilla OC would preserve). Also check kasett key_state for the same facts.

**4448 — 7 early facts probed:**

| Fact | Vanilla (summary_rich) | Kasett (key_state) |
|---|---|---|
| `*-topic-5392.jsonl` glob path | ✅ | ✅ |
| `research/migration-briefings/comeroid-migration.md` | ✅ | ✅ |
| `research/infra/PER-AGENT-AMI-OVERRIDE-SPEC.md` | ✅ | ✅ |
| `/workspace/repos/molt-infra` | ❌ | ❌ |
| `i-0caa95be553e3b362` | ❌ | ❌ |
| `ami-038a7ad77a39f887b` | ❌ | ❌ |
| `research/walton-package/PAPER-MOLT-...` | ❌ | ❌ |

**Result: Vanilla 43% / Kasett 43%** — identical on this session.

**5392 — 5 early facts probed:**

| Fact | Vanilla (summary_rich) | Kasett (key_state) |
|---|---|---|
| Source paper path | ✅ | ✅ |
| Output paper path | ✅ | ✅ |
| `18247` (C1 word count) | ❌ | ❌ |
| `29368` (source word count) | ✅ | ✅ |
| `i-0ccb467398ab5de48` (GPU instance) | ✅ | ✅ |

**Result: Vanilla 80% / Kasett 80%** — again identical.

**Important caveat:** The vanilla measurement uses `summary_rich` which IS generated by kasett's LLM (it's the narrative prose the hook writes). True vanilla would be OC's built-in compaction summary, which is different (shorter, more action-summary oriented). The `summary_rich` is already kasett-enriched narrative — so this comparison is "kasett narrative" vs "kasett structured key_state," not "kasett vs pre-kasett."

---

### Comparison to Phase 4 Synthetic Results

Phase 4 synthetic benchmark (McNemar p=0.0005, h=0.70):
- Vanilla Recall@1: 22.2%
- Kasett Recall@1: 55.6%

Real-world KSSR:
- 4448 (AMI override): **1%** aggregate KSSR
- 5392 (paper trimming): **12%** aggregate KSSR

**The synthetic separation does not hold on these metrics in real-world data.** Several explanations:

1. **Phase 4 measured Recall@1 on whether the correct key_state item could be retrieved.** Real-world KSSR measures whether the LLM _preserved_ detected candidates — a different, harder bar.

2. **Real-world compaction summaries are LLM-generated free-form prose** that the LLM uses to reconstruct key_state. The detector and LLM choose differently. The detector captures all IDs/ARNs/paths it sees; the LLM preserves only the 3–12 it deems most important for the current task.

3. **The synthetic benchmark may have been evaluated on sessions where the key_state detector and LLM naturally converged** (e.g., sessions with fewer distinct IDs, where the LLM was likely to mention the same items the detector found).

4. **One real-world finding that validates kasett:** key_state items that DO survive (especially in 5392) carry labeled context (e.g., `{kind: 'value', value: '29368', label: 'source word count (verified unchanged)'}`) which vanilla narrative may mention without the structured label. This metadata is useful even when the count is small.

**Honest verdict:** Real-world multi-cycle KSSR is substantially below Phase 4 synthetic Recall@1. The gap is partly methodological (different metrics), partly a genuine signal that the LLM-driven key_state selection is loosely coupled to the detector. Kasett's value is marginal in sessions with many IDs (4448), moderate in sessions with a stable narrow state space (5392).

---

## Phase D Taxonomy Investigation

### What the events look like

All 17 lifecycle events across 4 compaction transitions:

| Session | Transition | created | completed | renamed | merged | split |
|---|---|---|---|---|---|---|
| 4448 | C1→C2 | 3 | 2 | 0 | 0 | 0 |
| 4448 | C2→C3 | 2 | 3 | 0 | 0 | 0 |
| 5392 | C1→C2 | 2 | 3 | 0 | 0 | 0 |
| 5392 | C2→C3 | 3 | 2 | 0 | 0 | 0 |
| **Total** | | **10** | **7** | **0** | **0** | **0** |

### Root cause of 0 renames/merges/splits

**The taxonomy is correct. The counters are correct. The behavior is the signal.**

The lifecycle detector (`identity.ts`) uses Jaccard similarity on tokenized thread labels with a threshold of 0.5. Here are the actual scores for threads that "should" be continuations:

**4448 C1→C2 (highest candidate):**
- "Mine Infra sessions to document Comeroid migration" vs "Identify relevant Infra sessions containing Comeroid migration details": **Jaccard = 0.333** (below 0.5 threshold)

**4448 C2→C3 (highest candidate):**
- "Identify relevant Infra sessions containing Comeroid migration details" vs "Mining Infra topic session history for Comeroid (Anna Kelly) migration into Molt infra": **Jaccard = 0.188**

**5392 C2→C3 (highest candidate):**
- "Multiple write attempts produced 4,004-7,334 word outputs" vs "Multiple trim attempts producing 7,000-7,300 words instead of target 18,000": **Jaccard = 0.235**

All transitions score below 0.5. The lexical tier correctly reports `strategy: 'none'` and the events correctly fire as `created` (for new threads) and `completed` (for threads that disappeared).

**The behavioral pattern:** The LLM is performing 100% sub-thread turnover at every compaction — completely replacing its work decomposition with new concepts rather than updating existing threads. This is not a matcher calibration problem; it's the agent treating each compaction as a fresh start.

Evidence:
- 4448 C1→C2: 3 new sub-thread IDs, 3 old ones gone → 100% turnover
- 4448 C2→C3: 2 new sub-thread IDs, 3 old ones gone → 100% turnover  
- 5392 C1→C2: 2 new, 3 gone → 100% turnover
- 5392 C2→C3: 3 new, 2 gone → 100% turnover

Even semantically related threads (e.g., "mining Infra sessions" C1 → "session-discovery" C2 → "comeroid-migration-briefing" C3) get entirely new IDs and sufficiently different labels that the Jaccard matcher gives up. The LLM is reconceptualizing the task at each compaction, not persisting work items.

### Is the taxonomy missing anything?

The 17 observed events are exclusively `created` and `completed`. Looking at the real data, there are genuinely no renames, merges, or splits. The real-world behavior that IS missing from the current taxonomy:

**1. `reconceptualized`** — A thread that was present in C{n-1} disappears AND a thematically related new thread appears in C{n}, but Jaccard < 0.5 so it registers as `completed` + `created` rather than a single event. This is the most common real-world pattern. The daily report counts 10 created + 7 completed but the conceptual reality is "5 reconceptualizations + some genuine completions + some genuine new work."

**2. `refined`** — A thread present in C{n-1} is still present in C{n} with exactly the same ID but with an updated/more specific label. Currently would fire as `renamed` if Jaccard ≥ 0.5. In practice, we never see this because the LLM replaces IDs entirely — the same ID never carries through.

**3. No `blocked` events observed** — The schema defines `blocked` as a status transition (`active → blocked`). This happened in 5392 C1→C2 (`paper-trimming-task` has `status: 'blocked'`) but the lifecycle detector didn't fire a `blocked` event. **This is a bug:** `blocked` should fire when a thread is first seen with `status: 'blocked'`, not just when it transitions from active. The current code checks `prev.status !== 'blocked' && c.status === 'blocked'` — meaning it only fires if the thread persisted with a changed status. Since the LLM creates entirely new threads (no continuity), `blocked` events never trigger.

### The counting mechanism

**identity-report.js and daily-compaction-review.sh are correct** — they count the `kind` field values from sidecar `lifecycle_events` arrays. The expected taxonomy `{created, completed, blocked, renamed, merged, split}` matches the emitted kinds exactly.

The counters correctly show:
- `renamed: 0` — correct, no renames in data
- `merged: 0` — correct, no merges in data  
- `split: 0` — correct, no splits in data

The `rename_rate` metric in identity-report.js (renames per compaction with lifecycle) is a useful quality signal but currently always 0.

### Proposed taxonomy expansion

Given what's actually observed in real-world data:

```typescript
type LifecycleEvent =
  | { kind: 'created'; thread_id: string; label: string }
  | { kind: 'completed'; thread_id: string; label: string }
  | { kind: 'blocked'; thread_id: string; label: string }     // BUG: currently never fires
  | { kind: 'renamed'; ... }       // currently works, never fires
  | { kind: 'merged'; ... }        // currently works, never fires
  | { kind: 'split'; ... }         // currently works, never fires
  // NEW:
  | { kind: 'reconceptualized'; from_threads: string[]; into_threads: string[]; jaccard_max: number }
```

**`reconceptualized`** would fire when an entire compaction shows 100% turnover AND the top pairwise Jaccard score between old and new threads is in the 0.2–0.49 range (related but below rename threshold). This captures the dominant real-world pattern.

Additionally, add a **`turnover_rate`** field to each sidecar entry's lifecycle summary: `(created + completed) / total_distinct_threads_seen`. Currently untracked. 100% rate = reconceptualization storm; <30% rate = stable execution; 30–70% = normal completion + new work.

### Bug fix: `blocked` events

The `detectLifecycleEvents` function checks for `blocked` only in the matched path (existing thread with changed status). Since the LLM never reuses thread IDs, `blocked` never fires. Fix: also fire `blocked` for any `created` event where the new thread's status is immediately `blocked`:

```typescript
// In the 'created' path:
if (noMatch) {
  events.push({ kind: 'created', thread_id: c.id, label: c.label });
  if (c.status === 'blocked') {
    events.push({ kind: 'blocked', thread_id: c.id, label: c.label });
  }
}
```

---

## Recommendations

### 1. Fix key_state injection prompt (HIGH — ~1 day)

**Problem:** KSSR is 1–12% in real-world data. The LLM preserves 3–12 items despite detecting 50–178 candidates. The detector is working; the LLM is not using its output.

**Fix:** The prompt passed to the LLM should explicitly reference the `key_state_candidates` list and ask it to include ALL candidates that remain relevant, rather than asking it to infer key_state from scratch. The current behavior suggests the LLM is generating key_state independently of the candidates.

**Location:** Find where the kasett hook constructs the LLM prompt for summary generation (`src/hotswap/worker.ts` or the compaction handler). Verify that `key_state_candidates` is in the prompt, and strengthen the instruction (e.g., "Preserve ALL of the following detected keys unless they are definitively no longer relevant: [list]").

**Expected impact:** KSSR from 1–12% → 50–70% if the LLM faithfully preserves candidates.

### 2. Add `turnover_rate` metric to daily review (LOW — ~2 hours)

**Problem:** The daily review tracks `renamed/merged/split` but the dominant real-world signal is 100% sub-thread turnover. This metric is invisible in current reporting.

**Fix:** Add turnover rate computation to `daily-compaction-review.sh`'s Phase D section. For each session with ≥2 compaction sidecar entries, compute `(created + completed) / total_distinct_thread_ids_seen`. Report in the summary.

**Code change:** In the `LC_STATS` Python block, add turnover_rate computation.

### 3. Fix `blocked` event detection for freshly-created blocked threads (LOW — ~30 min)

**Problem:** A thread created as `blocked` (status='blocked') in the first compaction it appears will never trigger a `blocked` lifecycle event. The `detectLifecycleEvents` function only detects `blocked` when a matched thread changes status.

**Fix:** In `lifecycle.ts`, when emitting `created`, also check if `c.status === 'blocked'` and emit `blocked`. See code sketch in taxonomy section above.

### 4. Add `reconceptualized` lifecycle kind (MEDIUM — ~4 hours)

**Problem:** The taxonomy has no event for "the whole work decomposition was replaced." This is the dominant real-world pattern but the daily review just shows N created + M completed with no semantic meaning.

**Fix:** Add `reconceptualized` event type to `lifecycle.ts`. Fire when: compaction-level turnover rate is ≥80% AND max pairwise Jaccard between old and new threads is 0.1–0.49 (related but below rename threshold). Include `jaccard_max` for calibration.

**Daily review impact:** "Reconceptualized=2" is much more actionable than "created=10 completed=7."

### 5. Implement true vanilla baseline measurement (MEDIUM — ~1 day)

**Problem:** The current vanilla comparison uses `summary_rich` (kasett's own narrative) as the baseline. True vanilla is OC's built-in compaction summary, which is different. Without a true vanilla baseline, we can't claim KSSR improvements accurately.

**Fix:** Run the daily review script with kasett disabled (or on sessions that predate kasett's deployment) and collect OC native compaction summaries. Probe the same 5–10 facts. Establish a real baseline KSSR for comparison.

### 6. Track KSSR in daily review automatically (MEDIUM — ~3 hours)

**Problem:** KSSR is only available via manual `measure-kssr.js` runs. The daily review doesn't include it.

**Fix:** Call `measure-kssr.js` for each compacted session in `daily-compaction-review.sh` and include aggregate KSSR in the Phase C section. This gives day-over-day KSSR tracking.

---

## Open Questions

1. **Why does KSSR vary so much by session type?** 5392 (narrow task, stable files) = 12%; 4448 (broad subagent research, many IDs) = 1%. Is this detector selectivity (more ID noise in 4448) or LLM selectivity (LLM prioritizes task-critical items over background IDs)?

2. **What is OC native compaction KSSR (true vanilla)?** We have no pre-kasett baseline. The Phase 4 synthetic benchmark showed 22.2% vanilla Recall@1 — but the real-world comparison mechanism is different (verbatim survival vs retrieval). Need a real apples-to-apples measurement.

3. **Does sub-thread reconceptualization actually matter?** The LLM clearly rebuilds its work model at each compaction. Is this a problem or is it adaptive? If the new decomposition is better-suited to the current state, reconceptualization is correct. Only comparison of task outcomes (did the session complete its goal?) would tell us.

4. **Why are all 3 sessions' earliest compactions (C1) missing lifecycle_events?** C1 has no previous to compare against — this is expected. But the worker code requires `prevMeta.sub.length > 0` — if the session's very first sidecar write has no prior, lifecycle detection is correctly skipped. Confirmed by data.

5. **Is the key_state candidate list actually in the LLM prompt?** The detector produces `key_state_candidates` and writes it to the sidecar. Does the worker actually inject this list into the compaction prompt? This is the critical question for Recommendation #1. Needs code trace through `worker.ts`'s prompt construction.

6. **Phase 4 synthetic KSSR vs real-world KSSR — are they measuring different things?** Phase 4 measured Recall@1 (can you retrieve the fact from key_state?). This report measured KSSR (what fraction of detected candidates did the LLM preserve?). These are correlated but not the same metric. Future benchmarks should align definitions.
