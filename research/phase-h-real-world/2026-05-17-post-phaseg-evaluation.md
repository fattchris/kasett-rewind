# Kasett Post-Phase-G Real-World Evaluation
**Date:** 2026-05-17  
**Scope:** 7 compactions across 5 sessions, all AFTER commit `cced56a` (phase-g, 2026-05-12 21:38:43 UTC)  
**Evaluator:** Subagent (sonnet-4-6)

---

## Session / Compaction Inventory

| Session | Compaction TS | Sidecar | Schema | Inline Type |
|---|---|---|---|---|
| 4ce855d8-topic-5392 | 2026-05-13T03:06Z | YES (v1) | v1 | vanilla |
| 4ce855d8-topic-5392 | 2026-05-14T21:03Z | YES (v3) | v3 | stub+THREAD_META (orphaned) |
| 4ce855d8-topic-5392 | 2026-05-16T20:58Z | **MISSING** | — | stub+THREAD_META (orphaned) |
| 7b43e0ae | 2026-05-15T22:11Z | **MISSING** | — | stub+THREAD_META (orphaned) |
| c975ec28-topic-28727 | 2026-05-15T06:34Z | YES (v3) | v3 | vanilla |
| b3b78b63-topic-28204 | 2026-05-14T22:17Z | YES (v3) | v3 | vanilla |
| f5422893-topic-5392 | 2026-05-13T01:07Z | **MISSING** | — | vanilla |

---

## 1. Stub Injection / Hot-Swap Completion

**Critical finding: hot-swap is 0% complete across all 7 compactions.**

Every compaction that produced a `KASETT_STUB` left it intact in the session JSONL. The stub was never replaced with the rich summary content from the sidecar. Two patterns observed:

### Pattern A: Stub + Inline THREAD_META (orphaned) — 3 compactions
Sessions where kasett wrote a `KASETT_STUB::` placeholder with an inline `[THREAD_META]` block, but the sidecar's rich summary was never swapped in:

- **4ce855d8 @ 2026-05-14T21:03Z** — `KASETT_STUB::a2b4499a`. Sidecar exists with rich content (v3, detailed thread_meta). The JSONL still shows the stub.
- **4ce855d8 @ 2026-05-16T20:58Z** — `KASETT_STUB::3f491911`. No sidecar record exists for this compaction ID at all (sidecar file has only 2 records for 3 compactions). Both stub and sidecar generation failed partially.
- **7b43e0ae @ 2026-05-15T22:11Z** — `KASETT_STUB::26c08bef`. No sidecar file. Stub is orphaned with no corresponding rich content anywhere.

### Pattern B: Vanilla — 4 compactions
No stub, no THREAD_META inline. Kasett either didn't engage or compaction happened outside plugin reach:

- **4ce855d8 @ 2026-05-13T03:06Z** — First compaction on this session (pre-v3). Sidecar exists but is v1 (no thread_meta field, only key_state_candidates). This is the schema v1 era.
- **c975ec28 @ 2026-05-15T06:34Z** — Vanilla. Sidecar exists and is v3 with good thread_meta.
- **b3b78b63 @ 2026-05-14T22:17Z** — Vanilla. Sidecar exists and is v3 with good thread_meta.
- **f5422893 @ 2026-05-13T01:07Z** — Vanilla. No sidecar. Session had a timeout/model-switch chain (Opus→Sonnet→Kimi) leading up to compaction; may explain plugin miss.

**Verdict: Hot-swap mechanism is not functioning.** Stubs are written but never replaced. For vanilla compactions, the sidecar is generated correctly but the inline summary gets no kasett enrichment at all.

---

## 2. Coverage Breakdown

| Type | Count | Sessions |
|---|---|---|
| **Rich sidecar (v3) + vanilla inline** | 2 | c975ec28, b3b78b63 |
| **Rich sidecar (v3) + stub-orphaned inline** | 1 | 4ce855d8 @ 2026-05-14 |
| **Stub-orphaned, NO sidecar** | 2 | 4ce855d8 @ 2026-05-16, 7b43e0ae @ 2026-05-15 |
| **Vanilla inline + v1 sidecar (no thread_meta)** | 1 | 4ce855d8 @ 2026-05-13 |
| **Vanilla inline, NO sidecar** | 1 | f5422893 @ 2026-05-13 |

**Aggregate (7 compactions):**
- rich-inline (hot-swapped): **0/7 (0%)**
- rich-sidecar (content exists, just not injected): **3/7 (43%)**
- stub-only (orphaned): **3/7 (43%)** (1 with sidecar, 2 without)
- vanilla/neither: **4/7 (57%)** (some overlap with sidecar-present)

---

## 3. Thread Quality

### Sidecar thread_meta (the rich labels — v3 schema)

