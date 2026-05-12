#!/usr/bin/env node
/**
 * Build probe-corpus.json — 5 synthetic scenarios × 10 planted facts each.
 *
 * Each scenario:
 *  - 80-150 turns of plausible domain-specific conversation
 *  - 10 facts planted at controlled positions (3 early 0-25%, 4 mid 35-65%, 3 late 75-100%)
 *  - Each fact has a probe: {question, expected_answer, position, kind}
 *  - Facts are mentioned ONCE at the planted position (so retention is real)
 *  - The conversation around the planted fact is filler (other relevant work)
 *
 * kinds: url | version | path | decision | blocker | deadline | person | command | error | value
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'probe-corpus.json');

// ----- helpers -----

// Generate filler turns around a domain — realistic but doesn't contain probe values
function filler(topic, n, seed) {
  // deterministic generator using seed
  const FILLER_TEMPLATES = {
    eng: [
      ['user', 'how is {x} progressing'],
      ['assistant', 'still working on {x}, ran into a small issue with the test setup but resolving it now'],
      ['user', 'can you also look at {y}'],
      ['assistant', 'yes — I\'ll start on {y} once {x} is wrapped'],
      ['user', 'got it'],
      ['assistant', 'making progress on {x} — the refactor is cleaner than expected'],
      ['user', 'any blockers I should know about'],
      ['assistant', 'nothing critical — just the usual coordination overhead with the {y} team'],
      ['user', 'sounds fine'],
      ['assistant', 'will keep you posted'],
      ['user', 'what about {y}'],
      ['assistant', '{y} is queued behind {x} — should start it tomorrow morning'],
      ['user', 'ok'],
      ['assistant', 'noted'],
    ],
    research: [
      ['user', 'have you read the {x} paper'],
      ['assistant', 'yes — the {x} approach is interesting, particularly the section on evaluation methodology'],
      ['user', 'what about {y}'],
      ['assistant', 'haven\'t gotten to {y} yet — it\'s on the reading list for this week'],
      ['user', 'how does {x} compare to our approach'],
      ['assistant', 'the main difference is they evaluate on cleaner data — our tier-3 sessions are more realistic'],
      ['user', 'interesting'],
      ['assistant', 'we should mention this in related work'],
    ],
    support: [
      ['user', 'customer is asking about {x}'],
      ['assistant', 'I\'ll pull up their account and check {x} status'],
      ['user', 'they\'re also confused about {y}'],
      ['assistant', 'I can clarify {y} in the same response'],
      ['user', 'they sound frustrated'],
      ['assistant', 'I\'ll make sure to acknowledge that and offer a clear path forward'],
    ],
    standup: [
      ['user', '{person} update on {x}'],
      ['assistant', '{person} reported {x} is on track for end of week'],
      ['user', 'any concerns'],
      ['assistant', 'minor: {y} dependency might slip but won\'t block {x}'],
    ],
    debug: [
      ['user', 'we\'re seeing weird behavior in {x}'],
      ['assistant', 'looking at logs — the {x} flow seems to fail intermittently'],
      ['user', 'check {y} too'],
      ['assistant', 'I\'ll trace through {y} to see if it\'s related'],
      ['user', 'reproduces only sometimes'],
      ['assistant', 'classic timing issue — narrowing down the race condition now'],
    ],
  };
  const xs = ['the orientation prompt logic', 'the steering integration', 'the dashboard refresh', 'the auth refactor', 'the migration', 'the perf work', 'the API rate limiting', 'the schema review'];
  const ys = ['the lifecycle detector', 'the snapshot writer', 'the cross-session index', 'the feedback loop', 'the validator', 'the parser path', 'the queue worker', 'the status check'];
  const people = ['Andrew', 'Walton', 'Thomson', 'Anna', 'Jim', 'Daniel', 'the customer', 'the on-call'];

  const turns = [];
  let s = seed;
  function rng() { s = (s * 9301 + 49297) % 233280; return s / 233280; }

  const tpls = FILLER_TEMPLATES[topic];
  for (let i = 0; i < n; i++) {
    const [role, tmpl] = tpls[Math.floor(rng() * tpls.length)];
    const text = tmpl
      .replace(/\{x\}/g, xs[Math.floor(rng() * xs.length)])
      .replace(/\{y\}/g, ys[Math.floor(rng() * ys.length)])
      .replace(/\{person\}/g, people[Math.floor(rng() * people.length)]);
    turns.push({ role, content: text });
  }
  return turns;
}

// Place plants into a filler stream at the desired positions.
// `plants` is an array of { position: 0..1, turn_pair: [{role,content},{role,content}] }
function buildScenarioTurns(filler_topic, total, plants, seed) {
  // Determine plant turn-indices (0-indexed)
  const placements = plants.map(p => ({ ...p, turnIdx: Math.max(2, Math.min(total - 4, Math.floor(p.position * total))) }))
    .sort((a, b) => a.turnIdx - b.turnIdx);
  // Build filler then insert plants at indices
  const turns = filler(filler_topic, total, seed);
  // Replace 2 turns starting at turnIdx with the planted pair (length matches if pair is length 2)
  let offset = 0; // adjust as we replace
  for (const p of placements) {
    const idx = p.turnIdx + offset;
    const pair = p.turn_pair;
    // splice: remove pair.length, insert pair
    turns.splice(idx, pair.length, ...pair);
  }
  return turns;
}

// ===== Scenario A: Multi-thread engineering (140 turns) =====
const scenarioA_facts = [
  { position: 0.05, kind: 'url', question: 'What URL did we deploy the staging API to?', expected_answer: 'https://api-staging.molt.ai',
    plant: [
      { role: 'user', content: 'Deploy the new auth gateway to staging — what URL should it live at?' },
      { role: 'assistant', content: 'I\'ll deploy it to https://api-staging.molt.ai. That\'s our standard staging endpoint and the certs are already provisioned for that hostname.' },
    ] },
  { position: 0.12, kind: 'version', question: 'What version of postgres did we settle on?', expected_answer: '15.4',
    plant: [
      { role: 'user', content: 'For the migration — which postgres version are we targeting?' },
      { role: 'assistant', content: 'Postgres 15.4. That gets us the partitioning improvements without committing to 16 yet — RDS support for 16 is still spotty in our region.' },
    ] },
  { position: 0.20, kind: 'person', question: 'Who said the launch should be August 1?', expected_answer: 'Walton',
    plant: [
      { role: 'user', content: 'Walton just messaged — wants to know when launch is.' },
      { role: 'assistant', content: 'Walton said the launch should be August 1 — that\'s when his marketing budget unlocks. We can probably hit that if the auth work stays on track.' },
    ] },
  { position: 0.38, kind: 'path', question: 'What\'s the path to the gateway config file?', expected_answer: '/etc/molt/gateway.toml',
    plant: [
      { role: 'user', content: 'Where does the gateway read its config from?' },
      { role: 'assistant', content: 'It reads from /etc/molt/gateway.toml at startup. That file controls upstream routing, rate-limit policy, and the JWT verifier settings.' },
    ] },
  { position: 0.46, kind: 'decision', question: 'What did we decide about the auth flow?', expected_answer: 'Use JWT, not OAuth',
    plant: [
      { role: 'user', content: 'OK final call on the auth flow — JWT or OAuth?' },
      { role: 'assistant', content: 'Decision: use JWT, not OAuth. OAuth complicates the SDK story for our partners and we don\'t need third-party auth providers in this phase. JWT keeps the API surface small and we can revisit if a partner needs it.' },
    ] },
  { position: 0.54, kind: 'error', question: 'What error did Andrew hit?', expected_answer: 'ECONNREFUSED on port 18790',
    plant: [
      { role: 'user', content: 'Andrew is stuck — what\'s his error?' },
      { role: 'assistant', content: 'Andrew hit ECONNREFUSED on port 18790 when trying to start the local gateway. Looks like another process is bound there — probably his previous run didn\'t clean up.' },
    ] },
  { position: 0.62, kind: 'value', question: 'How many requests per second is the rate limit set to?', expected_answer: '250',
    plant: [
      { role: 'user', content: 'What\'s the rate limit policy on the prod gateway?' },
      { role: 'assistant', content: 'Currently 250 requests per second per tenant on the prod gateway. We\'ll raise it once we\'ve seen real traffic patterns for a few weeks.' },
    ] },
  { position: 0.78, kind: 'command', question: 'What kubectl command did we use to roll the gateway pods?', expected_answer: 'kubectl rollout restart deploy/gateway -n molt-prod',
    plant: [
      { role: 'user', content: 'How do we roll the gateway pods after the config change?' },
      { role: 'assistant', content: 'Run: kubectl rollout restart deploy/gateway -n molt-prod. That triggers a rolling restart with the new config mounted. Should complete in about 90 seconds with our PDB.' },
    ] },
  { position: 0.86, kind: 'blocker', question: 'What\'s currently blocking the SDK release?', expected_answer: 'waiting on legal review of the EULA',
    plant: [
      { role: 'user', content: 'Why hasn\'t the SDK shipped yet?' },
      { role: 'assistant', content: 'We\'re waiting on legal review of the EULA. Andrew submitted it last week but counsel is backed up. That\'s the only blocker — code is ready, tests are green.' },
    ] },
  { position: 0.94, kind: 'deadline', question: 'When does the SOC 2 audit start?', expected_answer: 'September 15',
    plant: [
      { role: 'user', content: 'Set me a reminder for the SOC 2 audit start.' },
      { role: 'assistant', content: 'The SOC 2 audit starts September 15. I\'ll add it to your calendar — gives us about six weeks to button up the evidence collection.' },
    ] },
];

// ===== Scenario B: Multi-day research project (120 turns) =====
const scenarioB_facts = [
  { position: 0.04, kind: 'url', question: 'What dataset URL did we download for the LoCoMo replication?', expected_answer: 'https://huggingface.co/datasets/snap-stanford/locomo',
    plant: [
      { role: 'user', content: 'Get the LoCoMo dataset for replication.' },
      { role: 'assistant', content: 'Downloading from https://huggingface.co/datasets/snap-stanford/locomo. About 1.2GB compressed.' },
    ] },
  { position: 0.10, kind: 'value', question: 'What was the baseline accuracy reported in the LoCoMo paper?', expected_answer: '67.3%',
    plant: [
      { role: 'user', content: 'What did LoCoMo report for baseline accuracy?' },
      { role: 'assistant', content: 'Their published baseline is 67.3% on the temporal QA subset. That\'s the number we need to beat or match for the comparison to be credible.' },
    ] },
  { position: 0.22, kind: 'person', question: 'Who is the first author of the LoCoMo paper?', expected_answer: 'Maharana',
    plant: [
      { role: 'user', content: 'Who wrote LoCoMo?' },
      { role: 'assistant', content: 'First author is Maharana. The paper is from 2024 — coauthors are Lee, Tulyakov, and Bansal.' },
    ] },
  { position: 0.34, kind: 'path', question: 'Where are we storing the experiment results?', expected_answer: 'research/locomo-replication/results/',
    plant: [
      { role: 'user', content: 'Where should results land?' },
      { role: 'assistant', content: 'I\'ll write all per-run JSON to research/locomo-replication/results/ — same structure as our phase2-results layout. That way the analysis scripts can find them.' },
    ] },
  { position: 0.42, kind: 'decision', question: 'Which model are we holding fixed for the replication?', expected_answer: 'Sonnet 4.5',
    plant: [
      { role: 'user', content: 'OK, what model are we pinning?' },
      { role: 'assistant', content: 'We\'re holding Sonnet 4.5 fixed across all conditions. It\'s the production model and that gives us the cleanest apples-to-apples against our phase 2 data.' },
    ] },
  { position: 0.50, kind: 'value', question: 'How many sessions are in the LoCoMo evaluation set?', expected_answer: '300',
    plant: [
      { role: 'user', content: 'How many sessions does LoCoMo include?' },
      { role: 'assistant', content: 'There are 300 sessions in the eval split. That gives us decent statistical power if we run all of them, though we\'ll probably start with a 50-session pilot.' },
    ] },
  { position: 0.58, kind: 'blocker', question: 'What\'s blocking us from running the full eval?', expected_answer: 'OpenRouter rate limits',
    plant: [
      { role: 'user', content: 'Why can\'t we just run all 300?' },
      { role: 'assistant', content: 'We\'re hitting OpenRouter rate limits — they cap us at 50 RPM on Sonnet and the eval needs ~3 calls per session. So 300 sessions is realistically two or three days of throughput.' },
    ] },
  { position: 0.78, kind: 'command', question: 'What command kicks off the replication run?', expected_answer: 'node research/locomo-replication/run-eval.mjs --pilot',
    plant: [
      { role: 'user', content: 'What\'s the entry point for the eval?' },
      { role: 'assistant', content: 'Run: node research/locomo-replication/run-eval.mjs --pilot. That picks up the 50-session pilot subset and writes results into the results dir.' },
    ] },
  { position: 0.85, kind: 'deadline', question: 'When is the EMNLP submission deadline?', expected_answer: 'June 15',
    plant: [
      { role: 'user', content: 'When is EMNLP due?' },
      { role: 'assistant', content: 'EMNLP submission deadline is June 15. That gives us about five weeks to finish the experiments, write the paper, and run an internal review pass.' },
    ] },
  { position: 0.92, kind: 'version', question: 'What version of BERTScore are we using?', expected_answer: '0.3.13',
    plant: [
      { role: 'user', content: 'Which BERTScore version did you pin?' },
      { role: 'assistant', content: 'BERTScore 0.3.13. The newer 0.4 line broke the rescale baseline numbers we want for comparability with prior work.' },
    ] },
];

// ===== Scenario C: Customer support session (90 turns) =====
const scenarioC_facts = [
  { position: 0.06, kind: 'value', question: 'What is the customer\'s ticket ID?', expected_answer: 'TKT-48721',
    plant: [
      { role: 'user', content: 'New ticket from a customer — please look at it.' },
      { role: 'assistant', content: 'Got it — opening TKT-48721. Customer is reporting auth failures starting around 14:00 UTC.' },
    ] },
  { position: 0.14, kind: 'person', question: 'What is the customer\'s name?', expected_answer: 'Priya Sharma',
    plant: [
      { role: 'user', content: 'Who am I dealing with on this one?' },
      { role: 'assistant', content: 'Customer is Priya Sharma — head of platform at Lensgrid. She\'s a power user, opened seven tickets last quarter, all resolved positively.' },
    ] },
  { position: 0.22, kind: 'error', question: 'What error code is the customer seeing?', expected_answer: '401 invalid_grant',
    plant: [
      { role: 'user', content: 'What\'s she actually seeing?' },
      { role: 'assistant', content: 'She\'s seeing 401 invalid_grant from /token when she swaps the refresh token. That points to the refresh tokens being expired or rotated unexpectedly on our side.' },
    ] },
  { position: 0.40, kind: 'decision', question: 'What did we decide to send the customer as a workaround?', expected_answer: 'a fresh API key with extended expiry',
    plant: [
      { role: 'user', content: 'What can I tell her right now?' },
      { role: 'assistant', content: 'Decision: we\'ll send the customer a fresh API key with extended expiry — 90 days instead of 30 — so she\'s unblocked while we fix the rotation bug. I\'ll generate it now.' },
    ] },
  { position: 0.48, kind: 'url', question: 'What support article URL did we send her?', expected_answer: 'https://docs.molt.ai/support/refresh-token-rotation',
    plant: [
      { role: 'user', content: 'Link her our refresh-token doc.' },
      { role: 'assistant', content: 'Sent: https://docs.molt.ai/support/refresh-token-rotation. That walks through the expected behavior and the new key flow.' },
    ] },
  { position: 0.55, kind: 'value', question: 'What is her account ID?', expected_answer: 'acct_8H3KQR7L9P',
    plant: [
      { role: 'user', content: 'I need her account ID for the regeneration.' },
      { role: 'assistant', content: 'Account ID is acct_8H3KQR7L9P. I\'ll regenerate against that account and email the new key to her registered address.' },
    ] },
  { position: 0.62, kind: 'blocker', question: 'What\'s blocking us from doing a real fix?', expected_answer: 'the rotation worker is owned by the platform team and they\'re mid-migration',
    plant: [
      { role: 'user', content: 'Why can\'t we just fix the rotation bug?' },
      { role: 'assistant', content: 'The rotation worker is owned by the platform team and they\'re mid-migration. They asked us to hold patches against that service until next sprint — too risky during the cutover.' },
    ] },
  { position: 0.80, kind: 'deadline', question: 'When did we promise the permanent fix?', expected_answer: 'May 28',
    plant: [
      { role: 'user', content: 'What did we promise her?' },
      { role: 'assistant', content: 'Promised the permanent fix by May 28 — that\'s the day after the platform-team migration freeze ends. She accepted that timeline.' },
    ] },
  { position: 0.88, kind: 'path', question: 'Where is the workaround documented internally?', expected_answer: 'wiki/runbooks/refresh-token-extended-expiry.md',
    plant: [
      { role: 'user', content: 'Make sure other support folks know about the workaround.' },
      { role: 'assistant', content: 'I\'ll write it up at wiki/runbooks/refresh-token-extended-expiry.md so the rest of the team can find it. Linking it from the on-call rota notes.' },
    ] },
  { position: 0.96, kind: 'command', question: 'What command regenerates the customer key?', expected_answer: 'molt-cli keys regenerate --account=acct_8H3KQR7L9P --ttl=90d',
    plant: [
      { role: 'user', content: 'What\'s the regen command for the record?' },
      { role: 'assistant', content: 'For the postmortem record: molt-cli keys regenerate --account=acct_8H3KQR7L9P --ttl=90d. That\'s exactly what we ran.' },
    ] },
];

// ===== Scenario D: Multi-task standup (110 turns) =====
const scenarioD_facts = [
  { position: 0.05, kind: 'person', question: 'Who is leading the dashboard work?', expected_answer: 'Daniel',
    plant: [
      { role: 'user', content: 'Who\'s on the dashboard work this week?' },
      { role: 'assistant', content: 'Daniel is leading the dashboard work. He picked it up after the reorg and it\'s been moving faster than the previous owner had it going.' },
    ] },
  { position: 0.12, kind: 'version', question: 'What version of React is the dashboard targeting?', expected_answer: '19.0.0-rc.1',
    plant: [
      { role: 'user', content: 'What version of React are we on?' },
      { role: 'assistant', content: 'Dashboard is on React 19.0.0-rc.1. We jumped to the RC because we wanted the new use() hook for the streaming data sections. Will downgrade to stable once 19.0 ships.' },
    ] },
  { position: 0.20, kind: 'value', question: 'How many beta customers are using the dashboard?', expected_answer: '14',
    plant: [
      { role: 'user', content: 'How big is the dashboard beta now?' },
      { role: 'assistant', content: '14 beta customers active. We added four more last week — three from the inbound waitlist and one from a partner intro.' },
    ] },
  { position: 0.38, kind: 'url', question: 'What URL is the dashboard staging environment at?', expected_answer: 'https://dashboard-stg.molt.ai',
    plant: [
      { role: 'user', content: 'Where can I see the staging dashboard?' },
      { role: 'assistant', content: 'Staging is at https://dashboard-stg.molt.ai. Login uses your Molt SSO — same creds as the main app.' },
    ] },
  { position: 0.45, kind: 'decision', question: 'What did we decide about the data export feature?', expected_answer: 'punt to Q3, not in v1',
    plant: [
      { role: 'user', content: 'Are we shipping data export with v1?' },
      { role: 'assistant', content: 'Decision: punt to Q3, not in v1. Three customers have asked for it but it complicates the auth model and we don\'t want to delay v1 over it. We\'ll revisit in the Q3 planning.' },
    ] },
  { position: 0.53, kind: 'error', question: 'What error did the QA team report on the metrics page?', expected_answer: 'NaN displayed when no data is present',
    plant: [
      { role: 'user', content: 'Anything from QA on metrics?' },
      { role: 'assistant', content: 'QA reported NaN displayed when no data is present. The aggregation function returns NaN and the formatter doesn\'t guard against it. Daniel has a fix in PR but it hasn\'t merged yet.' },
    ] },
  { position: 0.60, kind: 'path', question: 'What\'s the path to the dashboard repo?', expected_answer: 'github.com/moltaicorp/molt-dashboard',
    plant: [
      { role: 'user', content: 'Repo for dashboard?' },
      { role: 'assistant', content: 'github.com/moltaicorp/molt-dashboard. Daniel owns it; PRs route to him for review.' },
    ] },
  { position: 0.78, kind: 'blocker', question: 'What\'s blocking the analytics integration?', expected_answer: 'waiting on Segment API access',
    plant: [
      { role: 'user', content: 'Why is the analytics piece stalled?' },
      { role: 'assistant', content: 'We\'re waiting on Segment API access. Anna submitted the request two weeks ago but their onboarding is slow. That\'s the only blocker — instrumentation code is ready.' },
    ] },
  { position: 0.86, kind: 'deadline', question: 'When is the dashboard v1 GA?', expected_answer: 'June 30',
    plant: [
      { role: 'user', content: 'GA date for dashboard?' },
      { role: 'assistant', content: 'Dashboard v1 GA is June 30. That\'s firm — investor demo on July 2 needs it live.' },
    ] },
  { position: 0.94, kind: 'command', question: 'How do we run the dashboard tests locally?', expected_answer: 'pnpm test --filter=dashboard',
    plant: [
      { role: 'user', content: 'How do I run dashboard tests?' },
      { role: 'assistant', content: 'pnpm test --filter=dashboard. That isolates the dashboard package; full monorepo run takes too long for inner-loop work.' },
    ] },
];

// ===== Scenario E: Cross-thread debug (130 turns) =====
const scenarioE_facts = [
  { position: 0.04, kind: 'error', question: 'What was the original error symptom?', expected_answer: 'p99 latency jumped from 80ms to 2400ms',
    plant: [
      { role: 'user', content: 'Something\'s wrong with the API — alerts are firing.' },
      { role: 'assistant', content: 'I see it: p99 latency jumped from 80ms to 2400ms starting around 10 minutes ago. Error rate is also up but more modestly — 0.3% to 1.1%.' },
    ] },
  { position: 0.10, kind: 'value', question: 'What time did the regression start?', expected_answer: '08:42 UTC',
    plant: [
      { role: 'user', content: 'When did this start exactly?' },
      { role: 'assistant', content: 'Regression started at 08:42 UTC according to the latency dashboard. The change is sharp — looks like a deploy, not gradual drift.' },
    ] },
  { position: 0.22, kind: 'person', question: 'Who pushed the deploy that caused it?', expected_answer: 'Anna',
    plant: [
      { role: 'user', content: 'Whose deploy was it?' },
      { role: 'assistant', content: 'Anna pushed the deploy at 08:40, two minutes before the regression started. The PR was a refactor of the response-serialization path — looks like it accidentally introduced a synchronous DB call.' },
    ] },
  { position: 0.30, kind: 'path', question: 'What file contains the bug?', expected_answer: 'src/server/serialize.ts',
    plant: [
      { role: 'user', content: 'Which file has the bug?' },
      { role: 'assistant', content: 'The bug is in src/server/serialize.ts. The new code path calls a sync helper that hits the DB on every response — was supposed to be async and cached.' },
    ] },
  { position: 0.42, kind: 'decision', question: 'What did we decide to do — rollback or hotfix?', expected_answer: 'rollback first, hotfix in PR',
    plant: [
      { role: 'user', content: 'Rollback or hotfix?' },
      { role: 'assistant', content: 'Decision: rollback first, hotfix in PR. We get latency back to baseline immediately and Anna can finish the actual fix in code review without prod pressure. Standard incident pattern.' },
    ] },
  { position: 0.50, kind: 'command', question: 'What command rolled back the deploy?', expected_answer: 'molt-deploy rollback --service=api --to=v2.14.7',
    plant: [
      { role: 'user', content: 'What\'s the rollback command?' },
      { role: 'assistant', content: 'Ran: molt-deploy rollback --service=api --to=v2.14.7. That pins us to the last good build. Latency should normalize within about three minutes as new pods replace old ones.' },
    ] },
  { position: 0.58, kind: 'version', question: 'What version are we rolled back to?', expected_answer: 'v2.14.7',
    plant: [
      { role: 'user', content: 'Which version are we on now?' },
      { role: 'assistant', content: 'Currently running v2.14.7 in prod. That\'s last Tuesday\'s release — known good, all dashboards green at that version.' },
    ] },
  { position: 0.78, kind: 'url', question: 'Where is the incident postmortem doc?', expected_answer: 'https://wiki.molt.ai/incidents/2026-05-12-api-latency',
    plant: [
      { role: 'user', content: 'Where\'s the postmortem doc?' },
      { role: 'assistant', content: 'I started the doc at https://wiki.molt.ai/incidents/2026-05-12-api-latency. Skeleton in place — timeline, contributing factors, action items. Anna and I will fill it in this afternoon.' },
    ] },
  { position: 0.85, kind: 'blocker', question: 'What\'s blocking the proper fix from merging?', expected_answer: 'CI flake on the new test',
    plant: [
      { role: 'user', content: 'Why hasn\'t the hotfix landed yet?' },
      { role: 'assistant', content: 'CI flake on the new test — the regression test Anna added is timing-sensitive and fails about 1 in 5 runs. She\'s rewriting it to use fake timers; once that\'s clean the PR will merge.' },
    ] },
  { position: 0.94, kind: 'deadline', question: 'When does the action-item review happen?', expected_answer: 'Friday 3pm MT',
    plant: [
      { role: 'user', content: 'When are we reviewing action items?' },
      { role: 'assistant', content: 'Action-item review is Friday 3pm MT. Standard incident cadence — 48 hours after resolution. I\'ll send invites once the postmortem doc is fleshed out.' },
    ] },
];

// ===== Build scenarios =====
const SCENARIOS = [
  { id: 'A', name: 'Multi-thread engineering work', filler_topic: 'eng', total_turns: 140, facts: scenarioA_facts, seed: 17 },
  { id: 'B', name: 'Multi-day research project', filler_topic: 'research', total_turns: 120, facts: scenarioB_facts, seed: 23 },
  { id: 'C', name: 'Customer support session', filler_topic: 'support', total_turns: 90, facts: scenarioC_facts, seed: 31 },
  { id: 'D', name: 'Multi-task standup', filler_topic: 'standup', total_turns: 110, facts: scenarioD_facts, seed: 41 },
  { id: 'E', name: 'Cross-thread debug', filler_topic: 'debug', total_turns: 130, facts: scenarioE_facts, seed: 53 },
];

const corpus = [];
for (const s of SCENARIOS) {
  // Build plants array with turn_pair
  const plants = s.facts.map(f => ({ position: f.position, turn_pair: f.plant }));
  const turns = buildScenarioTurns(s.filler_topic, s.total_turns, plants, s.seed);
  // Strip plant from facts (kept separate for harness)
  const facts = s.facts.map((f, i) => ({
    fact_id: `${s.id}-${i + 1}`,
    question: f.question,
    expected_answer: f.expected_answer,
    position: f.position,
    kind: f.kind,
  }));
  corpus.push({
    scenario: s.id,
    name: s.name,
    total_turns: turns.length,
    turns,
    facts,
  });
}

writeFileSync(OUT_PATH, JSON.stringify(corpus, null, 2));
console.log(`Wrote ${corpus.length} scenarios to ${OUT_PATH}`);
for (const s of corpus) {
  console.log(`  ${s.scenario}: ${s.name} — ${s.total_turns} turns, ${s.facts.length} probes`);
}
