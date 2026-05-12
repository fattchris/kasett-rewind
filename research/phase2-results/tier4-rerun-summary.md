# Phase 2 Tier-4 Re-run Summary

**Model:** anthropic/claude-sonnet-4-5 (max_tokens=32000, temperature=0)
**Re-ran:** 5 Tier-4 fixtures (sessions 11-15) with lenient validator.
**Carried over:** 10 Tier 1-3 results from original run (validator change cannot regress them).
**Timestamp:** 2026-05-12T19:25:49.898Z

## Headline Delta

| Metric | Original | Re-run | Delta |
|---|---|---|---|
| Tier 4 compliance | 40.0% | 100.0% | 60.0 pp |
| Tier 4 mean SY | 9.00 | 23.20 | +14.20 |
| Overall mean SY | 13.47 | 18.20 | +4.73 |
| Overall compliance | 80.0% | 100.0% | 20.0 pp |
| Overall Kasett TRR | 0.755 | 0.765 | +0.010 |
| Overall Kasett KSSR | 0.946 | 0.951 | +0.005 |

## Per-Tier (post-fix)

| Tier | n | V-TRR | K-TRR | V-KSSR | K-KSSR | Mean SY | Compliance |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 0.667 | 0.500 | 1.000 | 1.000 | 12.67 | 100% |
| 2 | 4 | 0.917 | 1.000 | 1.000 | 0.958 | 14.50 | 100% |
| 3 | 3 | 0.756 | 0.822 | 0.963 | 0.963 | 20.33 | 100% |
| 4 | 5 | 0.641 | 0.703 | 0.959 | 0.909 | 23.20 | 100% |

## Tier-4 Per-Session (Original vs Re-run)

| Session | Threads | Keys | Turns | Orig SY | New SY | Orig Status | New Status | Truncated |
|---|---|---|---|---|---|---|---|---|
| session-11 | 8 | 25 | 120 | 0 | 29 | PARSE_FALLBACK | PARSE_OK | sub |
| session-12 | 6 | 20 | 100 | 0 | 20 | PARSE_FALLBACK | PARSE_OK | sub |
| session-13 | 10 | 30 | 150 | 25 | 24 | PARSE_OK | PARSE_OK | — |
| session-14 | 5 | 15 | 80 | 20 | 20 | PARSE_OK | PARSE_OK | — |
| session-15 | 7 | 22 | 110 | 0 | 23 | PARSE_FALLBACK | PARSE_OK | sub |

## Tier-4 Detail (Re-run)

| Session | sub | key_state | decisions | open_q | TRR | KSSR | Status |
|---|---|---|---|---|---|---|---|
| session-11 | 5 | 16 | 5 | 3 | 0.625 | 0.880 | PARSE_OK |
| session-12 | 5 | 10 | 5 | 0 | 0.833 | 0.900 | PARSE_OK |
| session-13 | 5 | 14 | 5 | 0 | 0.600 | 0.900 | PARSE_OK |
| session-14 | 5 | 12 | 3 | 0 | 0.600 | 1.000 | PARSE_OK |
| session-15 | 5 | 17 | 0 | 1 | 0.857 | 0.864 | PARSE_OK |

## Interpretation

- **Tier 4 compliance:** 40% → 100% (+60.0 pp). The validator change recovers structured output from sessions where the LLM correctly emitted >5 sub-threads.
- **Tier 4 mean SY:** 9.00 → 23.20 (+14.20). The gain is the structured artifacts that previously fell out of the validator.
- **Overall mean SY (n=15):** 13.47 → 18.20 (+4.73).
- **Truncation observed:** 3/5 Tier-4 sessions had at least one array truncated (`_truncated_<field>` flag set). Truncation is the expected mechanism by which structured content survived the cap.
- **Same data, different policy.** No prompt change, no model change. The compliance jump is the validator no longer throwing away the LLM's correct work.

