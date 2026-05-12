# Phase 2 Compliance Report

Model: anthropic/claude-sonnet-4-5, max_tokens=32000, temperature=0

## V3 Emission Status by Session

| Session | Tier | Status | sub_thread | key_state | decisions | open_questions | SY |
|---|---|---|---|---|---|---|---|
| session-01 | 1 | PARSE_OK | 5 | 4 | 3 | 0 | 12 |
| session-02 | 1 | PARSE_OK | 4 | 6 | 3 | 0 | 13 |
| session-03 | 1 | PARSE_OK | 4 | 6 | 3 | 0 | 13 |
| session-04 | 2 | PARSE_OK | 3 | 6 | 4 | 0 | 13 |
| session-05 | 2 | PARSE_OK | 4 | 5 | 4 | 0 | 13 |
| session-06 | 2 | PARSE_OK | 3 | 8 | 4 | 0 | 15 |
| session-07 | 2 | PARSE_OK | 3 | 9 | 5 | 0 | 17 |
| session-08 | 3 | PARSE_OK | 5 | 10 | 5 | 0 | 20 |
| session-09 | 3 | PARSE_OK | 5 | 10 | 5 | 2 | 22 |
| session-10 | 3 | PARSE_OK | 5 | 10 | 4 | 0 | 19 |
| session-11 | 4 | PARSE_FALLBACK | 0 | 0 | 0 | 0 | 0 |
| session-12 | 4 | PARSE_FALLBACK | 0 | 0 | 0 | 0 | 0 |
| session-13 | 4 | PARSE_OK | 5 | 15 | 5 | 0 | 25 |
| session-14 | 4 | PARSE_OK | 5 | 11 | 4 | 0 | 20 |
| session-15 | 4 | PARSE_FALLBACK | 0 | 0 | 0 | 0 | 0 |

## Compliance Rate by Tier

| Tier | n | Compliance Rate |
|---|---|---|
| 1 | 3 | 100.0% |
| 2 | 4 | 100.0% |
| 3 | 3 | 100.0% |
| 4 | 5 | 40.0% |

## Status Legend

- **PARSE_OK** — closed-fence \`\`\`json block parsed and validated cleanly.
- **PARSE_REPAIRED** — open-fence (truncated) JSON repaired by F2 stage.
- **PARSE_FALLBACK** — fenced block found but failed validation; fell back to text scoring.
- **PARSE_NONE** — no fenced block at all; pure prose output.

## Root Cause Analysis: 3 Tier-4 Fallbacks (sessions 11, 12, 15)

All three Tier-4 fallbacks failed validation with the **same error**:

| Session | Error | sub_thread count emitted |
|---|---|---|
| session-11 | `sub: at most 5 items (got 8)` | 8 |
| session-12 | `sub: at most 5 items (got 6)` | 6 |
| session-15 | `sub: at most 5 items (got 7)` | 7 |

The LLM **did emit a well-formed JSON block** in all three cases. It also correctly identified more than 5 distinct sub-threads, because these fixtures genuinely contain 6–10 concurrent threads. The cap of 5 is a **schema policy choice**; the validator currently rejects on overflow rather than truncating to the top-5.

### Production implication

This is a meaningful production bug, not a bench artifact. Real Molt sessions with >5 active threads (as seen in topic-11727 and standup-style threads) will see the LLM emit valid JSON that the validator throws away. Net effect on the customer: PARSE_FALLBACK → zero structured output → next compaction loses thread context.

### Recommended fix (out of scope for this benchmark)

Make `validateThreadMetaV3` truncate `sub[]` to the first 5 items instead of failing the whole record. Track the truncation as a non-fatal `warning` so we can monitor frequency. Same lenient-truncate applies to `key_state` (cap 20), `decisions` (cap 5), and `open_questions` (cap 5).

## Vanilla emission of structure

None of the 15 vanilla runs produced any structured artifacts. Vanilla SY = 0 by construction. The vanilla prompt does not request JSON, so the absence of structure is expected, but it is the cleanest possible demonstration of the structured-vs-prose advantage — vanilla literally cannot produce a `sub_thread[]` or `key_state[]` array, and thus cannot deliver them to the next compaction.

## Topic-11727 comparison

Topic-11727 in production showed prose-only output (no JSON fence at all — a PARSE_NONE state). This benchmark did not reproduce that failure mode — every session emitted a fenced JSON block. The `sub` cap overflow we did reproduce is a different (but adjacent) failure mode worth treating in parallel.
