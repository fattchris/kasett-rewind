# Installing kasett-rewind

## Quick Start (1 minute)

```bash
# 1. Install from GitHub
npm install -g git+https://github.com/fattchris/kasett-rewind.git

# 2. Generate your config
kasett-rewind generate-config

# 3. Paste the output into your openclaw.json → compaction section

# 4. Restart gateway
openclaw gateway restart
```

That's it. Your next compaction will produce structured summaries with thread tracking.

## What It Does

Without kasett-rewind:
```
[compaction happens]
Agent: "I was... doing something? Let me start fresh."
```

With kasett-rewind:
```
[compaction happens]
Agent: "Main thread: deploying M2.7 inference server.
Sub-threads: LoRA training pipeline (active), proxy SSE fix (blocked on upstream).
Key state: target_host=ml-prod-3.internal, model_version=2.7.1
Last compaction I was debugging the SSE timeout — that's resolved now."
```

## Options

```bash
# Default: windowSize=2, thread tracking ON
kasett-rewind generate-config

# Deeper memory (3 summaries retained)
kasett-rewind generate-config --window-size 3

# Just structured summaries, no thread tracking
kasett-rewind generate-config --no-thread-tracking

# Custom budget split (must sum to 1.0, length = windowSize + 1)
kasett-rewind generate-config --budget-split 0.25,0.35,0.4
```

## Verify It's Working

After your next compaction event, check the session JSONL:
```bash
grep "kasettMeta" ~/.openclaw/agents/main/sessions/*.jsonl
```

If you see `kasettMeta` in compaction events, it's live.

## Uninstall

Remove the `compaction.customInstructions` and plugin entry from openclaw.json, restart gateway. Agent reverts to default compaction immediately.
