# Phase B1 — Post-Deploy Verification Checklist

**Created:** 2026-05-12
**Trigger:** After 3-5 organic compaction events have occurred since B1 deployed (commit `~3be7bd3+`)

The sidecar fix is in. We don't know yet whether it works in production. This is the checklist to run **after some real compactions have happened** to confirm we're done with B1 and ready to lean on it.

---

## What changed (so we know what to verify)

- Compaction now writes rich kasett output to `<session>.jsonl.kasett-meta.jsonl` instead of trying to atomically rewrite the session file
- The session JSONL still gets the OC stub at `entry.summary` (unchanged)
- Daily review scanner has 5 tiers: `rich-sidecar` (new ideal), `rich-inline` (legacy), `stub`, `kasett-other`, `vanilla`
- All hook events log to `research/hook-events.jsonl`

---

## Run-now checks (after 3-5 compactions)

### 1. Sidecar files appearing
```bash
ls -la /home/node/.openclaw/agents/main/sessions/*.kasett-meta.jsonl 2>/dev/null
```
**Expected:** At least one sidecar file exists.
**If empty:** Hook isn't writing the sidecar. Check #3 (hook events) for failure mode.

### 2. Sidecar contents are real
```bash
tail -n 1 /home/node/.openclaw/agents/main/sessions/*.kasett-meta.jsonl | python3 -m json.tool
```
**Expected:** Valid JSON with non-empty `summary_rich` (>500 chars) AND populated `thread_meta.main` (real sentence, not a fragment like "What about error state").
**If `summary_rich` is the OC stub:** The before_prompt_build is firing but the LLM output isn't being parsed correctly.
**If `thread_meta.main` is garbage/fragment:** The LLM isn't following the format. Phase B2 will fix this with structured output.

### 3. Hook events fired
```bash
grep -c '"hook":"after_compaction"' /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl
grep -c '"action":"sidecar_written"' /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl
grep -c '"action":"sidecar_failed"' /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl
```
**Expected:** `sidecar_written` count > 0 and matches the count of recent compactions.
**If `sidecar_failed` count > 0:** Open those entries, find the error reason. Common: missing session path, write permission, malformed meta.

### 4. Daily review reports rich-sidecar
```bash
bash /home/node/.openclaw/workspace/repos/kasett-rewind/scripts/daily-compaction-review.sh
cat /home/node/.openclaw/workspace/repos/kasett-rewind/research/daily-reviews/$(date -u +%Y-%m-%d).md
```
**Expected:** Summary line shows `rich-sidecar=N` where N matches sidecar files for today's sessions. `rich-inline=0` (new compactions don't use inline).
**If `stub=N` and `rich-sidecar=0`:** Hook fired but parser failed. Check `thread_meta.main` quality in the sidecar.

### 5. Compliance rate jump
Run the Phase A replay to compare:
```bash
node /home/node/.openclaw/workspace/repos/kasett-rewind/research/phase-a-replay.js
cat /home/node/.openclaw/workspace/repos/kasett-rewind/research/phase-a-replay-report.md
```
**Expected:** Compliance rate >0% for compactions since B1 deployed.
**If still 0%:** B1 didn't actually fix the failure mode — something else is broken. Re-investigate.

### 6. Orientation injection working
On the next session restart or context_load:
```bash
grep '"hook":"context_load"' /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl | tail -3
grep '"hook":"before_prompt_build"' /home/node/.openclaw/workspace/repos/kasett-rewind/research/hook-events.jsonl | tail -3
```
**Expected:** Entries showing the orientation prompt was built from sidecar data, not empty.

### 7. Migration of historical data
```bash
# Dry-run first
node /home/node/.openclaw/workspace/repos/kasett-rewind/scripts/migrate-to-sidecar.js --dry-run
# Then live
node /home/node/.openclaw/workspace/repos/kasett-rewind/scripts/migrate-to-sidecar.js
```
**Expected:** Migrates the 2 historical inline `[THREAD_META]` entries that Phase A identified into sidecars. Idempotent — re-run is safe.

---

## Decision tree

| Outcome | Decision |
|---------|----------|
| Sidecar files appear, contain real summaries, daily review reports rich-sidecar≥1 | ✅ B1 verified — mark Phase B1 verified in tracker |
| Sidecars appear but content is OC stub or garbage `thread_meta` | 🟡 B1 mechanically working, but LLM compliance is the real problem — Phase B2 needs to land |
| No sidecars appear after 5+ compactions | 🔴 Critical — hook isn't firing or sidecar writer is broken. Investigate `hook-events.jsonl` for failure mode. Do NOT proceed to B2 until B1 is verified. |
| `sidecar_failed` events present | 🟡 Read the error in those events. Likely a permissions or path issue. Fix before claiming B1 done. |

---

## What to update if B1 is verified

1. Mark B1 as ✅ COMPLETE & VERIFIED in `research/PHASES-TRACKER.md` (it currently says complete but unverified)
2. Add a "Verification" section to `research/phase-b1-progress.md` with the actual numbers observed
3. Note the production compliance rate baseline so Phase B2 can measure improvement against it

## What to log if B1 fails

1. Capture the failure mode in `research/phase-b1-postmortem.md`
2. Quote the relevant hook events
3. Identify what assumption was wrong (lock timing? hook ordering? OC API change?)
4. Decide: rollback, patch, or pivot

---

## When to run this checklist

- **Earliest:** After 3 organic compactions have occurred (might be a few hours of normal activity)
- **Latest:** End of day 2026-05-13 — if no compactions happened by then, something else is wrong (sessions aren't growing, OC isn't compacting, etc.)
- **Ideal:** First session that compacts after the next OC restart, then again after 5 total compactions

Set a reminder if needed. Don't let this rot.
