# HALF 1 — Feedback Loop Code Path Verification

**Date:** 2026-05-12
**Goal:** Trace the actual data flow of the Kasett feedback loop in `repos/kasett-rewind/`, verify each link in the chain, and confirm whether the steering prompt ACTUALLY receives previous compactions' content.

**TL;DR:** ✅ The feedback loop fires end-to-end. Previous compactions are read, weighted, and inserted into the steering prompt. Stable IDs and key-state continuity are propagated. **Two minor surfaces are wired but not exercised** in the production `summarize()` path:
- `recentLifecycle` (lifecycle events from prior compaction's sidecar) is supported by `buildSteeringPrompt`/`buildJsonInstructions` but **not passed** in `index.ts buildCompactionContext()`. Lifecycle events are detected and stored on the sidecar (Phase D, in `worker.ts`), but the next compaction's steering prompt does not read them back.
- `windowSize` collection: only the *latest* summary is mined for `previousSubIds` / `previousKeyState`. Older summaries (slots 2 and 3) contribute to `weightedSummaries[]` (their full text is embedded in the prompt) but their structured IDs/key_state are not separately surfaced as continuity hints.

**Both gaps are non-blocking for HALF 2:** the LLM still sees the full text of the older summaries (with their JSON thread_meta inline), so the "feedback loop" of accumulating thread structure across compactions is genuinely live. The minor gaps degrade the *signal strength* of older context but do not break the chain.

Proceeding to HALF 2.

---

## Chain of evidence

### Step 1 — `before_compaction` captures session context

`src/index.ts:271-289`

```ts
api.on('before_compaction', async (event, ctx) => {
  const sessionKey = ctx.sessionKey?.trim() || ctx.sessionId;
  const agentId = ctx.agentId?.trim() || 'main';
  const stateDir = api.runtime.state.resolveStateDir();
  pendingCompactionCtx = { sessionKey, agentId, stateDir };
  ...
});
```

`pendingCompactionCtx` is stored at module level so `summarize()` (called by OC immediately after) can pick it up.

✅ **VERIFIED** — context capture works.

### Step 2 — `summarize()` reads previous summaries and key continuity hints

`src/index.ts:711-790` (`buildCompactionContext`):

```ts
// 1. Collect previous summaries (most-recent-first)
let previousSummaries: string[] = [];
if (params.previousSummary?.trim()) {
  previousSummaries = [params.previousSummary.trim()];
}
if (capturedCtx && previousSummaries.length < config.compaction.windowSize) {
  sessionFile = await resolveSessionFileFromState(...);
  if (sessionFile) {
    const needed = config.compaction.windowSize - previousSummaries.length;
    const events = await reader.readLastNSummaries(sessionFile, needed + 1);
    const fromJsonl = [...events].reverse();
    // dedupe + slice to needed
    previousSummaries = [...previousSummaries, ...fromJsonl.slice(0, needed)];
  }
}

// 2. Weight summaries by recency
const weighted = weightSummaries(previousSummaries, config.compaction.weights);

// 3. Extract previous v2 sub-thread IDs and v3 key_state from the LATEST summary
let previousSubIds: string[] | undefined;
let previousKeyState: KeyStateEntry[] | undefined;
if (previousSummaries.length > 0) {
  const latest = parseCompactionOutputBestEffort(previousSummaries[0]);
  if (latest.metaV2 && latest.metaV2.sub.length > 0) {
    previousSubIds = latest.metaV2.sub.map((s) => s.id);
  }
  if (latest.metaV3?.key_state && latest.metaV3.key_state.length > 0) {
    previousKeyState = latest.metaV3.key_state;
  }
}

// 3b. Detect candidate key state values from THIS conversation
let candidateKeyState: KeyStateEntry[] = [];
candidateKeyState = detectCandidateKeyState(params.messages...);

// 4. Build thread-aware steering prompt (v3/json by default)
const steeringPrompt = buildSteeringPrompt(weighted, {
  structuredOutput: 'json',
  ...(previousSubIds ? { previousSubIds } : {}),
  ...(previousKeyState ? { previousKeyState } : {}),
  ...(candidateKeyState.length > 0 ? { candidateKeyState } : {}),
});
```

`SessionReader.readLastNSummaries()` (in `src/storage/reader.ts:381-440`) is **sidecar-first**:
1. Reads the per-session sidecar (`<session>.jsonl.kasett-meta.jsonl`).
2. For each JSONL compaction event, looks up the matching sidecar entry by stub_id and substitutes the rich `summary_rich` for the OC stub.
3. Returns the resolved summaries oldest-first.

✅ **VERIFIED** — `readLastNSummaries` returns rich content from sidecar entries.

⚠️ **GAP:** `previousSubIds` and `previousKeyState` are only pulled from the **most recent** summary (`previousSummaries[0]`). The older summaries in the window (slots 2/3) contribute their full text via `weightedSummaries`, but their structured IDs/key_state are not extracted as separate continuity hints. The LLM still sees them inside the embedded JSON of each weighted summary's text.

⚠️ **GAP:** `recentLifecycle` is supported by `buildSteeringPrompt`'s options interface (`SteeringOptions.recentLifecycle`) and rendered by `buildJsonInstructions` (steering.ts ~440-470 — "Recent thread lifecycle (last compaction)" section) but `index.ts buildCompactionContext` never calls `reader.readLatestLifecycleEvents(sessionFile)`. So renames/merges/splits detected by the previous compaction's worker (and stored on the sidecar) are NOT surfaced to the next compaction's steering prompt.

### Step 3 — `weightSummaries` applies temporal decay

`src/threads/weight.ts:33-49`:

```ts
export function weightSummaries(summaries: string[], weights: number[]): WeightedSummary[] {
  return summaries.slice(0, weights.length).map((summary, i) => {
    const weight = weights[i] ?? 0;
    const label = i === 0
      ? `Previous summary (weight ${weight} — most recent)`
      : `Earlier summary (weight ${weight}...)`;
    return { summary, weight, label };
  });
}
```

Default `config.compaction.weights = [1.0, 0.6, 0.3]` (Phase 4 task spec). Window size 3.

✅ **VERIFIED** — weighting is mechanical and correct.

### Step 4 — `buildSteeringPrompt` embeds previous summaries with weights, IDs, key_state

`src/threads/steering.ts:321-380`:

```ts
sections.push('### Previous Compaction Summaries (for continuity)');
sections.push('Weight indicates how much influence each should have on the new summary: ...');
for (const ws of weightedSummaries) {
  sections.push(`#### ${ws.label}`);
  sections.push(ws.summary.trim()); // <-- raw summary text, with embedded JSON meta
}
sections.push('### Output Requirements');
sections.push(buildJsonInstructions(previousSubIds, candidateKeyState, previousKeyState, recentLifecycle));
```

`buildJsonInstructions` (steering.ts:421+) explicitly:
- Tells the LLM to REUSE previous sub IDs: `"Previous sub-thread IDs (REUSE when threads continue): ${ids}"`.
- Lists previous compaction's `key_state` as "carry forward when still relevant".
- Lists detector-found candidate key_state as hints.

✅ **VERIFIED** — the steering prompt assembled by `index.ts` contains:
- Up to 3 previous summaries (each tagged with weight + label).
- The full text of each summary (which includes its `[THREAD_META]` markdown or embedded `thread_meta_v2/v3` JSON).
- An explicit list of previous-compaction sub-thread IDs (mined from the *most recent* summary).
- Previous compaction's key_state list (mined from the *most recent* summary).
- Detector-discovered candidate key_state from THIS conversation.

### Step 5 — LLM call receives the steering prompt

`src/index.ts:843-896` (`callLLMForCompaction`):

```ts
const systemPrompt = systemParts.join(''); // = steeringPrompt + customInstructions
const userPrompt = '...summarize the conversation:\n\n' + messagesToText(messages);
// POST to OpenRouter or Anthropic with system/user prompts
```

✅ **VERIFIED** — the steering prompt becomes the LLM's system prompt verbatim.

### Step 6 — LLM output parsed; continuity carry-over checked

`src/threads/parser.ts` (`parseCompactionOutputBestEffort`) tries v3 → v2 → v1 in order. `parseCompactionOutputV3` returns:
- `metaV3.main` (one-sentence current main thread)
- `metaV3.sub[]` (each with stable `id`, `label`, `status`)
- `metaV3.key_state[]` (preserved values)
- `metaV3.decisions[]`, `metaV3.open_questions[]`

The LLM is *instructed* (steering prompt) to reuse `previousSubIds` for continuing threads. The parser does NOT enforce this — it simply parses what the LLM emits. Whether IDs actually carry over is observable but not enforced.

✅ **VERIFIED** — parsed output preserves the sub-thread IDs the LLM produced. Continuity is observable in `thread_meta_v2.sub[].id` matching across compactions.

### Step 7 — Sidecar write + lifecycle detection

`src/hotswap/worker.ts:200-340`:
- After LLM returns, parses with `parseCompactionOutputBestEffort`.
- Detects candidate key_state from the conversation (re-runs detector).
- Detects lifecycle events vs. the previous compaction's sidecar (`detectLifecycleEvents`).
- Writes the new sidecar entry with full `thread_meta_v3`, `key_state_candidates`, and `lifecycle_events`.

✅ **VERIFIED** — sidecar write is the source for the next compaction's `readLastNSummaries`.

⚠️ **GAP carrying forward:** the lifecycle_events written at compaction N are NOT read back when steering compaction N+1 (see Step 2 gap above).

---

## Standalone test confirming the chain

I built `research/phase4-results/test-feedback-loop.mjs` (next file) that:
1. Creates a fake session JSONL + sidecar with two prior compactions.
2. Calls the actual `SessionReader.readLastNSummaries`, `parseCompactionOutputBestEffort`, `weightSummaries`, and `buildSteeringPrompt` from the built dist.
3. Asserts the steering prompt contains: previous summaries' text, previous sub IDs, previous key_state values.

Output of that test: see `research/phase4-results/test-feedback-loop.out`.

---

## Decision: proceed to HALF 2

The feedback loop is live. Multi-compaction accumulation works at the structural level. Phase 4 will measure whether this structural carryover translates into behavioral (recall) wins.

**Note for paper:** the lifecycle-events gap is a real limitation worth disclosing — the system *detects* renames/merges/splits but doesn't currently re-surface them to the LLM. If Phase 4 shows separation, the paper should note that this represents a *lower bound* on Kasett's potential.
