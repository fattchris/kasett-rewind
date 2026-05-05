```
  ┌─────────────────────────────────────────────────────────────────┐
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │  ░░╔═══════════════════════════════════════════════════════╗░░  │
  │  ░░║                                                       ║░░  │
  │  ░░║    ██╗  ██╗ █████╗ ███████╗███████╗████████╗████████╗ ║░░  │
  │  ░░║    ██║ ██╔╝██╔══██╗██╔════╝██╔════╝╚══██╔══╝╚══██╔══╝ ║░░  │
  │  ░░║    █████╔╝ ███████║███████╗█████╗     ██║      ██║    ║░░  │
  │  ░░║    ██╔═██╗ ██╔══██║╚════██║██╔══╝     ██║      ██║    ║░░  │
  │  ░░║    ██║  ██╗██║  ██║███████║███████╗   ██║      ██║    ║░░  │
  │  ░░║    ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝      ╚═╝    ║░░  │
  │  ░░║                                                       ║░░  │
  │  ░░║              ◄◄  R E W I N D  ►►                      ║░░  │
  │  ░░║                                                       ║░░  │
  │  ░░╚═══════════════════════════════════════════════════════╝░░  │
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │                                                                 │
  │    ◉                    ┌──────────┐                    ◉       │
  │                         │ ▓▓▓▓▓▓▓▓ │                            │
  │       ╭──────╮          │ ▓▓▓▓▓▓▓▓ │          ╭──────╮         │
  │       │ ╭──╮ │          │ ▓▓▓▓▓▓▓▓ │          │ ╭──╮ │         │
  │       │ │⟳ │ │          │ ▓▓▓▓▓▓▓▓ │          │ │  │ │         │
  │       │ ╰──╯ │          │ ▓▓▓▓▓▓▓▓ │          │ ╰──╯ │         │
  │       ╰──────╯          └──────────┘          ╰──────╯         │
  │                                                                 │
  │   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   │
  │   ▏ SIDE A: ROLLING WINDOW    ▕▏ SIDE B: THREAD TRACKING  ▕   │
  │   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   │
  │                                                                 │
  │  TYPE: C-120 CHROME HIGH BIAS  ▸ DOLBY NR: ON  ▸ v0.1.0       │
  └─────────────────────────────────────────────────────────────────┘
```

<p align="center">
  <em>Your agent's memory is a tape. Every compaction records over the last take.</em><br/>
  <em>Kasett gives you the rewind button.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/openclaw-%3E%3D4.9-ff00ff?style=flat-square&labelColor=1a1a2e" alt="OpenClaw >=4.9" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-00ffff?style=flat-square&labelColor=1a1a2e" alt="Node >=20" />
  <img src="https://img.shields.io/badge/deps-zero-ff6600?style=flat-square&labelColor=1a1a2e" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/license-proprietary-ffff00?style=flat-square&labelColor=1a1a2e" alt="License" />
</p>

---

## ◈ The Problem

Every time your agent hits the context limit, OpenClaw compacts — it summarizes the conversation and throws away the raw turns. This is necessary. But it's lossy. **Critically lossy.**

Here's what vanilla compaction does to your agent:

```
Session turn 1-500:    "Building auth system, migrating Postgres, fixing CI..."
                                          ↓
                       [ C O M P A C T I O N ]
                                          ↓
Session turn 501+:     "I was... working on something with a database?"
```

Threads silently vanish. Key state evaporates. The agent loses track of what it was doing, what it was waiting on, who it was waiting for. **It's like someone recorded static over your mixtape.**

Kasett Rewind stops the tape from eating itself.

---

## ◈ Track Listing

### SIDE A — Rolling Window

| # | Track | What It Does |
|---|-------|-------------|
| A1 | **Multi-Summary Retention** | Keep 2-5 compaction summaries instead of just the last one |
| A2 | **Budget-Aware Splitting** | Allocate token budget across old summaries + new turns |
| A3 | **Graceful Degradation** | Works with sessions that predate the plugin |
| A4 | **Zero Dependencies** | Pure Node.js. No npm bloat. No supply chain risk. |

### SIDE B — Thread Tracking

| # | Track | What It Does |
|---|-------|-------------|
| B1 | **Structured Thread Snapshots** | Main thread, sub-threads, key state — every compaction |
| B2 | **Thread Evolution Rules** | Threads can't silently disappear. They must be explicitly resolved. |
| B3 | **Key State Preservation** | URLs, IDs, config values survive compaction. Actually. |
| B4 | **History Tracking** | Completed threads stay visible, with explicit outcomes |

