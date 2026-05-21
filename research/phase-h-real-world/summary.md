# Phase H — Real-World Kasett 7-Day Compaction Analysis

**Date:** 2026-05-19 21:50 UTC
**Window:** 2026-05-12 → 2026-05-19 (7 days)
**Operator:** Clyde (Opus 4.7 subagent, depth 1/1)

---

## Executive Summary

**Verdict: POSITIVE-but-UNDERPOWERED.**

On the **one** real multi-compaction case in the 7-day window, kasett's structured block recovered **5/5 high-value identifiers** (Greg's Telegram ID, two EC2 instance IDs, an EFS ID, the fleet OC version) that vanilla prose summarization dropped entirely. Recall@1 lift: **+71.4 pp (28.6% → 100%)** on n=7 probes.

But: **n=1 real multi-compaction session is not enough to publish.** The Phase 4 synthetic result (22.2% vs 55.6%, McNemar p=0.0005, h=0.70) remains the headline finding. Phase H confirms the **same class of wins reproduces on a real Clyde session** — which is what we needed to know.

---

## Sample (Painfully Small)

| Metric | Value |
|---|---|
| Sidecar files on disk | 8 |
| Unique sessions | 7 (one duplicate alias) |
| Total compaction records | 11 (9 unique) |
| Schema distribution | v1=6, v3=3, v3-recovered=2 |
| Max compactions per session | 2 |
| Real multi-compaction sessions | **1** (4ce855d8) |
| 3+ multi-compaction sessions | **0** |

The original task brief listed three multi-compaction sessions. Two of those (`64734813` and `agent:main:...:topic:12388`) are the same session under two filenames, AND their "second compaction" is a v3-recovered backfill — the v1 → v3 schema upgrade re-emitted the same content with structured metadata added retroactively. Same timestamp, same prose, no new compaction event. **Only 4ce855d8 has a real 42-hour gap between two genuine compactions.**

---

## v3 Schema in the Wild — What Production Looks Like

Across 5 v3 / v3-recovered records:

- **sub_thread count = 5 on EVERY record** — hard cap is being hit constantly. Real thread diversity is being truncated.
- **decisions:** mean 3.8 (range 3–5)
- **open_questions:** mean 2.4 (range 0–4)
- **key_state_candidates:** mean 562, median 101, max 1519 — wide variance, dominated by URL noise

### Critical implementation finding

**There is no top-level `key_state` field in any sidecar.** The schema in production has:
- `key_state_candidates` — the un-curated dump (URLs, paths, IDs mixed together)
- A curated `key_state` array embedded **inside the JSON block at the tail of `summary_rich`**

This means a programmatic consumer reading the sidecar cannot grab the curated key_state from a top-level field — it has to parse it out of the markdown summary. The "structured access" design intent of v3 is only half-implemented.

---

## Real-World Recall@1 Probe (the only meaningful experiment in this phase)

**Single session:** 4ce855d8-ecce-403f-aa8f-6bac7858790c-topic-5392 (Infra topic)
- **Compaction 1:** 2026-05-13 03:06 UTC (v1, prose only)
- **Compaction 2:** 2026-05-14 21:05 UTC (v3, prose + structured block)
- **Gap:** 42 hours, ~1,859 messages in the window

### Ablation construction

Because v3 inlines the structured block into `summary_rich`, the actual "vanilla vs kasett" ablation is:
- **Vanilla:** `summary_rich` with the `## Exact identifiers\n\`\`\`json...\`\`\`` block stripped → 3,559 chars of prose
- **Kasett:** full `summary_rich` → 8,340 chars (prose + structured block adding +4,781 chars)

### Results (n=7 probes, scored by canonical-answer substring match, Sonnet 4.5 as probe model)

| Probe | Fact | Canonical | Vanilla | Kasett |
|---|---|---|---|---|
| p1 | Greg's Telegram user ID | `8275265360` | ✗ NOT IN CONTEXT | ✓ |
| p2 | Brain EC2 instance | `i-0241ec1c631202ea8` | ✗ NOT IN CONTEXT | ✓ |
| p3 | Eschabot GCP external IP | `34.136.186.121` | ✗ NOT IN CONTEXT | ✓ |
| p4 | molt-sentinel-data EFS | `fs-095822d3ba8f8ea17` | ✗ NOT IN CONTEXT | ✓ |
| p5 | Fleet OC version | `2026.5.7` | ✗ NOT IN CONTEXT | ✓ |
| p6 | EBS backup tag | `hourly` | ✓ | ✓ |
| p7 | New repo name | `moltaiconnect` | ✓ | ✓ |

**Vanilla Recall@1: 2/7 (28.6%)**
**Kasett Recall@1: 7/7 (100.0%)**
**Absolute lift: +71.4 pp**

