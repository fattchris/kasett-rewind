# ◄◄ Press REWIND — Installation Guide

## Quick Start (30 seconds)

```bash
# Install the plugin
openclaw plugins install github:fattchris/kasett-rewind

# Generate config
npx kasett-rewind generate-config

# Paste the output into openclaw.json, then:
openclaw gateway restart
```

That's it. Next compaction = structured summaries with thread tracking.

## Local Development

```bash
# Clone the repo
git clone https://github.com/fattchris/kasett-rewind.git
cd kasett-rewind

# Build
npm run build

# Link into your OC install
openclaw plugins install --link .
```

The `--link` flag creates a symlink in `~/.openclaw/extensions/kasett-rewind/` pointing to your local checkout. Changes rebuild instantly.

## What It Does

**Without Kasett:**
```
[compaction happens]
Agent: "I was... doing something? Let me start fresh."
```

**With Kasett:**
```
[compaction happens]
Agent: "Main thread: deploying M2.7 inference server.
Sub-threads: LoRA training pipeline (active), proxy SSE fix (blocked).
Key state: target_host=ml-prod-3.internal, model_version=2.7.1
Previously completed: CI pipeline fix (depot runners), Docker image optimization."
```

## CLI Options

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

## Verify

After your next compaction event:

```bash
# Check plugin registered
openclaw logs | grep kasett-rewind

# Check structured output in session
grep "## Main Thread" ~/.openclaw/agents/*/sessions/*.jsonl
```

## Uninstall

```bash
openclaw plugins uninstall kasett-rewind
openclaw gateway restart
```

Agent reverts to default compaction immediately. No residue.

## Requirements

- OpenClaw >= 4.9
- Node.js >= 20
- Zero runtime dependencies