---

## ◈ Press REWIND (Installation)

### 30 seconds. No excuses.

```bash
# From GitHub
openclaw plugins install github:fattchris/kasett-rewind

# Or link for local dev
openclaw plugins install --link /path/to/kasett-rewind
```

Generate your config:

```bash
npx kasett-rewind generate-config
```

Paste the output into `openclaw.json`. Restart:

```bash
openclaw gateway restart
```

**Done.** Next compaction, the tape starts recording properly.

---

## ◈ How It Works

```
                    ┌─────────────────────────────┐
                    │    before_compaction hook     │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │ Parse previous summary │  │
                    │  │ for thread state       │  │
                    │  └───────────┬───────────┘  │
                    │              ▼              │
                    │  ┌───────────────────────┐  │
                    │  │ Inject structured      │  │
                    │  │ instructions into      │  │
                    │  │ customInstructions     │  │
                    │  └───────────┬───────────┘  │
                    └──────────────┼──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │   OC's built-in summarizer   │
                    │   (runs with our prompt)     │
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │    after_compaction hook      │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │ Parse output into      │  │
                    │  │ ThreadSnapshot         │  │
                    │  └───────────┬───────────┘  │
                    │              ▼              │
                    │  ┌───────────────────────┐  │
                    │  │ Validate thread        │  │
                    │  │ evolution rules        │  │
                    │  └───────────┬───────────┘  │
                    │              ▼              │
                    │  ┌───────────────────────┐  │
                    │  │ Warn on violations     │  │
                    │  │ (dropped threads, etc) │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
```

The plugin never calls the LLM directly. It doesn't replace OC's summarizer — it **augments** it. Your compaction still uses the same model, same flow. We just make sure the output is structured and nothing gets lost in the noise.

---

## ◈ Before / After

### ❌ Without Kasett (default OC compaction)

```markdown
The user was working on deploying something and there was a discussion
about databases. They also mentioned some CI issues. The conversation
covered several technical topics including infrastructure and testing.
```

*Cool. Very helpful. Thanks for nothing.*

### ✅ With Kasett

```markdown
## Main Thread
Deploying M2.7 inference server to ml-prod-3.internal

## Active Sub-threads
1. LoRA training pipeline — configuring checkpoint schedule (every 500 steps)
2. Proxy SSE fix — blocked on upstream nginx module release (ETA: Thursday)
3. Load test harness — writing k6 script, targeting 200 RPS sustained

## Thread History
- CI pipeline fix: completed — switched to depot runners, build time 4m→47s
- Docker image size: completed — multi-stage build, 2.1GB→340MB

## Key State
- target_host: ml-prod-3.internal
- model_version: 2.7.1
- checkpoint_interval: 500 steps
- nginx_issue: https://github.com/nginx/nginx/issues/4821
- k6_script: /tests/load/inference-sustained.js

## Unresolved
- Waiting on nginx upstream fix before SSE proxy can ship
- Need to verify GPU memory under sustained 200 RPS load

## Summary
Deploying the M2.7 model. Main blocker is the SSE proxy for streaming
responses — nginx module has a known bug with chunked transfer encoding.
Workaround deployed (direct connection) but production needs the proxy.
LoRA training scheduled to start after deploy confirms stable. Load
testing infrastructure is ready, just needs the k6 script finished.
```

**Every thread accounted for. Every value preserved. Nothing silently eaten.**

---

## ◈ Configuration

```jsonc
// openclaw.json
{
  "plugins": {
    "entries": {
      "kasett-rewind": {
        "enabled": true,
        "config": {
          "windowSize": 2,              // Keep 2 summaries in the rolling window
          "windowBudgetSplit": [0.3, 0.3, 0.4],  // [oldest, newest, recent turns]
          "threadTracking": true        // Enforce structured thread snapshots
        }
      }
    }
  }
}
```

### Config Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch. `false` = plugin is invisible. |
| `windowSize` | `1-5` | `2` | Summaries retained. Higher = deeper memory, less room for new turns. |
| `windowBudgetSplit` | `number[]` | `[0.3, 0.3, 0.4]` | Budget proportions. Length = `windowSize + 1`. Sum = `1.0`. |
| `threadTracking` | `boolean` | `true` | Structured thread snapshots. Can disable independently of windowing. |
| `compactionModel` | `string` | *(unset)* | Model for compaction LLM calls. Omit or set to `"default"` to use the agent's primary model (from `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY` env). Set to a model string to pin a specific model — e.g. `"claude-haiku-3-5-20241022"` (Anthropic direct) or `"anthropic/claude-haiku-3-5"` (OpenRouter). |