**4ce855d8 sidecar record 1 (a2b4499a):**
- `main:` "Molt AI platform infrastructure work — provisioning fixes, vault rollout, molt-connect v1.0, fleet health + backup validation"
- `sub1:` "Provisioning starts agents with dmPolicy/groupPolicy=open, lock on first /start"
- `sub2:` "EBS Backup tag fleet retag (daily→hourly) + AWS Backup selection update"
- `sub3:` "Aurora fleet reconciliation (12 rows fixed) + orchestrator customer-status/EIP propagation"
- **Quality: ✅ Excellent.** Specific, actionable, accurate.

**c975ec28 sidecar record 0 (3dd042cc):**
- `main:` "Implement signal collection layer for MoltAIconnect Mobile phase-03"
- `sub1:` "Define TypeScript types for signal snapshots and toggles"
- `sub2:` "Write individual collectors (GPS, battery, network, wifi, timezone, device, motion stub)"
- `sub3:` "Unified collectSignals() orchestrator with toggle filtering and timeouts"
- **Quality: ✅ Excellent.** Precise feature-level descriptions.

**b3b78b63 sidecar record 0 (a50749e6):**
- `main:` "Install Cloudflare WARP and test Reddit + HF signups with xvfb + Cloudflare egress IP"
- `sub1:` "Install and register Cloudflare WARP CLI on Clyde"
- `sub2:` "Establish WARP system-level tunnel (WireGuard kernel mode)"
- `sub3:` "Configure WARP SOCKS5 proxy as fallback for browser-level routing"
- **Quality: ✅ Excellent.** Clear task decomposition with concrete targets.

### Inline THREAD_META (in stub records — what the model actually got)

**4ce855d8 @ 2026-05-14 (inline only, stub not replaced):**
- `main:` "URL captured and the process is alive waiting for your code"
- `sub1-3:` "idle"
- **Quality: ⚠️ Poor.** "URL captured" is an action fragment, not a thread label. Reads like a status update snapshot, not an identity. Subs are all "idle" — useless.

**4ce855d8 @ 2026-05-16 (inline only, no sidecar):**
- `main:` "Read HEARTBEAT"
- `sub1-3:` "idle"
- **Quality: ❌ Bad.** "Read HEARTBEAT" is a single action from a prior turn, not what the session is about. No useful context preserved.

**7b43e0ae @ 2026-05-15 (inline only, no sidecar):**
- `main:` "You are currently working on: System: [2026-05-08 15:54:40 UTC] **Summary:** ..."
- `sub1-3:` "idle"
- **Quality: ❌ Bad.** Verbatim system message passthrough with a May 8 timestamp — stale by 7 days. Not a thread label at all; it's an unprocessed heartbeat injection.

### v1 sidecar (4ce855d8 @ 2026-05-13):
- `thread_meta:` {} (empty)
- **Quality: N/A** — v1 schema predates thread_meta. Expected.

**Inline quality summary:** 3 of 3 inline THREAD_META records are bad (action fragments, stale passthrough text, or single-action labels). The sidecar labels (where they exist) are consistently excellent. This underscores why hot-swap matters — the good labels are in the sidecar but never reach the session.

---

## 4. KSSR (Key State Retention Score)

| Session | Compaction TS | Detected | Preserved | KSSR |
|---|---|---|---|---|
| 4ce855d8 | 2026-05-13 (v1) | 1,633 | 0 | 0% |
| 4ce855d8 | 2026-05-14 (v3) | 1,519 | 20 (13 survived) | ~1% |
| c975ec28 | 2026-05-15 (v3) | 1,123 | 13 (5 survived) | 0% |
| b3b78b63 | 2026-05-14 (v3) | 101 | 17 (7 survived) | 7% |

**Aggregate: ~1% effective KSSR across all measured compactions.**

Notes:
- `detected` = key state items identified before compaction
- `preserved` = items that made it into the rich sidecar summary
- `survived` = items confirmed in post-compaction session state
- `LLM-added` = items the model introduced that weren't in detector (8-10 per compaction) — suggests model is supplementing, not relying on detector

KSSR is very low overall. Even the best compaction (b3b78b63 at 7%) retains only 7 of 101 detected state items. The detector is finding a lot, but retention is poor. Since hot-swap doesn't work, the rich sidecar content (which may have better retention) is never actually injected into the session.

---

## 5. Multi-Compaction Continuity (4ce855d8 — 3 compactions)

Ran `identity-report.js` across all sidecar sessions.

**Finding: NO lifecycle events recorded in any session (0/9 compactions across all active sidecars).**

For 4ce855d8 specifically:
- Sidecar record 0 (v1, 2026-05-13): `thread_meta: {}` — no canonical IDs
- Sidecar record 1 (v3, 2026-05-14): rich thread_meta with named sub IDs (`provisioning-allowlist-fix`, `backup-tag-alignment`, `aurora-drift-fix`, `vault-user-pass-mode`, `molt-connect-v1`)
- Third compaction (2026-05-16): NO sidecar record at all

