
- 2026-05-07: Stub not replaced in topic-5392 (Infra) — THREAD_META 'main' field truncated mid-sentence ('The QA config has `plugins'); script also crashed on empty grep for main label (set -e + empty match = exit 1). Review script needs null-safe label extraction.
- 2026-05-08: 100% coverage (2/2), topic-5392 (Infra) both runs — but stubs STILL not replaced (same issue as May 7); thread labels still generic 'Ongoing work' placeholder, no content synthesis. Hot-swap job appears persistently broken.
2026-05-09: KASETT_STUB present in main JSONL after compaction — stub was written but replacement summary was not injected back; review script also crashes on MAIN= extraction when thread label is empty (set -e + empty grep output = silent exit).
- 2026-05-11: 1 compaction, 100% kasett coverage. KASETT_STUB present (d6d65ad2) — was a subagent writing the USHA-for-AI certification spec; [THREAD_META] main label shows 'Ongoing work' (generic, not descriptive). Script exits early due to set -euo pipefail when main: label grep returns empty string — summary block not written.

2026-05-12: daily-compaction-review.sh exits early (set -e + grep '^main:' fails on \n-escaped THREAD_META in JSONL); also aa976050-topic-12388 consistently emits 'Ongoing work' as main label — stub context quality low for that topic.
2026-05-13: 100% coverage (4/4); 1 stub-only on topic-4482 (Transcript Intake, likely low-content session); Phase C key_state active; no vanilla fallbacks.
- 2026-05-19: 1/1 compaction (100% coverage) but stub-only — sidecar missing/empty on topic-5392 (Infra). Recurring pattern: kasett hook reached but rich sidecar not produced.

- 2026-05-20: 75% coverage (3/4). Vanilla fallback on session 07162f7f (topic-5392, 12 messages, fromHook=true at 03:37Z) — real compaction kasett missed, no sidecar produced. Worth checking why kasett didn't engage on this one (timing/race? hook routing?).
- 2026-05-23: 1/2 compactions stub-only (session 9904a1d4-b586) — no sidecar file written. Coverage detection works but sidecar generation failed silently.
- 2026-05-25: 100% coverage (3/3) with 2 rich + 1 stub-only. Stub session 9d6c6f23 is a DM (no topic suffix) — sidecar missing/empty. Recurring stub-only pattern persists; may correlate with low-content or DM sessions.
