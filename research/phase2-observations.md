
- 2026-05-07: Stub not replaced in topic-5392 (Infra) — THREAD_META 'main' field truncated mid-sentence ('The QA config has `plugins'); script also crashed on empty grep for main label (set -e + empty match = exit 1). Review script needs null-safe label extraction.
- 2026-05-08: 100% coverage (2/2), topic-5392 (Infra) both runs — but stubs STILL not replaced (same issue as May 7); thread labels still generic 'Ongoing work' placeholder, no content synthesis. Hot-swap job appears persistently broken.
2026-05-09: KASETT_STUB present in main JSONL after compaction — stub was written but replacement summary was not injected back; review script also crashes on MAIN= extraction when thread label is empty (set -e + empty grep output = silent exit).
- 2026-05-11: 1 compaction, 100% kasett coverage. KASETT_STUB present (d6d65ad2) — was a subagent writing the USHA-for-AI certification spec; [THREAD_META] main label shows 'Ongoing work' (generic, not descriptive). Script exits early due to set -euo pipefail when main: label grep returns empty string — summary block not written.

2026-05-12: daily-compaction-review.sh exits early (set -e + grep '^main:' fails on \n-escaped THREAD_META in JSONL); also aa976050-topic-12388 consistently emits 'Ongoing work' as main label — stub context quality low for that topic.
