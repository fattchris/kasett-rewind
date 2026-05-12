# Phase A — Replay Analysis

**Generated:** 2026-05-12T14:29:04.621Z
**Window:** last 7 days
**Session files scanned:** 590 (non-checkpoint)

## Headline numbers

- Compaction events:         **36**
- Has [KASETT_STUB::]:       **10**
- Has [THREAD_META]:         **10**
- Parser produced valid meta: **8**

## Breakdown

- **Rich (replaced):** 0 — `THREAD_META` present, **no stub marker**, parser produced valid meta. This is what success looks like.
- **Stub + meta:** 8 — both stub marker and the carry-over THREAD_META from a previous compaction. Hot-swap never replaced this stub.
- **Stub only:** 2 — stub with no THREAD_META at all (initial compaction with no previous meta to carry).
- **Neither marker (vanilla OC fallback):** 24

## Compliance

- **Compliance rate** (rich / total events): **0.0%**
- **Parser success rate** (valid meta / events with [THREAD_META]): **80.0%**

Compliance rate is the fraction of compactions that produced a kasett-rich summary in production. Parser success rate isolates the parser: when a [THREAD_META] block is present, does kasett's parser actually accept it?

## Stub-only examples (3)

### 554ea513-ff4c-47e7-9301-f3fdf5f84415-topic-26844.jsonl
- timestamp: 2026-05-11T15:44:19.008Z
- meta.main (carry-over): `Now I'll conduct the deep research`
- preview: `[KASETT_STUB::7ed3fd48-3de8-4e71-9782-f9f562ff35ae]

Session compaction in progress. Thread state:

[THREAD_META]
main: Now I'll conduct the deep research
sub1: idle
sub2: idle
sub3: idle
[/THREAD_MET`

### 554ea513-ff4c-47e7-9301-f3fdf5f84415-topic-26844.jsonl
- timestamp: 2026-05-11T15:50:33.630Z
- meta.main (carry-over): `Now let me continue with Section B — Bot API current state`
- preview: `[KASETT_STUB::8c4b1706-8372-4b90-a1ba-36c3d3733723]

Session compaction in progress. Thread state:

[THREAD_META]
main: Now let me continue with Section B — Bot API current state
sub1: idle
sub2: idle`

### 5d65ffe4-f266-4ba1-b97b-5186acc0b0f8-topic-5392.jsonl
- timestamp: 2026-05-05T21:06:38.054Z
- meta.main (carry-over): `Now let me find the config write section near the end of the build section: 1...`
- preview: `[KASETT_STUB::5d2f3bc0-263b-4c36-990b-a75922368fb7]

Session compaction in progress. Thread state:

[THREAD_META]
main: Now let me find the config write section near the end of the build section: 1...`

## Failed-parse examples (2)

### 571d75dd-468c-4aa5-9c15-cd2df89b782d-topic-20751.jsonl
- timestamp: 2026-05-05T10:30:58.853Z
- preview: `## Goal
Refactor kasett-rewind from a CLI config-generator into a proper OpenClaw plugin using the CompactionProvider interface, implementing weighted rolling compaction thread tracking. Maintain back`

### 571d75dd-468c-4aa5-9c15-cd2df89b782d-topic-20751.jsonl
- timestamp: 2026-05-05T10:30:58.957Z
- preview: `## Goal
Refactor kasett-rewind from a CLI config-generator into a proper OpenClaw plugin using the CompactionProvider interface, implementing weighted rolling compaction thread tracking. Maintain back`