The sidecar is missing the third compaction entirely — so canonical_id continuity can't be evaluated end-to-end. Between records 0 and 1, schema upgraded v1→v3 which means no ID carrythrough is possible from record 0.

**Verdict: Multi-compaction continuity cannot be confirmed.** The third compaction left no sidecar trace.

---

## 6. Lifecycle Events

**Zero lifecycle events across all 9 sidecars in the last 7 days.**

`identity-report.js` output:
```
sessions_seen=6
sessions_with_lifecycle=0
compactions_seen=9
compactions_with_lifecycle=0
events: (none)
```

This means Phase D lifecycle tracking is effectively dead. No thread births, deaths, resurrections, or merges are being recorded. Either:
1. Phase D code is not running
2. Phase D is running but no events have triggered (unlikely given 9 compactions)
3. Events are firing but not writing to sidecar

---

## 7. Sidecar-Missing Sessions Diagnosis

### f5422893-topic-5392 @ 2026-05-13T01:07Z
- **Vanilla compaction** (no KASETT_STUB, no THREAD_META)
- **No sidecar file**
- Custom events show a timeout+model-switch chain immediately before compaction: Opus→timeout→Sonnet→timeout→Kimi-K2.5→compaction
- The `openclaw:prompt-error` events at `2026-05-13T00:06:45` and `2026-05-13T01:07:16` indicate the model was mid-switch when compaction triggered
- **Likely cause:** Kasett plugin didn't inject a stub because the compaction was OC-triggered during a model-switch/timeout recovery sequence. Plugin may have been bypassed or the hook didn't fire for model-switch-triggered compactions.

### 4ce855d8-topic-5392 @ 2026-05-16T20:58Z
- **Stub present** (`KASETT_STUB::3f491911`) but NO sidecar record
- Sidecar file exists (2 records) but this third compaction added no record
- **Likely cause:** Kasett wrote the inline stub (hook fired), but the async sidecar-write step failed or was dropped. The stub_id `3f491911` exists in the JSONL but no corresponding sidecar record with that `compaction_id`. This is a partial failure — stub injection worked, sidecar generation didn't.

### 7b43e0ae @ 2026-05-15T22:11Z
- **Stub present** (`KASETT_STUB::26c08bef`) but NO sidecar file at all
- Session has 4,466 `custom` events (very long, active session)
- No kasett-specific custom events visible (only OC core events: model-snapshot, cache-ttl, prompt-error, bootstrap-context)
- **Likely cause:** This session had its first compaction before phase-g (2026-05-08, pre-cced56a). The second compaction (2026-05-15) wrote a stub inline, suggesting the plugin hook fires, but sidecar generation failed silently with no file created. The inline THREAD_META content is also stale (7-day-old system message passthrough), suggesting the thread_meta extraction logic is using cached/stale state from the first compaction.

---

## Summary Assessment

### What's Working (Post-Phase-G)
- ✅ **Sidecar generation** works for new sessions (c975ec28, b3b78b63 both got v3 sidecars)
- ✅ **Thread labeling quality in sidecars** is excellent — specific, meaningful, well-structured
- ✅ **Schema v3 structure** is properly formed with sub-IDs and status fields
- ✅ **Stub injection hook fires** (4ce855d8 comp 2 and 3, 7b43e0ae comp 2 all got stubs)

### What's Broken (Post-Phase-G)
- ❌ **Hot-swap: 0% complete** — stubs are NEVER replaced with rich sidecar content in the session JSONL
- ❌ **Inline THREAD_META quality is consistently poor** — action fragments, stale system message passthrough, or empty ("idle" subs)
- ❌ **Sidecar missing for 3 of 7 compactions** (f5422893 = plugin miss on model-switch; 4ce855d8-comp3 = sidecar write failed; 7b43e0ae = no sidecar file despite stub injection)
- ❌ **KSSR is ~1% effective** — key state not surviving compaction in meaningful quantities
- ❌ **Lifecycle events: 0** — Phase D tracking is not recording any events
- ❌ **Multi-compaction continuity unverifiable** — third compaction of 4ce855d8 has no sidecar, breaking the chain

### Priority Fixes
1. **Hot-swap must be implemented** — the rich content exists in sidecars but is never injected back. This is the single biggest gap; everything else is downstream of this.
2. **Sidecar write reliability** — async failure on 4ce855d8 comp 3 needs retry logic or synchronous fallback
3. **Plugin hook for model-switch-triggered compactions** — f5422893 shows the plugin misses when OC triggers compaction during a model recovery sequence
4. **Inline THREAD_META extraction** — the labels the model sees are wrong. "Read HEARTBEAT" and stale system messages are not useful thread state.
5. **Phase D lifecycle event tracking** — zero events in 9 compactions means the phase is either not deployed or not triggering

---

*Generated by kasett evaluation subagent | 2026-05-17*
