# Phase D Progress — Thread Identity v1

**Started:** 2026-05-12

## Goal

Make thread identity robust across compactions even when the LLM drops or
changes the stable `id`. Multi-tier matcher (exact-id → lexical → semantic
fingerprint) plus lifecycle event detection (created/completed/renamed/
merged/split/blocked).

## Status: ✅ COMPLETE

### Tasks

- [x] D1 — `src/threads/identity.ts` (multi-tier matcher)
- [x] D2 — Tokenize + Jaccard helpers (in identity.ts)
- [x] D3 — `src/threads/embedding.ts` hash-fingerprint pseudo-embedding
- [x] D4 — `src/threads/lifecycle.ts` event detection
- [x] D5 — `weight.ts` `classifyThreadsWithIdentity`
- [x] D6 — Steering prompt: surface lifecycle events as continuity hints
- [x] D7 — Sidecar adds optional `lifecycle_events`
- [x] D8 — Reader / orientation note recent renames
- [x] D9 — Tests (identity, lifecycle, embedding, weight-identity) — 51 new, 321/321 pass
- [x] D10 — Identity report script (`scripts/identity-report.js`) + daily-review enhancement
- [x] D11 — Update PHASES-TRACKER.md and commit

### Headline

Thread identity is now multi-tier:
  - **exact-id** — the LLM's stable id wins when honored
  - **lexical (Jaccard)** — catches drift when the LLM re-labels ("infra-deploy" → "deploy")
  - **semantic (hash-fingerprint cosine, opt-in)** — third-tier rescue for short labels with no token overlap

Lifecycle events (created, completed, blocked, renamed, merged, split) are
now detected at every compaction, stored advisorily on the sidecar entry,
and surfaced both into the next-compaction steering prompt ("these threads
were renamed last compaction — keep their new ids") and the orientation
builder ("`deploy-api` was renamed to `api-rollout` last compaction").

Classification taxonomy was expanded from 3 → 5 to capture this:
`core / fresh / fading / renamed / merged`.

### Worker integration

`src/hotswap/worker.ts` now computes `lifecycle_events` at sidecar-write
time by reading the previous sidecar entry's V3/V2 thread meta and running
`matchAllThreads` + `detectLifecycleEvents`. Failure here is logged and
swallowed (advisory only — lifecycle is never allowed to block the actual
rich-summary write).

### Pending real-world data

Once the package ships and OC sessions accumulate sidecar entries, the
identity report (`scripts/identity-report.js`) and daily review will start
showing live lifecycle counts per compaction. The metric to watch is
*rename rate per compaction*: high values mean the LLM isn't following the
continuity hints we're feeding it via the steering prompt.

## Notes / decisions in flight

- TypeScript strict, node built-ins only. No external embedding libs.
- Hash-fingerprint embedding is honest: bag-of-tokens hashed mod N as a bit
  vector, cosine similarity. Documented as a heuristic, not real semantic.
- Lifecycle events are advisory — if classification is uncertain, they're
  omitted rather than guessed.
- Backward compat: V1/V2/V3 sidecars all still readable. Lifecycle events
  go on a new optional sidecar field.