McNemar on 5 discordant pairs (all kasett wins) → exact one-sided p = 2^-5 = **0.03125**. Significant on this single session. **Not significant at the population level** — n=1 session.

### What the win pattern says

Kasett wins on **identifier-class facts** (IDs, IPs, versions, specific user IDs) — the exact category where prose summarization is known to drop content because the LLM judges "this is a noisy implementation detail, omit." Kasett ties on **decision-class facts** (the EBS tag change, the new repo name) because those land in the `## Decisions` prose section that survives both contexts.

This matches Phase 4 synthetic results exactly. The mechanism is real and behaves the same way on production data.

---

## Honest Caveats

1. **Sample size is below any publication threshold.** n=1 session × 7 probes ≠ Phase 4's n=18 multi-cycle conversations × 36 probes. Do NOT report Phase H as a standalone result.
2. **Sonnet 4.5/4.6 ceiling-effect hypothesis lives.** On the two "both" probes (p6, p7), vanilla extracted the answer from prose — meaning when the fact is in prose, Sonnet 4.5 gets it. Kasett's win comes entirely from facts vanilla never had access to. This is consistent with kasett being a **preservation** mechanism, not a comprehension mechanism.
3. **One session is one topology.** 4ce855d8 happened to be a dense Infra-topic session with lots of named entities. A session about prose-heavy strategy (e.g., USHA research) might show no win.
4. **The schema cap of 5 sub-threads is biting.** Every v3 record hits the cap exactly. We are losing information here.
5. **The `key_state` top-level field is missing.** If downstream tooling expects to read sidecars without parsing summary_rich markdown, it will find nothing.

---

## Production Bugs

See `bug-report.md` for full detail. Highlights:

- **Bug 1 (Path C):** Today's compactions (3× on 2026-05-19) still emit v1 schema. The v2 hot-patch missed `compact-CNsgTXwX.js`. Path-C v3 diff (`2026-05-19-hotswap-patch-v3-path-c.diff`) is not deployed.
- **Missed compaction:** 2026-05-18T21:19:28Z on session `5ab439f7-...-topic-5392` produced no sidecar at all.
- **Duplicate sidecar files:** `agent:main:telegram:group:-1003723465246:topic:12388.jsonl.kasett-meta.jsonl` is byte-identical to `64734813-...`. Orphan from filename migration; safe to delete.

---

## Implications for Paper 1

**Phase H does NOT change the Paper 1 headline.** Phase 4 (synthetic, multi-cycle, n=18) is still the publishable evidence.

What Phase H adds:
- **External validity sentence:** "On a real production Clyde session with 42 hours and ~1,859 messages between compactions, kasett recovered 5/5 high-value identifiers that the vanilla prose baseline dropped (Recall@1 28.6% → 100%, n=7 probes). Sample size insufficient for statistical inference but qualitatively confirms the win pattern observed on synthetic data."
- **Implementation footnote:** "In production deployment, the curated `key_state` array is currently inlined into the prose `summary_rich` field rather than exposed as a top-level sidecar field. Structured-consumer access requires parsing the markdown summary."
- **Bias caveat:** v3 schema sub_thread cap of 5 is being hit on 100% of v3 emissions in production. Reported metrics may underestimate thread diversity.

A Paper 1 patch draft has NOT been written in this phase. Recommendation: **manual follow-up by Chris**, once Bug 1 is resolved and we have at least 2-3 weeks of clean v3 multi-compaction data.

---

## Recommendation for Next 7 Days

1. **Ship the v3-path-c patch.** Without it, the corpus stays half-v1 and we cannot accumulate evidence.
2. **Lift the sub_thread cap from 5 to ~8-10** OR start logging when it's hit so we can quantify lost information.
3. **Add a top-level curated `key_state` field to v3 sidecars** (deduplicate it from the summary_rich block, OR expose it separately — but don't make consumers parse markdown).
4. **Tag the sidecar emitter version** in each record (`emitter_version: "v3.2-2026-05-17"`) so we can correlate quality to deploy version.
5. **Wait for n ≥ 5 real multi-compaction sessions before rerunning Phase H.** Probably 2-3 more weeks of normal usage.
6. **Pre-register probe extraction** before reading the session content (avoid post-hoc fact selection bias). Build a small probe-extraction sub-agent that runs on the window without seeing the v3 summary.

---

## Files

- `summary.md` — this file
- `results.json` — full numeric breakdown
- `sidecar-inventory.json` — per-record field inventory
- `raw-probes.jsonl` — one JSON line per probe with full context hashes and model responses
- `bug-report.md` — production bug detail
- existing `2026-05-19-sidecar-failure-diagnostic.md` — Bug 1 deep-dive (referenced, not duplicated)
