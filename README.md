# kasett-rewind

OpenClaw compaction plugin implementing:

1. **Rolling Compaction Window** — retains N compaction summaries instead of one, preventing context loss across multiple compactions
2. **Structured Thread Tracking** — each compaction embeds main thread + sub-threads + key state as structured data

ALLM (Adaptive LoRA Lifecycle Management) is a separate system in the broader ecosystem. Research and patent briefs for ALLM live in this repo under `/research` and `/patents`, but the code is out of scope for this plugin.

## Architecture

```
src/
├── index.ts              # Plugin entry point (OC compaction.provider registration)
├── compaction/
│   ├── provider.ts       # Core compaction provider (replaces OC built-in)
│   ├── window.ts         # Rolling window manager (read/write N summaries)
│   ├── threads.ts        # Thread tracker (extract & evolve threads)
│   └── prompt.ts         # Compaction prompt builder
└── types.ts              # Shared types & OC plugin interface
```

## Status

**Phase 1** — Plugin scaffold + compaction provider using existing OC hooks.

## Usage

```json
// openclaw.json
{
  "plugins": {
    "entries": {
      "kasett-rewind": {
        "path": "./path/to/kasett-rewind",
        "enabled": true,
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

## License

Proprietary — Molt AI Corp. All rights reserved.
