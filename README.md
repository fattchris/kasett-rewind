# kasett-rewind

OpenClaw compaction plugin implementing:

1. **Rolling Compaction Window** — retains N compaction summaries instead of one, preventing context loss across multiple compactions
2. **Structured Thread Tracking** — each compaction embeds main thread + sub-threads + key state as structured data
3. **ALLM Pattern Extraction** — extracts behavioral patterns from session data for adaptive LoRA lifecycle management

## Architecture

```
src/
├── index.ts              # Plugin entry point (OC compaction.provider registration)
├── compaction/
│   ├── provider.ts       # Core compaction provider (replaces OC built-in)
│   ├── window.ts         # Rolling window manager (read/write N summaries)
│   ├── threads.ts        # Thread tracker (extract & evolve threads)
│   └── prompt.ts         # Compaction prompt builder
├── allm/
│   ├── extractor.ts      # Pattern extraction from session JSONL
│   ├── vitality.ts       # Vitality scoring V(p,t)
│   ├── diff.ts           # Trailing-window diff engine
│   └── types.ts          # Pattern/score types
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
