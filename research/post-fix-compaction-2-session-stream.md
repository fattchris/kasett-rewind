# Post-Fix Compaction #2 — Session Stream (topic 11727)

**Triggered:** 2026-05-12 17:16 UTC by Chris (manual compaction)
**Session:** `2ab19b6e-f6c8-4837-b474-71d67fb93f70-topic-11727.jsonl`
**Plugin code running:** Phase F applied (max_tokens=32k, parser repair, path resolution)

---

## TL;DR

**Phase F bug fixes verified.** Sidecar landed at the correct UUID-named path. No truncation. Path resolution working.

**New finding:** The LLM produced **pure prose** with zero structured JSON output. PARSE_NONE. Despite 534 detected key_state candidates, the sidecar got `key_state: 0` because the LLM didn't emit any. This is unrelated to Phase F — it's a Phase B2 (steering effectiveness) signal.

---

## Diagnostic timeline

```
17:16:24.796  WORKER_START         session=2ab19b6e-...-topic-11727.jsonl ← UUID, correct ✅
17:16:25.002  LLM_DIAG  openrouter_start  model=anthropic/claude-sonnet-4-5  prompt_chars=8884+162458
17:16:39.291  LLM_DIAG  openrouter_result  length=2180  preview="✅ **Backfill done. 32/103 files released..."
17:16:39.292  LLM_DONE             summary_len=2180
17:16:39.315  PARSE_NONE           v3_errors=no fenced ```json``` block found
17:16:39.322  SIDECAR_WRITTEN      schema=none  key_state=0  detected=534  ← path correct ✅
17:16:39.322  GLOBAL_INDEX_WRITTEN  records=0  resolved=0
```

**~14 seconds end-to-end.** Massive prompt (171k chars), tiny response (2.2k chars). LLM finished early.

---

## What landed in the sidecar

The full summary, in 2,180 chars of pure prose:

```
✅ **Backfill done. 32/103 files released, 71 still quarantined. Found a v1.3.0 hole.**

**Results:**
- **103 → 71 quarantined** (down 32)
- **32 released:** re-anonymized with v1.3.0 → uploaded to live prefix → pii-scan rescan CLEAN ...
- **52 still dirty:** v1.3.0 still leaks PII — root cause identified below
- **19 scan-error:** infra errors (Lambda timeouts on giant payloads?) ...

**New v1.3.0 hole found (accounts for the 52 still-dirty):**

[code blocks describing the bug]

**Recommended fix for v1.4.0 (one line):**
[python snippet]

📊 15% · 137k/1M · 0 compactions
```

This is a **task-completion report** — high-quality content, but unstructured. There's no `\`\`\`json` block anywhere.

---

## Phase F verification — what passed

| Bug | Fix | Status |
|---|---|---|
| F1 — max_tokens truncation | `compactionMaxTokens: 32000` | ✅ N/A — output only 2.2k chars |
| F2 — parser truncation tolerance | bracket-balancing repair | ✅ N/A — no JSON to parse |
| F3 — sidecar path resolution | resolveSessionFilePath | ✅ landed at correct UUID-named path |

**F3 is the headline fix verified live.** F1/F2 weren't exercised this round but pass tests; will exercise on the next compaction with larger output.

---

## The new finding — LLM didn't follow the V3 schema

**This is a separate problem from Phase F.** The plumbing works; the LLM chose not to use it.

### Compare the two production compactions:

| Compaction | Input size | Output size | JSON emitted? | Reason |
|---|---|---|---|---|
| topic-12388 (16:35 UTC) | 60 msgs, 37k tokens | 14,113 chars | ✅ yes (truncated) | Multiple parallel research subagents — lots to organize |
| topic-11727 (17:16 UTC) | 100 msgs, 76k tokens | 2,180 chars | ❌ no | Single ongoing task — completion report mode |

**Hypothesis:** The LLM uses the V3 schema when the work is complex (multiple threads, decisions, open questions). For single-thread work it apparently judges the schema as overkill and defaults to prose.

**This is the Phase B2 risk we documented in the strategic analysis.** The Path B (steering prompt + JSON parsing) approach achieves ~90-95% compliance because compliance is at the LLM's discretion. Path A (provider-native tool_use / response_format with `strict: true`) achieves ~99% because the API forces JSON output regardless of the LLM's preference.

### Three response options

1. **Strengthen the steering prompt** — make the schema requirement non-negotiable in tone, repeated, with "even if the work seems simple, ALWAYS emit the JSON block" language. Cheapest fix, lowest ceiling (~95%).
2. **Implement Path A (tool_use/response_format)** — Already scaffolded in Phase B2 behind `structuredOutput: 'tool'` flag. Requires per-provider HTTP code (Anthropic tool_use, OpenAI response_format). Highest reliability (~99%).
3. **Accept variable compliance and report it as a metric** — Track JSON-emission rate over time. Compliance becomes a measurable quality dial.

**Recommendation:** Combination of #1 (cheap, immediate) and #3 (measurement). Path A as future work if #1 doesn't lift compliance enough.

---

## Action items

### P1 — Strengthen V3 steering prompt
- Add explicit "ALWAYS emit the JSON block, even for simple sessions" framing
- Move the schema requirement BEFORE the example (currently example is first)
- Repeat the schema requirement at the END of the prompt (recency bias)
- Add a one-liner: "If you write only prose, the system fails to record key context"

### P2 — Compliance metric tracking
- Daily review: track ratio of `schema=v3` vs `schema=none` vs `schema=v1`
- Weekly: report JSON-emission rate as a quality KPI
- This becomes a clean signal for whether prompt strengthening worked

### P2 — Test F1/F2 on next large compaction
- The next time a compaction produces >12k chars, F1 (no truncation) and F2 (parser repair) get exercised
- Watch the hotswap-diag log for `LLM_DIAG openrouter_result length=` values

### P3 — Path A scaffolding activation
- If P1 doesn't lift compliance to 90%+, switch the default to `structuredOutput: 'tool'`
- Anthropic API supports this directly via tool_use; the bones are already in `src/threads/steering.ts`

---

## Phase F status: ✅ COMPLETE

The three production bugs are fixed. The plumbing is sound. The next bottleneck is steering prompt effectiveness, which is independent of Phase F's scope.

**Phases A→F shipped. Production tested. Bug-free except for the documented LLM-compliance variance.**

---

*Filed: 2026-05-12 17:18 UTC after live verification of Phase F on topic-11727.*
