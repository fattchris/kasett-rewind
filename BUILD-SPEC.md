# Build Spec — kasett-rewind

## Overview

An OpenClaw plugin that replaces single-shot compaction with a rolling window of structured summaries. When enabled, it controls both the compaction prompt (what gets generated) and the context loading (what gets injected back).

---

## Config Schema

```json
{
  "plugins": {
    "entries": {
      "kasett-rewind": {
        "enabled": true,
        "path": "./node_modules/kasett-rewind",
        "config": {
          "windowSize": 2,
          "windowBudgetSplit": [0.3, 0.3, 0.4],
          "threadTracking": true
        }
      }
    }
  }
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch. When `false`, plugin is completely inert — OC uses default compaction, no custom instructions injected, no multi-summary loading. |
| `windowSize` | integer (1-5) | `2` | How many compaction summaries to retain in the rolling window. `1` = single summary (same as default OC, but with structured format). |
| `windowBudgetSplit` | number[] | `[0.3, 0.3, 0.4]` | Token budget proportions. Array length MUST equal `windowSize + 1`. Last element = recent turns. Must sum to 1.0. |
| `threadTracking` | boolean | `true` | Whether to enforce structured thread snapshots in compaction output. Can be disabled independently of windowing. |

### Validation Rules

- `windowBudgetSplit.length === windowSize + 1`
- `windowBudgetSplit.reduce((a, b) => a + b) === 1.0` (±0.01 tolerance)
- `windowSize >= 1 && windowSize <= 5`
- If `enabled === false`, all other fields are ignored

---

## How It Works — The Two Hooks

The plugin operates through **two** integration points with OC:

### Hook 1: Compaction Generation (what gets written)

When OC triggers compaction, the plugin controls the summarization prompt to produce structured output with thread tracking.

**Phase 1 (today):** Uses `compaction.customInstructions` — a string injected into OC's existing summarization prompt. Plugin generates this string based on config.

**Phase 2 (future):** Registers as `compaction.provider` — fully replaces OC's summarization logic. Plugin receives turns, calls LLM directly, returns structured summary.

### Hook 2: Context Loading (what gets read back)

When OC rebuilds context after compaction, the plugin controls how many summaries are loaded and how they're formatted.

**Phase 1 (today):** Uses `compaction.maxHistoryShare` + `compaction.postCompactionSections` to inject previous summaries back into context. Limited but functional.

**Phase 2 (future):** Registers a context loader that reads N summaries from the session JSONL and formats them with proper budget allocation.

### The `enabled` Flag Gates Both

```
enabled = false:
  - Hook 1: No customInstructions injected, OC uses default prompt
  - Hook 2: No multi-summary loading, OC loads single summary as normal
  - Plugin is invisible, OC behavior unchanged

enabled = true:
  - Hook 1: customInstructions injected (Phase 1) or provider registered (Phase 2)
  - Hook 2: Multi-summary loading active, budget split applied
  - Structured thread tracking enforced (if threadTracking = true)
```

---

## Storage Format

### Session JSONL Events

Each compaction produces an event in the session JSONL:

```jsonl
{"type":"compaction","id":"cmp_abc123","timestamp":"2026-05-05T08:00:00Z","data":{"summary":"...","kasettMeta":{"windowIndex":0,"windowTotal":2,"threadSnapshot":{"mainThread":"Building auth system","subThreads":[{"name":"Database migration","status":"active","detail":"Postgres 15 upgrade"}],"keyState":{"targetVersion":"15.2","migrationFile":"/db/migrate/003.sql"},"unresolved":["Need to verify replication config"],"threadHistory":[{"thread":"CI pipeline fix","status":"completed","lastSeen":"2026-05-05T07:00:00Z"}]},"tokenCount":450}}}
```

The `kasettMeta` field is added alongside the standard `summary` field. OC's existing compaction reader ignores unknown fields, so this is backward-compatible.

### Reading Previous Summaries

On session load (or context rebuild), the plugin:
1. Reads the session JSONL
2. Finds all events with `type: "compaction"` that have `kasettMeta`
3. Takes the last N (per `windowSize`)
4. Formats them for context injection

If a session has compaction events WITHOUT `kasettMeta` (generated before the plugin was enabled), those are treated as windowSize=1 with no thread tracking — graceful degradation.

---

## Phase 1 Implementation (No OC Code Changes)

### What We Ship

1. **`customInstructions` generator** — Produces the instruction string based on config
2. **`postCompactionSections` loader** — Reads previous summaries and formats them for re-injection
3. **CLI tool** — `npx kasett-rewind generate-config` outputs the OC config block to paste

### OC Config Generated (Phase 1)

```json
{
  "compaction": {
    "customInstructions": "<generated structured prompt>",
    "postCompactionSections": ["kasett-window"],
    "maxHistoryShare": 0.6
  }
}
```

### customInstructions Content

The generated `customInstructions` string (injected into OC's summarization prompt):

```
IMPORTANT: Your compaction summary MUST follow this exact structure.

