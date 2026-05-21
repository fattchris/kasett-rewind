# Phase H — Production Bug Report (7-day window, 2026-05-12 → 2026-05-19)

## Bug 1 (RESIDUAL) — Path C compaction emits v1 schema

**Status:** OPEN. Confirmed in `2026-05-19-sidecar-failure-diagnostic.md`. Phase H confirms it is STILL biting.

**Evidence:** Of the 6 v1-schema records on disk, **3 were emitted on 2026-05-19** (today):
- `07d2f2d5-...-topic-5392` — 2026-05-19T16:42 — v1
- `73647668-...-topic-5392` — 2026-05-19T18:56 — v1
- (plus the 2026-05-18 missed compaction below)

Hot-patch v2 covered `compact-NyrShPGI.js` but missed `compact-CNsgTXwX.js` (Path C). The fix diff exists at `2026-05-19-hotswap-patch-v3-path-c.diff` but is **not yet deployed**.

**Impact:** Half of today's compactions land without thread_meta_v2 or curated key_state. The Phase H corpus is unnecessarily noisy because of this.

**Action:** Apply v3 path-c patch and restart the gateway.

---

## Bug 2 (CONFIRMED) — Missed compaction with no sidecar

**Session:** `5ab439f7-...-topic-5392`
**When:** 2026-05-18T21:19:28Z
**Symptom:** Compaction event occurred (visible in main session jsonl) but no `.kasett-meta.jsonl` file was created.

**Verification:**
```
$ ls ~/.openclaw/agents/main/sessions/5ab439f7*kasett-meta.jsonl
ls: no matches
```

**Likely cause:** Same root as Bug 1 — Path C didn't hot-load the sidecar emitter at all, not just failed schema.

**Impact:** Total loss of compaction observability for that event.

---

## Bug 3 (SCHEMA-DESIGN) — `key_state` curated array missing from sidecar top-level

**Observed:** All 5 v3 / v3-recovered records have `key_state_candidates` (raw, un-curated, mostly URLs) but **no top-level `key_state`** field.

**Where the curated key_state lives:** Inlined into the `summary_rich` markdown as a `## Exact identifiers\n\`\`\`json\n{...}\n\`\`\`` block.

**Impact:**
- Programmatic consumers can't read curated key_state without markdown parsing.
- Indexing tools, future Recall@1 probes, and downstream agents that want "what are the IDs from this session?" must regex-extract from prose.
- The original Phase H probe design (vanilla = summary_rich, kasett = summary_rich + key_state) doesn't apply cleanly. The actual ablation has to strip the embedded block to construct vanilla.

**Fix recommendation:**
1. Either: emit `key_state` as a top-level array AND keep it in summary_rich (duplication for human readability).
2. Or: emit only at top level and reference it as `<see sidecar.key_state>` in the summary.

---

## Bug 4 (SCHEMA-CAP) — sub_thread count capped at exactly 5

**Observed:** Every single v3 record (5/5) has `thread_meta_v2.sub.length == 5`.

**Probability this is real diversity:** Effectively zero across diverse sessions (USHA research, WARP install, MoltAIconnect mobile, etc.).

**Likely cause:** A hardcoded cap in the v3 emitter prompt or post-processor at exactly 5.

**Impact:** Thread structure is being truncated on every emission. Real sub-thread diversity is being lost.

**Fix recommendation:** Raise cap to ~8-10 with optional "..." overflow indicator, OR log when the cap was hit (`sub_truncated: true`).

---

## Bug 5 (HOUSEKEEPING) — Orphan duplicate sidecar file

**File pair:**
- `64734813-1063-4693-96d6-d7b994fd9ba8.jsonl.kasett-meta.jsonl` (41,289 bytes, 2026-05-12T17:05)
- `agent:main:telegram:group:-1003723465246:topic:12388.jsonl.kasett-meta.jsonl` (41,289 bytes, 2026-05-12T17:03)

**Verification:** `diff` returns 0 (byte-identical).

**Root cause:** Filename format migration. The session was once named `agent:main:telegram:group:...:topic:12388` and was later given a UUID-based name. The sidecar exists at both paths.

**Impact:** Minor — inflates session count, confuses inventory, no functional harm.

**Fix:** Delete the `agent:main:telegram:group:...:topic:12388.jsonl.kasett-meta.jsonl` orphan (the canonical session jsonl is at `64734813-...jsonl`; the `agent:main...` path has no parent jsonl file).

---

## Bug 6 (SAMPLE-SIZE) — Production corpus too small to evaluate

**Observed:** 7 days produced 8 sidecar files, 11 compaction records, and **only 1 real multi-compaction session.**

**Not a bug in code** — but a bug in the analysis plan. Phase H was scheduled assuming we'd accumulate enough multi-compaction sessions in 7 days to compute meaningful real-world stats. We did not.

**Fix recommendation:**
- Wait minimum 2-3 weeks before next Phase H rerun.
- OR: synthetically construct multi-compaction sessions from long sessions by replaying segments through the compactor.
- OR: lower the compaction trigger threshold during a dedicated study period to force more compaction cycles.

---

## Bugs NOT observed (cleanliness wins)

- **No parser failures.** All 11 records loaded as valid JSON on first attempt.
- **No corrupt sidecars.** No truncated lines, no encoding issues.
- **No schema_version mismatches** (every record had `schema_version` set to one of v1/v3/v3-recovered).
- **No timestamp ordering violations** within sessions.
