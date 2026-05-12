#!/bin/bash
# kasett-rewind daily compaction review
# Runs via OC cron — finds all sessions compacted in last 24h,
# checks if kasett handled them (presence of [THREAD_META] in summary).
# Output: research/daily-reviews/YYYY-MM-DD.md

set -euo pipefail

REPO_DIR="/home/node/.openclaw/workspace/repos/kasett-rewind"
SESSIONS_DIR="/home/node/.openclaw/agents/main/sessions"
TODAY=$(date -u +%Y-%m-%d)
OUTPUT="$REPO_DIR/research/daily-reviews/$TODAY.md"

echo "# Compaction Review — $TODAY" > "$OUTPUT"
echo "" >> "$OUTPUT"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUTPUT"
echo "" >> "$OUTPUT"

COMPACTED=0
KASETT_HANDLED=0
VANILLA_HANDLED=0

echo "## Sessions Compacted (last 24h)" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Collect checkpoint files; handle empty glob gracefully
CHECKPOINT_FILES=()
while IFS= read -r -d '' f; do
  CHECKPOINT_FILES+=("$f")
done < <(find "$SESSIONS_DIR" -name "*.checkpoint.*.jsonl" -mtime -1 -print0 2>/dev/null) || true

# Derive unique session files from checkpoint files
declare -A SEEN_SESSIONS
for checkpoint in "${CHECKPOINT_FILES[@]+"${CHECKPOINT_FILES[@]}"}"; do
  session_file=$(echo "$checkpoint" | sed 's/\.checkpoint\.[^.]*\.jsonl/.jsonl/')
  session_id=$(basename "$session_file" .jsonl)

  # Deduplicate — a session may have multiple checkpoints
  if [[ -n "${SEEN_SESSIONS[$session_id]+_}" ]]; then
    continue
  fi
  SEEN_SESSIONS[$session_id]=1

  COMPACTED=$((COMPACTED + 1))

  # Check if the most recent compaction entry has [THREAD_META] (kasett's marker).
  # The summary is stored as a JSON string with \n escape sequences, not raw newlines.
  # grep -q just checks for presence of the marker anywhere in the file.
  if grep -q "\[THREAD_META\]" "$session_file" 2>/dev/null; then
    KASETT_HANDLED=$((KASETT_HANDLED + 1))
    echo "- ✅ \`$session_id\` — kasett handled" >> "$OUTPUT"

    # Extract the main: field from the [THREAD_META] block.
    # The summary is a JSON string, so \n is literal backslash-n in the file.
    # We use python3 to safely decode the JSON and extract the main: line.
    MAIN=$(python3 -c "
import sys, re, json

path = sys.argv[1]
main_val = ''
with open(path, 'r', encoding='utf-8') as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        # Compaction events have a 'summary' field at top level
        summary = obj.get('summary', '') or ''
        if '[THREAD_META]' not in summary:
            continue
        # summary may contain \\n as literal escape sequences OR real newlines
        # Normalize both
        summary_decoded = summary.replace('\\\\n', '\n').replace('\\n', '\n')
        m = re.search(r'\[THREAD_META\]\s*\nmain:\s*(.+)', summary_decoded, re.IGNORECASE)
        if m:
            main_val = m.group(1).strip()
            break

print(main_val)
" "$session_file" 2>/dev/null) || MAIN=""

    if [ -n "$MAIN" ]; then
      echo "  - Main: $MAIN" >> "$OUTPUT"
    fi
  else
    VANILLA_HANDLED=$((VANILLA_HANDLED + 1))
    echo "- ⚠️ \`$session_id\` — vanilla OC (no [THREAD_META])" >> "$OUTPUT"
  fi
done

if [ $COMPACTED -eq 0 ]; then
  echo "_No compaction events in the last 24 hours._" >> "$OUTPUT"
fi

echo "" >> "$OUTPUT"
echo "## Summary" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "- Total compacted: $COMPACTED" >> "$OUTPUT"
echo "- Kasett handled: $KASETT_HANDLED" >> "$OUTPUT"
echo "- Vanilla fallback: $VANILLA_HANDLED" >> "$OUTPUT"
if [ $COMPACTED -gt 0 ]; then
  echo "- Coverage: $((KASETT_HANDLED * 100 / COMPACTED))%" >> "$OUTPUT"
else
  echo "- Coverage: N/A" >> "$OUTPUT"
fi

echo "" >> "$OUTPUT"
echo "## Observations" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Check for sessions that compacted multiple times (stress indicator).
# Use || true so an empty result doesn't kill the script under pipefail.
MULTI_COMPACT=0
if [ ${#CHECKPOINT_FILES[@]} -gt 0 ]; then
  MULTI_COMPACT=$(printf '%s\n' "${CHECKPOINT_FILES[@]}" \
    | sed 's/\.checkpoint\.[^.]*\.jsonl//' \
    | sort \
    | uniq -d \
    | wc -l) || MULTI_COMPACT=0
fi

if [ "$MULTI_COMPACT" -gt 0 ]; then
  echo "- ⚡ $MULTI_COMPACT session(s) compacted multiple times (high activity)" >> "$OUTPUT"
else
  echo "_No unusual activity detected._" >> "$OUTPUT"
fi

echo ""
echo "Review written to: $OUTPUT"
echo "Compacted: $COMPACTED | Kasett: $KASETT_HANDLED | Vanilla: $VANILLA_HANDLED"
