#!/bin/bash
# kasett-rewind daily compaction review
# Runs via OC cron — finds all sessions compacted in last 24h,
# extracts compaction summaries, evaluates thread continuity.
# Output: research/daily-reviews/YYYY-MM-DD.md

set -euo pipefail

REPO_DIR="/home/node/.openclaw/workspace/repos/kasett-rewind"
SESSIONS_DIR="/home/node/.openclaw/agents/main/sessions"
META_DIR="/home/node/.openclaw/agents/main/plugins/kasett-rewind/meta"
TODAY=$(date -u +%Y-%m-%d)
OUTPUT="$REPO_DIR/research/daily-reviews/$TODAY.md"

echo "# Compaction Review — $TODAY" > "$OUTPUT"
echo "" >> "$OUTPUT"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Find sessions with checkpoint files modified in last 24h (compaction creates these)
COMPACTED=0
KASETT_HANDLED=0
VANILLA_HANDLED=0

echo "## Sessions Compacted (last 24h)" >> "$OUTPUT"
echo "" >> "$OUTPUT"

for checkpoint in $(find "$SESSIONS_DIR" -name "*.checkpoint.*.jsonl" -mtime -1 2>/dev/null); do
  session_file=$(echo "$checkpoint" | sed 's/\.checkpoint\.[^.]*\.jsonl/.jsonl/')
  session_id=$(basename "$session_file" .jsonl)
  COMPACTED=$((COMPACTED + 1))
  
  # Check if kasett sidecar exists for this session
  sidecar_pattern=$(echo "$session_id" | tr '-' '_')
  if find "$META_DIR" -name "*${sidecar_pattern}*" -mtime -1 2>/dev/null | grep -q .; then
    KASETT_HANDLED=$((KASETT_HANDLED + 1))
    echo "- ✅ \`$session_id\` — kasett handled" >> "$OUTPUT"
    
    # Extract thread meta from sidecar
    sidecar=$(find "$META_DIR" -name "*${sidecar_pattern}*" -mtime -1 2>/dev/null | head -1)
    if [ -n "$sidecar" ]; then
      echo "  - Main: $(jq -r '.main // "unknown"' "$sidecar" 2>/dev/null)" >> "$OUTPUT"
      echo "  - Threads: $(jq -r '.sub | length // 0' "$sidecar" 2>/dev/null)" >> "$OUTPUT"
    fi
  else
    VANILLA_HANDLED=$((VANILLA_HANDLED + 1))
    echo "- ⚠️ \`$session_id\` — vanilla OC (no kasett sidecar)" >> "$OUTPUT"
  fi
done

if [ $COMPACTED -eq 0 ]; then
  echo "_No compaction events in the last 24 hours._" >> "$OUTPUT"
fi

echo "" >> "$OUTPUT"
echo "## Summary" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| Metric | Value |" >> "$OUTPUT"
echo "|--------|-------|" >> "$OUTPUT"
echo "| Total compacted | $COMPACTED |" >> "$OUTPUT"
echo "| Kasett handled | $KASETT_HANDLED |" >> "$OUTPUT"
echo "| Vanilla fallback | $VANILLA_HANDLED |" >> "$OUTPUT"
echo "| Coverage | $([ $COMPACTED -gt 0 ] && echo "$((KASETT_HANDLED * 100 / COMPACTED))%" || echo "N/A") |" >> "$OUTPUT"

echo "" >> "$OUTPUT"
echo "## Observations" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Check for sessions that compacted multiple times (stress indicator)
MULTI_COMPACT=$(find "$SESSIONS_DIR" -name "*.checkpoint.*.jsonl" -mtime -1 2>/dev/null | sed 's/\.checkpoint\.[^.]*\.jsonl//' | sort | uniq -d | wc -l)
if [ "$MULTI_COMPACT" -gt 0 ]; then
  echo "- ⚡ $MULTI_COMPACT session(s) compacted multiple times (high activity)" >> "$OUTPUT"
fi

# Append to phase2 observations if anything notable
if [ $VANILLA_HANDLED -gt 0 ]; then
  echo "" >> "$REPO_DIR/research/phase2-observations/coverage-gaps.md"
  echo "### $TODAY — $VANILLA_HANDLED session(s) fell through to vanilla" >> "$REPO_DIR/research/phase2-observations/coverage-gaps.md"
fi

echo ""
echo "Review written to: $OUTPUT"
echo "Compacted: $COMPACTED | Kasett: $KASETT_HANDLED | Vanilla: $VANILLA_HANDLED"
