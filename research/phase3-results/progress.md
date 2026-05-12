# Phase 3 — Behavioral Probe Benchmark (RQ1)

Started: 2026-05-12

## Plan
- B1: Build probe corpus (5 scenarios × 10 facts = 50 probes) — synthetic conversations with planted facts at controlled positions
- B2: Build harness — runs vanilla & Kasett compactions, then asks fresh agent probe questions, scores
- B3: Compute Recall@1 metrics (overall, by position, by kind), hallucination rate, no-answer rate
- B4: Statistical analysis (McNemar, Cohen's h, Wilson CI)
- B5: Output files (probe-corpus.json, run-probes.mjs, results.json, summary.md, paper-1-update.md)
- B6: Update PAPER-1-DRAFT.md with Behavioral Recall (RQ1) section
- B7: Commit + push

## Step log
[2026-05-12T19:58:22.434Z] Phase 3 probe harness — START
[2026-05-12T19:58:22.440Z] Loaded 5 scenarios, 50 probes total
[2026-05-12T19:58:22.440Z] 
=== Scenario A: Multi-thread engineering work (140 turns, 10 probes) ===
[2026-05-12T19:58:22.440Z]   vanilla compact ...
[2026-05-12T19:58:36.898Z]     3009 chars in 14457ms
[2026-05-12T19:58:38.899Z]   kasett compact ...
[2026-05-12T19:58:56.415Z]     4522 chars in 17514ms, SY=18, has_meta=true
[2026-05-12T19:58:58.416Z]   probe A-1 [url]: "What URL did we deploy the staging API to?" (expect "https://api-staging.molt.ai")
[2026-05-12T19:59:18.316Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T19:59:18.316Z]   probe A-2 [version]: "What version of postgres did we settle on?" (expect "15.4")
[2026-05-12T19:59:39.972Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T19:59:39.972Z]   probe A-3 [person]: "Who said the launch should be August 1?" (expect "Walton")
[2026-05-12T20:00:00.675Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:00:00.675Z]   probe A-4 [path]: "What's the path to the gateway config file?" (expect "/etc/molt/gateway.toml")
[2026-05-12T20:00:21.819Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:00:21.819Z]   probe A-5 [decision]: "What did we decide about the auth flow?" (expect "Use JWT, not OAuth")
[2026-05-12T20:00:43.417Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:00:43.417Z]   probe A-6 [error]: "What error did Andrew hit?" (expect "ECONNREFUSED on port 18790")
[2026-05-12T20:01:04.254Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:01:04.254Z]   probe A-7 [value]: "How many requests per second is the rate limit set to?" (expect "250")
[2026-05-12T20:01:24.903Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:01:24.903Z]   probe A-8 [command]: "What kubectl command did we use to roll the gateway pods?" (expect "kubectl rollout restart deploy/gateway -n molt-prod")
[2026-05-12T20:01:44.217Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:01:44.217Z]   probe A-9 [blocker]: "What's currently blocking the SDK release?" (expect "waiting on legal review of the EULA")
[2026-05-12T20:02:05.640Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:02:05.640Z]   probe A-10 [deadline]: "When does the SOC 2 audit start?" (expect "September 15")
[2026-05-12T20:02:30.398Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:02:30.398Z]   Scenario A complete
[2026-05-12T20:02:30.398Z] 
=== Scenario B: Multi-day research project (120 turns, 10 probes) ===
[2026-05-12T20:02:30.398Z]   vanilla compact ...
[2026-05-12T20:02:39.550Z]     1816 chars in 9151ms
[2026-05-12T20:02:41.551Z]   kasett compact ...
[2026-05-12T20:02:56.510Z]     3613 chars in 14959ms, SY=19, has_meta=true
[2026-05-12T20:02:58.512Z]   probe B-1 [url]: "What dataset URL did we download for the LoCoMo replication?" (expect "https://huggingface.co/datasets/snap-stanford/locomo")
[2026-05-12T20:03:19.235Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:03:19.235Z]   probe B-2 [value]: "What was the baseline accuracy reported in the LoCoMo paper?" (expect "67.3%")
[2026-05-12T20:03:38.476Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:03:38.477Z]   probe B-3 [person]: "Who is the first author of the LoCoMo paper?" (expect "Maharana")
[2026-05-12T20:03:59.749Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:03:59.750Z]   probe B-4 [path]: "Where are we storing the experiment results?" (expect "research/locomo-replication/results/")
[2026-05-12T20:04:22.072Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:04:22.073Z]   probe B-5 [decision]: "Which model are we holding fixed for the replication?" (expect "Sonnet 4.5")
[2026-05-12T20:04:42.908Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:04:42.909Z]   probe B-6 [value]: "How many sessions are in the LoCoMo evaluation set?" (expect "300")
[2026-05-12T20:05:04.620Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:05:04.620Z]   probe B-7 [blocker]: "What's blocking us from running the full eval?" (expect "OpenRouter rate limits")
[2026-05-12T20:05:27.525Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:05:27.525Z]   probe B-8 [command]: "What command kicks off the replication run?" (expect "node research/locomo-replication/run-eval.mjs --pilot")
[2026-05-12T20:05:48.859Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:05:48.859Z]   probe B-9 [deadline]: "When is the EMNLP submission deadline?" (expect "June 15")
[2026-05-12T20:06:09.223Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:06:09.223Z]   probe B-10 [version]: "What version of BERTScore are we using?" (expect "0.3.13")
[2026-05-12T20:06:31.053Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:06:31.053Z]   Scenario B complete
[2026-05-12T20:06:31.053Z] 
=== Scenario C: Customer support session (90 turns, 10 probes) ===
[2026-05-12T20:06:31.053Z]   vanilla compact ...
[2026-05-12T20:06:40.307Z]     1897 chars in 9254ms
[2026-05-12T20:06:42.308Z]   kasett compact ...
[2026-05-12T20:06:55.820Z]     3142 chars in 13511ms, SY=11, has_meta=true
[2026-05-12T20:06:57.822Z]   probe C-1 [value]: "What is the customer's ticket ID?" (expect "TKT-48721")
[2026-05-12T20:07:18.889Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=0 sem=0 hall=0 noans=1
[2026-05-12T20:07:18.890Z]   probe C-2 [person]: "What is the customer's name?" (expect "Priya Sharma")
[2026-05-12T20:07:36.803Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:07:36.804Z]   probe C-3 [error]: "What error code is the customer seeing?" (expect "401 invalid_grant")
[2026-05-12T20:07:56.263Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:07:56.264Z]   probe C-4 [decision]: "What did we decide to send the customer as a workaround?" (expect "a fresh API key with extended expiry")
[2026-05-12T20:08:18.758Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:08:18.759Z]   probe C-5 [url]: "What support article URL did we send her?" (expect "https://docs.molt.ai/support/refresh-token-rotation")
[2026-05-12T20:08:38.366Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:08:38.366Z]   probe C-6 [value]: "What is her account ID?" (expect "acct_8H3KQR7L9P")
[2026-05-12T20:08:58.411Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:08:58.411Z]   probe C-7 [blocker]: "What's blocking us from doing a real fix?" (expect "the rotation worker is owned by the platform team and they're mid-migration")
[2026-05-12T20:09:21.106Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:09:21.106Z]   probe C-8 [deadline]: "When did we promise the permanent fix?" (expect "May 28")
[2026-05-12T20:09:41.212Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:09:41.212Z]   probe C-9 [path]: "Where is the workaround documented internally?" (expect "wiki/runbooks/refresh-token-extended-expiry.md")
[2026-05-12T20:09:59.262Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:09:59.262Z]   probe C-10 [command]: "What command regenerates the customer key?" (expect "molt-cli keys regenerate --account=acct_8H3KQR7L9P --ttl=90d")
[2026-05-12T20:10:19.326Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:10:19.327Z]   Scenario C complete
[2026-05-12T20:10:19.327Z] 
=== Scenario D: Multi-task standup (110 turns, 10 probes) ===
[2026-05-12T20:10:19.327Z]   vanilla compact ...
[2026-05-12T20:10:31.606Z]     3032 chars in 12278ms
[2026-05-12T20:10:33.607Z]   kasett compact ...
[2026-05-12T20:10:49.204Z]     3582 chars in 15596ms, SY=14, has_meta=true
[2026-05-12T20:10:51.205Z]   probe D-1 [person]: "Who is leading the dashboard work?" (expect "Daniel")
[2026-05-12T20:11:11.442Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:11:11.443Z]   probe D-2 [version]: "What version of React is the dashboard targeting?" (expect "19.0.0-rc.1")
[2026-05-12T20:11:30.553Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:11:30.554Z]   probe D-3 [value]: "How many beta customers are using the dashboard?" (expect "14")
[2026-05-12T20:11:48.949Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:11:48.950Z]   probe D-4 [url]: "What URL is the dashboard staging environment at?" (expect "https://dashboard-stg.molt.ai")
[2026-05-12T20:12:10.016Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:12:10.016Z]   probe D-5 [decision]: "What did we decide about the data export feature?" (expect "punt to Q3, not in v1")
[2026-05-12T20:12:29.398Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:12:29.398Z]   probe D-6 [error]: "What error did the QA team report on the metrics page?" (expect "NaN displayed when no data is present")
[2026-05-12T20:12:50.081Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:12:50.082Z]   probe D-7 [path]: "What's the path to the dashboard repo?" (expect "github.com/moltaicorp/molt-dashboard")
[2026-05-12T20:13:09.675Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:13:09.676Z]   probe D-8 [blocker]: "What's blocking the analytics integration?" (expect "waiting on Segment API access")
[2026-05-12T20:13:50.989Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:13:50.989Z]   probe D-9 [deadline]: "When is the dashboard v1 GA?" (expect "June 30")
[2026-05-12T20:14:42.703Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:14:42.704Z]   probe D-10 [command]: "How do we run the dashboard tests locally?" (expect "pnpm test --filter=dashboard")
[2026-05-12T20:15:20.143Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:15:20.144Z]   Scenario D complete
[2026-05-12T20:15:20.144Z] 
=== Scenario E: Cross-thread debug (130 turns, 10 probes) ===
[2026-05-12T20:15:20.144Z]   vanilla compact ...
[2026-05-12T20:15:43.109Z]     1932 chars in 22965ms
[2026-05-12T20:15:45.111Z]   kasett compact ...
[2026-05-12T20:16:00.215Z]     2297 chars in 15103ms, SY=9, has_meta=true
[2026-05-12T20:16:02.218Z]   probe E-1 [error]: "What was the original error symptom?" (expect "p99 latency jumped from 80ms to 2400ms")
[2026-05-12T20:17:07.832Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:17:07.833Z]   probe E-2 [value]: "What time did the regression start?" (expect "08:42 UTC")
[2026-05-12T20:17:29.550Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:17:29.550Z]   probe E-3 [person]: "Who pushed the deploy that caused it?" (expect "Anna")
[2026-05-12T20:17:48.909Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:17:48.909Z]   probe E-4 [path]: "What file contains the bug?" (expect "src/server/serialize.ts")
[2026-05-12T20:18:08.716Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:18:08.717Z]   probe E-5 [decision]: "What did we decide to do — rollback or hotfix?" (expect "rollback first, hotfix in PR")
[2026-05-12T20:18:29.625Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:18:29.626Z]   probe E-6 [command]: "What command rolled back the deploy?" (expect "molt-deploy rollback --service=api --to=v2.14.7")
[2026-05-12T20:18:48.446Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:18:48.446Z]   probe E-7 [version]: "What version are we rolled back to?" (expect "v2.14.7")
[2026-05-12T20:19:08.833Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:19:08.834Z]   probe E-8 [url]: "Where is the incident postmortem doc?" (expect "https://wiki.molt.ai/incidents/2026-05-12-api-latency")
[2026-05-12T20:19:27.752Z]     V: em=1 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:19:27.752Z]   probe E-9 [blocker]: "What's blocking the proper fix from merging?" (expect "CI flake on the new test")
[2026-05-12T20:19:48.833Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=0 sem=1 hall=0 noans=0
[2026-05-12T20:19:48.834Z]   probe E-10 [deadline]: "When does the action-item review happen?" (expect "Friday 3pm MT")
[2026-05-12T20:20:07.733Z]     V: em=0 sem=1 hall=0 noans=0 | K: em=1 sem=1 hall=0 noans=0
[2026-05-12T20:20:07.733Z]   Scenario E complete
[2026-05-12T20:20:07.734Z] 
=== ALL DONE ===

## Step log

- B1 ✅ probe-corpus.json built (5 scenarios × 10 facts = 50 probes, 90-140 turns each)
- B2 ✅ run-probes.mjs harness built and ran (310 LLM calls, ~22 min, ~$2)
- B3/B4 ✅ analyze.mjs computed Recall@1, by-position, by-kind, McNemar, Cohen's h, Wilson CI
- B5 ✅ summary.md, results.json, paper-1-update.md, raw-outputs/ all written
- B6 ✅ PAPER-1-DRAFT.md updated with §3.4.5 Behavioral Recall (RQ1), abstract revised, conclusion revised
- B7 → next: git commit + push

## Headline result

| Condition | Semantic Recall@1 | Exact Recall@1 |
|---|---|---|
| Vanilla | 1.000 (50/50) | 0.780 (39/50) |
| Kasett  | 0.980 (49/50) | 0.780 (39/50) |
| Δ | -0.020 | +0.000 |

McNemar p (semantic) = 1.00, p (exact) = 0.97. Pre-registered hypothesis (≥ +10 pp) NOT met.

## What this means

Phase 2 measured machinery (SY: 0 vs 18.20) — Kasett wins categorically.
Phase 3 measured behavior — at single-compaction depth on synthetic data, NULL result.

This is publishable as-is with honest framing: structural preservation is established, behavioral preservation requires multi-compaction protocol (RQ4 from STUDY-DESIGN). Phase 3.5 is the natural next experiment.
