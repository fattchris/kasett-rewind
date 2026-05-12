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
KASETT_STUB_REMAINED=0
KASETT_RICH=0
VANILLA_HANDLED=0
# Phase C — KSSR / key_state aggregation
TOTAL_KEY_STATE=0
KEY_STATE_COMPACTIONS=0
FIVE_PLUS_KEY_STATE_SESSIONS=0

# Phase D — lifecycle event aggregation
TOTAL_LIFECYCLE_EVENTS=0
LIFECYCLE_RENAMED=0
LIFECYCLE_MERGED=0
LIFECYCLE_SPLIT=0
LIFECYCLE_COMPACTIONS=0

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

  # Decide kasett status (Phase B1 — sidecar-aware).
  #
  # Tier hierarchy (best to worst):
  #   rich-sidecar : sidecar exists and has at least one entry — Phase B1 success path
  #   rich-inline  : JSONL summary itself is rich (legacy / pre-B1 sessions)
  #   stub         : JSONL has KASETT_STUB but no sidecar entry to enrich it (broken)
  #   kasett-other : JSONL has [THREAD_META] but no recognised marker shape
  #   vanilla      : no kasett trace anywhere
  STATUS=$(python3 -c "
import sys, json, os
path = sys.argv[1]
sidecar_path = path + '.kasett-meta.jsonl'

sidecar_entries = 0
if os.path.exists(sidecar_path) and os.path.getsize(sidecar_path) > 0:
    try:
        with open(sidecar_path, 'r', encoding='utf-8', errors='replace') as sf:
            for line in sf:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict) and obj.get('summary_rich'):
                        sidecar_entries += 1
                except Exception:
                    pass
    except Exception:
        pass

rich_inline = False
stub_only = False
any_kasett = False
try:
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get('type') != 'compaction':
                continue
            s = str(obj.get('summary') or '')
            has_tm = '[THREAD_META]' in s
            has_stub = 'KASETT_STUB' in s
            if has_tm or has_stub:
                any_kasett = True
            if has_tm and not has_stub:
                rich_inline = True
            elif has_stub:
                stub_only = True
except Exception:
    pass

if sidecar_entries > 0:
    print('rich-sidecar')
elif rich_inline:
    print('rich-inline')
elif stub_only:
    print('stub')
elif any_kasett:
    print('kasett-other')
else:
    print('vanilla')