## Main Thread
[One sentence: the primary task/topic currently active]

## Active Sub-threads (max 3)
1. [Name] — [status: what's happening now]
2. [Name] — [status]  
3. [Name] — [status]

(If fewer than 3, list only what exists. Never invent threads.)

## Thread History
(Threads that were previously active but are now resolved. Include ALL threads from the previous compaction that are no longer active, with explicit status.)
- [Name]: [completed|blocked|backgrounded] — [one-line outcome/reason]

## Key State
(Specific values that MUST survive compaction. URLs, IDs, file paths, version numbers, config values, names. NOT topic labels — actual values.)
- [key]: [value]
- [key]: [value]

## Unresolved
(Things the user is waiting on, expects follow-up for, or that are blocked on external input.)
- [item]

## Summary
[Narrative of what happened, decisions made, and current direction. Focus on trajectory — where we came from, where we are, where we're heading. Max 60% of your output budget.]

RULES:
- Every thread from the previous compaction summary MUST appear in your output — either still in Active Sub-threads OR moved to Thread History with explicit status. Threads CANNOT silently disappear.
- Key State must contain SPECIFIC VALUES, not topic labels. "database" is not key state. "PostgreSQL 15.2 on db.prod.internal:5432" is key state.
- If this is the first compaction (no previous summary), populate all sections from the conversation. If there was a previous summary, evolve the threads from it.
```

### How Multi-Summary Loading Works (Phase 1)

OC's `postCompactionSections` allows injecting named sections after the compaction summary in context. The plugin registers a section provider called `kasett-window` that:

1. Reads session JSONL for previous compaction events with `kasettMeta`
2. Formats the N-1 older summaries (current summary is already in context via OC's normal path)
3. Returns formatted text block with budget-appropriate truncation

**Context layout (Phase 1):**
```
[System prompt]
[AGENTS.md sections]
[kasett-window: previous compaction summary N-1]  ← injected by plugin
[Current compaction summary N]                     ← normal OC behavior
[Recent turns]                                     ← normal OC behavior
```

### Limitations of Phase 1

- Token budget splitting is approximate (can't precisely control OC's allocation)
- Previous summary is injected but OC doesn't "know" about it for budget calculation
- Thread validation is prompt-level only (no programmatic retry on violation)
- Works within existing OC architecture, no fork needed

---

## Phase 2 Implementation (OC Plugin Hooks)

### What Changes

1. Plugin registers as `compaction.provider` — full control over summarization
2. Plugin registers a context loader — full control over what's injected
3. Token budget is precisely managed (plugin allocates per `windowBudgetSplit`)
4. Thread validation is programmatic (parse output, check rules, retry if needed)

### Registration

```typescript
// Plugin entry point — called by OC plugin loader
export function register(api: OpenClawPluginAPI): void {
  const config = api.getConfig<KasettConfig>('kasett-rewind');
  
  if (!config.enabled) return; // Completely inert
  
  const provider = new CompactionProvider(config);
  
  // Hook 1: Take over compaction generation
  api.compaction.registerProvider({
    name: 'kasett-rewind',
    summarize: (ctx) => provider.summarize(ctx, api.llm.call),
  });
  
  // Hook 2: Take over context loading
  api.compaction.registerContextLoader({
    name: 'kasett-rewind',
    load: (sessionId) => provider.getContextBlock(sessionId),
    budgetShare: config.windowBudgetSplit,
  });
}
```

### Context Layout (Phase 2)

```
[System prompt]
[AGENTS.md sections]
[kasett-rewind context block]
  ├── Compaction Summary N-1 (oldest retained)  [30% budget]
  ├── Compaction Summary N (newest)             [30% budget]
  └── [managed by plugin, not OC]
[Recent turns]                                   [40% budget]
```

### Thread Validation (Phase 2)

After the LLM produces a compaction summary:

```typescript
const rawOutput = await llmCall(systemPrompt, userContent);
const threadSnapshot = ThreadTracker.parse(rawOutput);

// Validate against previous
const violations = ThreadTracker.validate(threadSnapshot, previousSnapshot);

if (violations.length > 0 && retryCount < 2) {
  // Retry with explicit instructions about missing threads
  const retryPrompt = buildRetryPrompt(violations, rawOutput);
  return this.summarize(context, llmCall, retryCount + 1);
}
```

---

## CLI Interface

### Commands

```bash
# Generate OC config for Phase 1 (paste into openclaw.json)
npx kasett-rewind generate-config [--window-size 2] [--no-thread-tracking]

# Show current window state for a session
npx kasett-rewind status --session <sessionId>

# Validate thread evolution across compactions in a session
npx kasett-rewind validate --session <sessionId>

# Dry-run: show what the customInstructions would produce on sample input
npx kasett-rewind dry-run --input <session.jsonl>
```

### `generate-config` Output

```
✓ Generated kasett-rewind configuration:

Add to your openclaw.json → compaction section:

{
  "compaction": {
    "customInstructions": "IMPORTANT: Your compaction summary MUST follow this exact structure...",
    "maxHistoryShare": 0.6
  }
}

And add the plugin entry:

{
  "plugins": {
    "entries": {
      "kasett-rewind": {
        "enabled": true,
        "path": "./node_modules/kasett-rewind",
        "config": {
          "windowSize": 2,
          "windowBudgetSplit": [0.3, 0.3, 0.4],
          "threadTracking": true
        }
      }
    }
  }
}
```

---

## File Structure (Final)

```
kasett-rewind/
├── src/
│   ├── index.ts                 # Plugin entry point + register()
│   ├── types.ts                 # Config, summary, thread types
│   ├── compaction/
│   │   ├── provider.ts          # Core provider (summarize + context load)
│   │   ├── window.ts            # Rolling window state manager
│   │   ├── threads.ts           # Thread tracker (parse, validate, merge)
│   │   └── prompt.ts            # Prompt builder (customInstructions generator)
│   ├── storage/
│   │   ├── reader.ts            # Read compaction events from session JSONL
│   │   └── writer.ts            # Write kasettMeta alongside compaction events
│   ├── cli/
│   │   ├── index.ts             # CLI entry point
│   │   ├── generate-config.ts   # Config generator command
│   │   ├── status.ts            # Window status command
│   │   ├── validate.ts          # Thread validation command
│   │   └── dry-run.ts           # Dry-run summarization command
│   └── phase1/
│       ├── instructions.ts      # customInstructions string builder
│       └── section-loader.ts    # postCompactionSections provider
├── tests/
│   ├── fixtures/                # Sample session JSONL files
│   ├── window.test.ts           # Rolling window unit tests
│   ├── threads.test.ts          # Thread tracker unit tests
│   ├── prompt.test.ts           # Prompt generation tests
│   └── integration.test.ts     # End-to-end with real session data
├── patents/                     # Patent briefs (Rolling Compaction, ALLM, Combined)
├── research/                    # Prior art, neuroscience, experimental design
├── BUILD-SPEC.md               # This file
├── USER-STORIES.md             # User stories + priorities
├── README.md                   # Usage + quick start
├── package.json
└── tsconfig.json
```

---

## Build Order

### Sprint 1: Phase 1 Core (ship this week)

| Task | File | Story |
|------|------|-------|
| customInstructions generator | `src/phase1/instructions.ts` | E1.5 |
| Session JSONL reader | `src/storage/reader.ts` | E1.1 |
| Previous-summary section loader | `src/phase1/section-loader.ts` | E1.1 |
| Thread snapshot parser | `src/compaction/threads.ts` | E1.2 |
| Thread validation | `src/compaction/threads.ts` | E1.2 |
| CLI: generate-config | `src/cli/generate-config.ts` | E1.5 |
| Test fixtures (real sessions) | `tests/fixtures/` | All |
| Integration test | `tests/integration.test.ts` | All |

**Definition of done:** Running `npx kasett-rewind generate-config` produces a config block that, when pasted into openclaw.json, gives you structured compaction with thread tracking on your next compaction event.

### Sprint 2: Window Management + CLI

| Task | File | Story |
|------|------|-------|
| Rolling window manager | `src/compaction/window.ts` | E1.4 |
| Window budget calculation | `src/compaction/window.ts` | E1.4 |
| CLI: status | `src/cli/status.ts` | E1.3 |
| CLI: validate | `src/cli/validate.ts` | E1.2 |
| CLI: dry-run | `src/cli/dry-run.ts` | E1.5 |
| Thread history merging | `src/compaction/threads.ts` | E1.3 |
| Key state extraction heuristics | `src/compaction/threads.ts` | E1.6 |

### Sprint 3: Phase 2 Provider

| Task | File | Story |
|------|------|-------|
| Full compaction provider | `src/compaction/provider.ts` | E1.1-E1.6 |
| OC plugin registration | `src/index.ts` | E1.4 |
| Context loader (budget-aware) | `src/compaction/provider.ts` | E1.4 |
| Retry on thread validation failure | `src/compaction/provider.ts` | E1.2 |
| Writer (kasettMeta events) | `src/storage/writer.ts` | E1.1 |

---

## Enabled/Disabled Behavior Matrix

| Config State | Compaction Prompt | Multi-Summary Loading | Thread Tracking | Net Effect |
|-------------|-------------------|-----------------------|-----------------|------------|
| `enabled: false` | Default OC | Default OC (single summary) | None | Plugin invisible |
| `enabled: true, windowSize: 1, threadTracking: false` | Default OC | Default OC | None | Same as disabled (but registered) |
| `enabled: true, windowSize: 1, threadTracking: true` | Structured prompt injected | Single summary (normal) | Active | Better summaries, same window depth |
| `enabled: true, windowSize: 2, threadTracking: true` | Structured prompt injected | Loads 2 summaries | Active | Full rolling window + threads |
| `enabled: true, windowSize: 3, threadTracking: true` | Structured prompt injected | Loads 3 summaries | Active | Deep window (more memory, less room for new turns) |

---

## Edge Cases

### First Compaction (No Previous Summary)

- Thread snapshot has no history to validate against
- All threads are "emerging" — populated from conversation content
- customInstructions handles this: "If this is the first compaction, populate all sections from the conversation."

### Session Started Before Plugin Enabled

- Existing compaction events lack `kasettMeta`
- Reader falls back: treats the raw `summary` field as a single unstructured summary
- No thread validation against unstructured summaries
- Next compaction event WILL have `kasettMeta` — the window starts building from that point

### Plugin Enabled → Disabled → Re-enabled

- When disabled: OC generates normal unstructured summaries
- When re-enabled: Reader finds the most recent events WITH `kasettMeta`, skips unstructured ones
- Thread continuity may be broken across the gap — acceptable, threads will repopulate from conversation

### Token Budget Exceeded

- If previous summaries exceed their allocated budget, they are truncated (thread snapshot preserved first, narrative truncated)
- Truncation order: narrative summary → thread history → unresolved → key state (key state survives longest)

### Model Can't Follow Structure

- Some models produce garbage when asked for structured output
- Fallback: if thread snapshot parsing fails, store the raw summary with empty thread snapshot
- Log warning, don't crash
- Status command shows "⚠ thread tracking failed on last N compactions"

---

## Testing Strategy

### Unit Tests
- Window: push/pop/budget calculation/edge cases (window full, window empty, window=1)
- Threads: parse structured output, validate evolution, merge history
- Prompt: output matches expected format, handles 0/1/N previous summaries

### Integration Tests
- Take real session JSONL (from Clyde's own sessions)
- Run full pipeline: read → generate prompt → (mock LLM) → parse → validate → write
- Verify thread continuity across 3+ compaction cycles

### Quality Tests (manual, for validation)
- Run customInstructions against real compaction events
- Human-eval: are threads tracked correctly? Does key state survive?
- Compare against default OC compaction on same input

---

## Dependencies

### Runtime
- None (zero external deps). Uses Node.js built-ins only.

### Dev
- `typescript` — compilation
- `@types/node` — type definitions

### Peer (host provides)
- OpenClaw >= 4.9 (for `compaction.customInstructions` hook)
- Node.js >= 20

---

## Open Questions (Decide During Build)

1. **Should the plugin write its own JSONL events, or rely on OC to write them?**
   - Phase 1: OC writes the compaction event, plugin reads it back
   - Phase 2: Plugin may write enriched events with kasettMeta

2. **How do we handle the budget split without OC's cooperation in Phase 1?**
   - Option A: Set `maxHistoryShare` higher and trust the ratio works out
   - Option B: Truncate previous summaries ourselves in the section loader

3. **Thread tracking across sessions (not just compactions within a session)?**
   - Out of scope for v1. Thread state is per-session.
   - Future: persist thread state to agent memory files for cross-session continuity

4. **Notification on thread validation failure?**
   - Phase 1: Log only
   - Phase 2: Retry with explicit fix instructions
   - Future: Alert operator via channel message