### Budget Split Explained

```
windowSize: 2, budgetSplit: [0.3, 0.3, 0.4]
                                │    │    │
                                │    │    └── 40% → Recent conversation turns
                                │    └─────── 30% → Most recent compaction summary
                                └──────────── 30% → Older compaction summary
```

More window = deeper memory but less room for new work. `windowSize: 2` is the sweet spot for most agents.

---

## ◈ CLI

```bash
# Generate config to paste into openclaw.json
kasett-rewind generate-config
kasett-rewind generate-config --window-size 3
kasett-rewind generate-config --no-thread-tracking
kasett-rewind generate-config --budget-split 0.2,0.2,0.2,0.4
```

---

## ◈ The Rules of the Tape

Thread tracking enforces these invariants across compactions:

1. **No silent disappearances.** Every thread from the previous compaction must appear in the new one — either still active or explicitly moved to history with a status.

2. **Key state is specific.** `"database"` is not key state. `"PostgreSQL 15.2 on db.prod.internal:5432"` is key state. Values, not labels.

3. **Max 3 active sub-threads.** If a 4th emerges, the lowest-activity thread gets backgrounded. Forcing prioritization.

4. **History has outcomes.** When a thread moves to history, it gets an explicit status: `completed`, `blocked`, `backgrounded`. No ambiguity.

5. **Evolution, not revolution.** The summary evolves from the previous one. It's a living document, not a fresh take every time.

---

## ◈ Architecture

```
src/
├── index.ts                    # Plugin entry — register() hooks
├── types.ts                    # Config, summary, thread types
├── compaction/
│   ├── provider.ts             # Full CompactionProvider (Phase 2)
│   ├── window.ts               # Rolling window state manager
│   ├── threads.ts              # Thread tracker: parse, validate, merge
│   └── prompt.ts               # Prompt builder for full provider mode
├── phase1/
│   ├── instructions.ts         # customInstructions string generator
│   └── section-loader.ts       # Multi-summary context injector
├── storage/
│   └── reader.ts               # Session JSONL reader
└── cli/
    ├── index.ts                # CLI entry point
    └── generate-config.ts      # Config generator command
```

---

## ◈ Verify It's Working

After your next compaction:

```bash
# Check for structured output in session logs
grep -l "## Main Thread" ~/.openclaw/agents/*/sessions/*.jsonl

# Or check plugin logs
openclaw logs | grep kasett-rewind
```

You should see:
```
[kasett-rewind] Registering — window=2, threads=true
[kasett-rewind] Thread evolution validated ✓
```

If you see thread evolution violations, the LLM dropped a thread. The warning is the plugin doing its job — flagging the loss so you know.

---

## ◈ Roadmap

```
 NOW            NEXT              LATER
  │               │                 │
  ▼               ▼                 ▼
┌─────────┐   ┌──────────┐   ┌──────────────┐
│ Phase 1  │   │ Phase 2   │   │ Phase 3       │
│          │   │           │   │               │
│ Hook-    │   │ Full      │   │ Cross-session │
│ based    │   │ Compac-   │   │ thread state  │
│ instruc- │   │ tion      │   │               │
│ tion     │   │ Provider  │   │ ALLM feed     │
│ injection│   │           │   │ (LoRA         │
│          │   │ Programm- │   │  extraction)  │
│ Thread   │   │ atic      │   │               │
│ valida-  │   │ retry on  │   │ Agent memory  │
│ tion     │   │ violation │   │ graph         │
│ (warn)   │   │           │   │               │
└─────────┘   └──────────┘   └──────────────┘
    ▲
    │
  YOU ARE HERE
```

---

## ◈ Why "Kasett"?

Swedish for cassette. Because:

- Compaction = the tape recording forward, overwriting what came before
- Rewind = our plugin, giving you back what got recorded over
- Rolling window = keeping multiple tracks on the tape instead of just the last one
- Thread tracking = the track listing on the sleeve — you always know what's on side A

The metaphor isn't just cute. It's how it actually works. The tape is your context window. Every compaction lays down a new track. Without Kasett, the old tracks are gone. With Kasett, you can rewind.

---

## ◈ License

Proprietary — Molt AI Corp. All rights reserved.

---

<p align="center">
  <code>[ ◄◄ REWIND ] [ ▮▮ PAUSE ] [ ► PLAY ] [ ■ STOP ] [ ►► FF ]</code>
</p>

<p align="center">
  <em>Don't let your agent forget what it was doing.<br/>Press rewind.</em>
</p>