" "$session_file" 2>/dev/null) || STATUS="vanilla"

  # Phase C — extract aggregate key_state stats from the sidecar.
  # Outputs three numbers, space-separated:
  #   total_key_state  total_compactions_with_key_state  max_key_state_in_a_compaction
  KS_STATS=$(python3 -c "
import sys, json, os
path = sys.argv[1] + '.kasett-meta.jsonl'
total = 0
compactions_with_ks = 0
max_ks = 0
if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as sf:
            for line in sf:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                tm3 = obj.get('thread_meta_v3')
                ks = tm3.get('key_state') if isinstance(tm3, dict) else None
                n = len(ks) if isinstance(ks, list) else 0
                if n > 0:
                    compactions_with_ks += 1
                    total += n
                    if n > max_ks:
                        max_ks = n
    except Exception:
        pass
print(f'{total} {compactions_with_ks} {max_ks}')
" "$session_file" 2>/dev/null) || KS_STATS="0 0 0"
  KS_TOTAL=$(echo "$KS_STATS" | awk '{print $1}')
  KS_COMP=$(echo "$KS_STATS" | awk '{print $2}')
  KS_MAX=$(echo "$KS_STATS" | awk '{print $3}')
  TOTAL_KEY_STATE=$((TOTAL_KEY_STATE + KS_TOTAL))
  KEY_STATE_COMPACTIONS=$((KEY_STATE_COMPACTIONS + KS_COMP))
  if [ "$KS_MAX" -ge 5 ]; then
    FIVE_PLUS_KEY_STATE_SESSIONS=$((FIVE_PLUS_KEY_STATE_SESSIONS + 1))
  fi

  # Phase D — lifecycle events tally per session
  LC_STATS=$(python3 -c "
import sys, json, os
path = sys.argv[1] + '.kasett-meta.jsonl'
total = 0
renamed = 0
merged = 0
split = 0
compactions_with = 0
if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as sf:
            for line in sf:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                evs = obj.get('lifecycle_events')
                if isinstance(evs, list) and len(evs) > 0:
                    compactions_with += 1
                    total += len(evs)
                    for e in evs:
                        k = e.get('kind') if isinstance(e, dict) else None
                        if k == 'renamed': renamed += 1
                        elif k == 'merged': merged += 1
                        elif k == 'split': split += 1
    except Exception:
        pass
print(f'{total} {renamed} {merged} {split} {compactions_with}')
" "$session_file" 2>/dev/null) || LC_STATS="0 0 0 0 0"
  LC_TOTAL=$(echo "$LC_STATS" | awk '{print $1}')
  LC_RENAMED=$(echo "$LC_STATS" | awk '{print $2}')
  LC_MERGED=$(echo "$LC_STATS" | awk '{print $3}')
  LC_SPLIT=$(echo "$LC_STATS" | awk '{print $4}')
  LC_COMP=$(echo "$LC_STATS" | awk '{print $5}')
  TOTAL_LIFECYCLE_EVENTS=$((TOTAL_LIFECYCLE_EVENTS + LC_TOTAL))
  LIFECYCLE_RENAMED=$((LIFECYCLE_RENAMED + LC_RENAMED))
  LIFECYCLE_MERGED=$((LIFECYCLE_MERGED + LC_MERGED))
  LIFECYCLE_SPLIT=$((LIFECYCLE_SPLIT + LC_SPLIT))
  LIFECYCLE_COMPACTIONS=$((LIFECYCLE_COMPACTIONS + LC_COMP))

  if [[ "$STATUS" == "rich-sidecar" || "$STATUS" == "rich-inline" || "$STATUS" == "stub" || "$STATUS" == "kasett-other" ]]; then
    KASETT_HANDLED=$((KASETT_HANDLED + 1))
    if [[ "$STATUS" == "rich-sidecar" ]]; then
      KASETT_RICH=$((KASETT_RICH + 1))
      echo "- ✅ \`$session_id\` — kasett rich (sidecar)" >> "$OUTPUT"
    elif [[ "$STATUS" == "rich-inline" ]]; then
      KASETT_RICH=$((KASETT_RICH + 1))
      echo "- ✅ \`$session_id\` — kasett rich (inline / legacy)" >> "$OUTPUT"
    elif [[ "$STATUS" == "stub" ]]; then
      KASETT_STUB_REMAINED=$((KASETT_STUB_REMAINED + 1))
      echo "- ⚠️  \`$session_id\` — kasett stub only (sidecar missing or empty)" >> "$OUTPUT"
    else
      echo "- ⚠️  \`$session_id\` — kasett (other / unrecognised shape)" >> "$OUTPUT"
    fi

    # Extract the main: field. Sidecar first (cheap, structured), then JSONL.
    MAIN=$(python3 -c "
import sys, re, json, os

path = sys.argv[1]
sidecar_path = path + '.kasett-meta.jsonl'
main_val = ''

if os.path.exists(sidecar_path):
    try:
        last_meta = None
        with open(sidecar_path, 'r', encoding='utf-8', errors='replace') as sf:
            for line in sf:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                tm = obj.get('thread_meta')
                if isinstance(tm, dict) and isinstance(tm.get('main'), str):
                    last_meta = tm['main']
                else:
                    sr = obj.get('summary_rich', '') or ''
                    m = re.search(r'\[THREAD_META\]\s*\nmain:\s*(.+)', sr, re.IGNORECASE)
                    if m:
                        last_meta = m.group(1).strip()
        if last_meta:
            main_val = last_meta
    except Exception:
        pass

if not main_val:
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                summary = obj.get('summary', '') or ''
                if '[THREAD_META]' not in summary:
                    continue
                summary_decoded = summary.replace('\\\\n', '\n').replace('\\n', '\n')
                m = re.search(r'\[THREAD_META\]\s*\nmain:\s*(.+)', summary_decoded, re.IGNORECASE)
                if m:
                    main_val = m.group(1).strip()
                    break
    except Exception:
        pass

print(main_val)
" "$session_file" 2>/dev/null) || MAIN=""

    if [ -n "$MAIN" ]; then
      echo "  - Main: $MAIN" >> "$OUTPUT"
    fi
    if [ "$KS_TOTAL" -gt 0 ]; then
      echo "  - key_state: $KS_TOTAL across $KS_COMP compactions (max $KS_MAX)" >> "$OUTPUT"
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
echo "  - Kasett rich (sidecar or inline): $KASETT_RICH" >> "$OUTPUT"
echo "  - Kasett stub only (sidecar missing): $KASETT_STUB_REMAINED" >> "$OUTPUT"
echo "- Vanilla fallback: $VANILLA_HANDLED" >> "$OUTPUT"
if [ $COMPACTED -gt 0 ]; then
  echo "- Coverage: $((KASETT_HANDLED * 100 / COMPACTED))%" >> "$OUTPUT"
else
  echo "- Coverage: N/A" >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"
echo "### KeyState (Phase C)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "- Total key_state entries: $TOTAL_KEY_STATE" >> "$OUTPUT"
echo "- Compactions with key_state: $KEY_STATE_COMPACTIONS" >> "$OUTPUT"
echo "- Sessions with at least one compaction ≥ 5 key_state entries: $FIVE_PLUS_KEY_STATE_SESSIONS" >> "$OUTPUT"
if [ "$KEY_STATE_COMPACTIONS" -gt 0 ]; then
  echo "- Avg key_state / compaction: $((TOTAL_KEY_STATE / KEY_STATE_COMPACTIONS))" >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"
echo "_For per-session KSSR (preserved/detected), run \`scripts/measure-kssr.js <session.jsonl>\` on individual sessions._" >> "$OUTPUT"

echo "" >> "$OUTPUT"
echo "### Thread lifecycle (Phase D)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "- Total lifecycle events: $TOTAL_LIFECYCLE_EVENTS" >> "$OUTPUT"
echo "- Compactions with lifecycle events: $LIFECYCLE_COMPACTIONS" >> "$OUTPUT"
echo "- Renamed: $LIFECYCLE_RENAMED  Merged: $LIFECYCLE_MERGED  Split: $LIFECYCLE_SPLIT" >> "$OUTPUT"
if [ "$LIFECYCLE_COMPACTIONS" -gt 0 ]; then
  RENAME_PER_100=$((LIFECYCLE_RENAMED * 100 / LIFECYCLE_COMPACTIONS))
  echo "- Renames per 100 lifecycle-bearing compactions: $RENAME_PER_100" >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"
echo "_For per-session detail, run \`node scripts/identity-report.js\`._" >> "$OUTPUT"

# Phase E — Cross-session threads. Pull aggregate from the global index.
echo "" >> "$OUTPUT"
echo "### Cross-Session Threads (Phase E)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
GLOBAL_INDEX="$SESSIONS_DIR/.kasett-global-threads.jsonl"
if [ -f "$GLOBAL_INDEX" ]; then
  TOTAL_GLOBAL_RECORDS=$(wc -l < "$GLOBAL_INDEX" 2>/dev/null || echo 0)
  # Records written today (UTC date prefix match against ts).
  TODAY_RECORDS=$(grep -c "\"ts\":\"$TODAY" "$GLOBAL_INDEX" 2>/dev/null || echo 0)
  # Threads with ≥2 distinct sessions today (cross-cutting work).
  CROSS_SESSION_TODAY=$(grep "\"ts\":\"$TODAY" "$GLOBAL_INDEX" 2>/dev/null \
    | python3 -c "
import sys, json
from collections import defaultdict
threads = defaultdict(set)
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    canon = r.get('canonical_id') or r.get('thread_id')
    sess = r.get('session_id')
    if canon and sess:
        threads[canon].add(sess)
spread = [(c, len(s)) for c, s in threads.items() if len(s) >= 2]
spread.sort(key=lambda x: -x[1])
print(len(spread))
for c, n in spread[:5]:
    print(f'  - {c}: {n} sessions')
" 2>/dev/null || echo 0)
  echo "- Global index records (all-time): $TOTAL_GLOBAL_RECORDS" >> "$OUTPUT"
  echo "- Records written today: $TODAY_RECORDS" >> "$OUTPUT"
  if [ -n "$CROSS_SESSION_TODAY" ]; then
    echo "$CROSS_SESSION_TODAY" | head -1 | xargs -I{} echo "- Threads spanning ≥2 sessions today: {}" >> "$OUTPUT"
    TAIL_LINES=$(echo "$CROSS_SESSION_TODAY" | tail -n +2)
    if [ -n "$TAIL_LINES" ]; then
      echo "$TAIL_LINES" >> "$OUTPUT"
    fi
  fi
else
  echo "_Global index not yet populated (no cross-session writes yet)._" >> "$OUTPUT"
fi
echo "" >> "$OUTPUT"
echo "_For full cross-session report, run \`node scripts/global-thread-report.js\`._" >> "$OUTPUT"

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
echo "Compacted: $COMPACTED | Kasett: $KASETT_HANDLED (rich=$KASETT_RICH stub=$KASETT_STUB_REMAINED) | Vanilla: $VANILLA_HANDLED"
