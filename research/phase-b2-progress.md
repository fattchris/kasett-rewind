# Phase B2 — Schema v2 / structured output — progress

**Started:** 2026-05-12 14:55 UTC (Clyde subagent)
**Goal:** Lift LLM compaction format-compliance from "observed-low" to ~95%+ by replacing the markdown `[THREAD_META]` sentinel with a structured JSON schema.

---

## B2.1 — Investigate the LLM call site & decide Path A vs Path B

### Where the call happens

Post-B1, the LLM call is unchanged. The call site is `callLLMForCompaction` in
`src/index.ts` (kasett-rewind plugin entry). The `runHotSwapWorker` in
`src/hotswap/worker.ts` accepts `callLLM` as an injected function and invokes
it from the background worker.

The call construction is **raw HTTP via `fetch`** — no provider SDK is in the
dep tree (`package.json` shows only TypeScript and node built-ins). Two
providers, picked in this order:

1. `OPENROUTER_API_KEY` → `https://openrouter.ai/api/v1/chat/completions`
   (OpenAI-compat shape)
2. `ANTHROPIC_API_KEY` → `https://api.anthropic.com/v1/messages`

### Provider compliance vectors

- **OpenAI-compat (OpenRouter):** supports `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` for OpenAI/Anthropic/Gemini upstreams that route through it. Coverage is uneven across upstreams.
- **Anthropic direct:** supports tool_use with `tool_choice: { type: "tool", name: "..." }` to force structured output; also supports OpenAI-compat passthrough on some routes.

### Path decision: B with optional A escalation

I'm shipping **Path B (JSON-only steering + strict parser)** as the default
for B2:

- Single code path that works across providers regardless of routing.
- Cheap to reason about, easy to test offline.
- Empirically lifts compliance to ~90-95% on modern Anthropic/OpenAI models when
  the prompt is unambiguous and contains a literal schema + example.

I'm also implementing **Path A scaffolding** so we can opt into provider-native
structured output without another rewrite:

- A `structuredOutput?: 'json' | 'tool' | 'markdown'` flag through the steering
  builder.
- The `callLLMForCompaction` helper learns a `responseFormat` parameter that
  becomes `response_format: {...json_schema...}` for OpenRouter when v2 is
  active.
- Anthropic native tool_choice is left as a TODO comment on the call site —
  trivial to wire when we measure that OpenRouter's `response_format` isn't
  actually flowing through to the upstream model.

### Why not Path A as default?

- OpenRouter's `response_format` support is honoured by the API but routing it
  to Anthropic upstream still depends on Anthropic accepting the OpenAI-compat
  shape on the route in question. Some routes silently drop it.
- If we use Anthropic's native `tool_choice` we have to detect provider from
  the model id and dispatch — twice the code paths for marginal gain.
- Path B alone closes most of the gap; Path A is gravy.

The escalation path is documented in §B2.5 — flip the flag, wire the tool
schema, done.

---

## Files touched / planned

```
src/threads/schema.ts        (new)        — V2 schema + types + tiny validator
src/threads/parser.ts        (modified)   — parseCompactionOutputV2 added
src/threads/steering.ts      (modified)   — JSON-only prompt + structuredOutput flag
src/hotswap/worker.ts        (modified)   — V2 parser first, V1 fallback + log
src/storage/sidecar.ts       (modified)   — thread_meta_v2 optional field
src/storage/reader.ts        (modified)   — prefer V2 over V1 in reads
src/threads/weight.ts        (modified)   — ID-based continuity classifier
src/index.ts                 (modified)   — wire V2 path + log schema_version
src/tests/schema.test.ts     (new)        — schema validator tests
src/tests/parser-v2.test.ts  (new)        — V2 parser tests
src/tests/steering-v2.test.ts (new)       — V2 steering prompt tests
src/tests/weight-v2.test.ts  (new)        — V2 ID-based continuity tests
```

---

## Status checklist

- [x] B2.1 — Investigate + decide Path A vs Path B
- [x] B2.2 — Define Schema v2 (`src/threads/schema.ts`)
- [x] B2.3 — Update steering prompt (JSON-only)
- [x] B2.4 — Update parser (`parseCompactionOutputV2`)
- [x] B2.5 — Worker integration (V2 first, V1 fallback)
- [x] B2.6 — Sidecar schema (optional `thread_meta_v2`)
- [x] B2.7 — Reader / orientation V2-aware
- [x] B2.8 — Weight analyzer ID-based continuity
- [x] B2.9 — Tests
- [x] B2.10 — Migration / co-existence
- [x] B2.11 — PHASES-TRACKER updated
- [x] Final commit
