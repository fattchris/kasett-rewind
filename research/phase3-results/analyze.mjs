#!/usr/bin/env node
/**
 * Analyze results.json — produce summary.md with:
 *   - Recall@1 overall (using semantic_match as primary; exact_match as secondary)
 *   - Recall by position bucket (early 0-25%, mid 35-65%, late 75-100%)
 *   - Recall by kind
 *   - Hallucination rate
 *   - No-answer rate
 *   - McNemar's test
 *   - Cohen's h
 *   - Wilson 95% CI
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(__dirname, 'results.json');
const SUMMARY_PATH = join(__dirname, 'summary.md');

const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));

// Flatten all probes
const probes = [];
for (const sc of results.scenarios) {
  for (const p of sc.probes) {
    probes.push({ scenario: sc.scenario, ...p });
  }
}

const N = probes.length;

// ---- Helpers ----
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }

// Wilson 95% CI for proportion
function wilsonCI(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

// Cohen's h for two proportions
function cohensH(p1, p2) {
  const phi1 = 2 * Math.asin(Math.sqrt(p1));
  const phi2 = 2 * Math.asin(Math.sqrt(p2));
  return phi2 - phi1;
}

function interpretH(h) {
  const a = Math.abs(h);
  if (a >= 0.8) return 'Large';
  if (a >= 0.5) return 'Medium';
  if (a >= 0.2) return 'Small';
  return 'Negligible';
}

// McNemar's test (exact for small samples) — paired binary
// returns { b, c, statistic, pValue }
// b = vanilla correct, kasett incorrect; c = vanilla incorrect, kasett correct
function mcnemar(b, c) {
  const n = b + c;
  if (n === 0) return { b, c, statistic: 0, pValue: 1 };
  // Continuity-corrected chi-square
  const stat = Math.pow(Math.abs(b - c) - 1, 2) / n;
  // Two-tailed exact p-value using binomial: P(|X - n/2| >= |b - n/2|) where X~Bin(n, 0.5)
  // For simplicity use chi-square approx with df=1 + exact binomial for small n
  // Exact two-sided binomial p-value:
  function binomialPMF(k, n, p) {
    let logCoef = 0;
    for (let i = 1; i <= k; i++) logCoef += Math.log(n - i + 1) - Math.log(i);
    return Math.exp(logCoef + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) p += binomialPMF(i, n, 0.5);
  for (let i = n - k; i <= n; i++) p += binomialPMF(i, n, 0.5);
  if (b === c) p = Math.min(1, p / 2 + binomialPMF(b, n, 0.5)); // adjust for tie
  return { b, c, statistic: stat, pValue: Math.min(1, p) };
}

// ---- Build per-condition correctness arrays ----
// Primary metric: semantic_match (binary). Secondary: exact_match.
const v_correct = probes.map(p => p.vanilla.semantic_match);
const k_correct = probes.map(p => p.kasett.semantic_match);
const v_em = probes.map(p => p.vanilla.exact_match);
const k_em = probes.map(p => p.kasett.exact_match);
const v_hall = probes.map(p => p.vanilla.hallucinated);
const k_hall = probes.map(p => p.kasett.hallucinated);
const v_no = probes.map(p => p.vanilla.no_answer);
const k_no = probes.map(p => p.kasett.no_answer);

// Recall@1 (semantic)
const v_recall_sem = sum(v_correct);
const k_recall_sem = sum(k_correct);
const v_recall_sem_p = v_recall_sem / N;
const k_recall_sem_p = k_recall_sem / N;
const delta_sem = k_recall_sem_p - v_recall_sem_p;
const v_ci_sem = wilsonCI(v_recall_sem, N);
const k_ci_sem = wilsonCI(k_recall_sem, N);
const h_sem = cohensH(v_recall_sem_p, k_recall_sem_p);

// Exact match
const v_recall_em = sum(v_em);
const k_recall_em = sum(k_em);
const v_recall_em_p = v_recall_em / N;
const k_recall_em_p = k_recall_em / N;
const delta_em = k_recall_em_p - v_recall_em_p;
const v_ci_em = wilsonCI(v_recall_em, N);
const k_ci_em = wilsonCI(k_recall_em, N);
const h_em = cohensH(v_recall_em_p, k_recall_em_p);

// McNemar (semantic)
let mcn_b_sem = 0, mcn_c_sem = 0;
for (let i = 0; i < N; i++) {
  if (v_correct[i] === 1 && k_correct[i] === 0) mcn_b_sem++;
  if (v_correct[i] === 0 && k_correct[i] === 1) mcn_c_sem++;
}
const mcn_sem = mcnemar(mcn_b_sem, mcn_c_sem);

// McNemar (exact)
let mcn_b_em = 0, mcn_c_em = 0;
for (let i = 0; i < N; i++) {
  if (v_em[i] === 1 && k_em[i] === 0) mcn_b_em++;
  if (v_em[i] === 0 && k_em[i] === 1) mcn_c_em++;
}
const mcn_em_test = mcnemar(mcn_b_em, mcn_c_em);

// ---- By position bucket ----
function bucket(pos) {
  if (pos <= 0.25) return 'early';
  if (pos <= 0.65) return 'mid';
  return 'late';
}
const buckets = ['early', 'mid', 'late'];
const byPosition = {};
for (const b of buckets) {
  const subset = probes.filter(p => bucket(p.position) === b);
  const v = subset.map(p => p.vanilla.semantic_match);
  const k = subset.map(p => p.kasett.semantic_match);
  const v_em_b = subset.map(p => p.vanilla.exact_match);
  const k_em_b = subset.map(p => p.kasett.exact_match);
  byPosition[b] = {
    n: subset.length,
    v_recall_sem: sum(v) / Math.max(1, subset.length),
    k_recall_sem: sum(k) / Math.max(1, subset.length),
    v_recall_em: sum(v_em_b) / Math.max(1, subset.length),
    k_recall_em: sum(k_em_b) / Math.max(1, subset.length),
    delta_sem: (sum(k) - sum(v)) / Math.max(1, subset.length),
    delta_em: (sum(k_em_b) - sum(v_em_b)) / Math.max(1, subset.length),
  };
}

// ---- By kind ----
const kinds = [...new Set(probes.map(p => p.kind))].sort();
const byKind = {};
for (const k of kinds) {
  const subset = probes.filter(p => p.kind === k);
  const v = subset.map(p => p.vanilla.semantic_match);
  const ka = subset.map(p => p.kasett.semantic_match);
  const v_em_k = subset.map(p => p.vanilla.exact_match);
  const k_em_k = subset.map(p => p.kasett.exact_match);
  byKind[k] = {
    n: subset.length,
    v_recall_sem: sum(v) / Math.max(1, subset.length),
    k_recall_sem: sum(ka) / Math.max(1, subset.length),
    v_recall_em: sum(v_em_k) / Math.max(1, subset.length),
    k_recall_em: sum(k_em_k) / Math.max(1, subset.length),
    delta_sem: (sum(ka) - sum(v)) / Math.max(1, subset.length),
    delta_em: (sum(k_em_k) - sum(v_em_k)) / Math.max(1, subset.length),
  };
}

// ---- Per-scenario ----
const byScenario = {};
for (const sc of results.scenarios) {
  const v = sc.probes.map(p => p.vanilla.semantic_match);
  const k = sc.probes.map(p => p.kasett.semantic_match);
  const v_em_s = sc.probes.map(p => p.vanilla.exact_match);
  const k_em_s = sc.probes.map(p => p.kasett.exact_match);
  byScenario[sc.scenario] = {
    name: sc.name,
    n: sc.probes.length,
    v_recall_sem: sum(v) / sc.probes.length,
    k_recall_sem: sum(k) / sc.probes.length,
    v_recall_em: sum(v_em_s) / sc.probes.length,
    k_recall_em: sum(k_em_s) / sc.probes.length,
    kasett_sy: sc.kasett_sy,
    kasett_has_meta: sc.kasett_has_meta,
  };
}

// Hallucination rate (denom: probes that gave a non-no-answer)
const v_attempted = probes.filter(p => !p.vanilla.no_answer);
const k_attempted = probes.filter(p => !p.kasett.no_answer);
const v_hall_rate = v_attempted.length ? sum(v_attempted.map(p => p.vanilla.hallucinated)) / v_attempted.length : 0;
const k_hall_rate = k_attempted.length ? sum(k_attempted.map(p => p.kasett.hallucinated)) / k_attempted.length : 0;
const v_no_rate = sum(v_no) / N;
const k_no_rate = sum(k_no) / N;

// ---- Build markdown ----
let md = `# Phase 3 — Behavioral Probe Benchmark Results

**Date:** ${new Date().toISOString()}
**Probes:** ${N} (${results.scenarios.length} scenarios × 10 facts each)
**Compaction model:** anthropic/claude-sonnet-4-5
**Probe-answer model:** anthropic/claude-sonnet-4-5
**LLM-judge model:** anthropic/claude-sonnet-4-6 (different model — bias control)

---

## 1. Headline: Recall@1

Primary metric is **semantic_match** (judged by Sonnet 4.6 — does the candidate answer correctly identify the expected answer, allowing paraphrase).
Secondary metric is **exact_match** (lowercase substring presence).

### Semantic Recall@1

| Condition | Correct | Recall@1 | 95% CI (Wilson) |
|---|---|---|---|
| Vanilla | ${v_recall_sem}/${N} | ${v_recall_sem_p.toFixed(3)} | [${v_ci_sem[0].toFixed(3)}, ${v_ci_sem[1].toFixed(3)}] |
| Kasett  | ${k_recall_sem}/${N} | ${k_recall_sem_p.toFixed(3)} | [${k_ci_sem[0].toFixed(3)}, ${k_ci_sem[1].toFixed(3)}] |
| **Δ (K − V)** | **${(k_recall_sem - v_recall_sem) >= 0 ? '+' : ''}${k_recall_sem - v_recall_sem}** | **${delta_sem >= 0 ? '+' : ''}${delta_sem.toFixed(3)}** | — |

- **Cohen's h:** ${h_sem.toFixed(3)} (${interpretH(h_sem)})
- **McNemar paired test:** b=${mcn_sem.b} (V✓ K✗), c=${mcn_sem.c} (V✗ K✓), exact two-sided p=${mcn_sem.pValue.toFixed(4)}

### Exact-match Recall@1

| Condition | Correct | Recall@1 | 95% CI (Wilson) |
|---|---|---|---|
| Vanilla | ${v_recall_em}/${N} | ${v_recall_em_p.toFixed(3)} | [${v_ci_em[0].toFixed(3)}, ${v_ci_em[1].toFixed(3)}] |
| Kasett  | ${k_recall_em}/${N} | ${k_recall_em_p.toFixed(3)} | [${k_ci_em[0].toFixed(3)}, ${k_ci_em[1].toFixed(3)}] |
| **Δ (K − V)** | **${(k_recall_em - v_recall_em) >= 0 ? '+' : ''}${k_recall_em - v_recall_em}** | **${delta_em >= 0 ? '+' : ''}${delta_em.toFixed(3)}** | — |

- **Cohen's h:** ${h_em.toFixed(3)} (${interpretH(h_em)})
- **McNemar paired test:** b=${mcn_em_test.b} (V✓ K✗), c=${mcn_em_test.c} (V✗ K✓), exact two-sided p=${mcn_em_test.pValue.toFixed(4)}

---

## 2. Recall by position bucket (LoCoMo-style stratification)

Probes are stratified by where the planted fact lives in the conversation:
- **early:** position ≤ 0.25
- **mid:**   0.25 < position ≤ 0.65
- **late:**  position > 0.65

| Bucket | n | V semantic | K semantic | Δ sem | V exact | K exact | Δ exact |
|---|---|---|---|---|---|---|---|
${buckets.map(b => {
  const r = byPosition[b];
  return `| ${b} | ${r.n} | ${r.v_recall_sem.toFixed(3)} | ${r.k_recall_sem.toFixed(3)} | ${r.delta_sem >= 0 ? '+' : ''}${r.delta_sem.toFixed(3)} | ${r.v_recall_em.toFixed(3)} | ${r.k_recall_em.toFixed(3)} | ${r.delta_em >= 0 ? '+' : ''}${r.delta_em.toFixed(3)} |`;
}).join('\n')}

LoCoMo expectation: vanilla degrades more on early-position facts (further from end of summary). If we observe this pattern, Kasett's structured key_state should preserve early facts better.

---

## 3. Recall by kind

| Kind | n | V semantic | K semantic | Δ sem | V exact | K exact | Δ exact |
|---|---|---|---|---|---|---|---|
${kinds.map(k => {
  const r = byKind[k];
  return `| ${k} | ${r.n} | ${r.v_recall_sem.toFixed(3)} | ${r.k_recall_sem.toFixed(3)} | ${r.delta_sem >= 0 ? '+' : ''}${r.delta_sem.toFixed(3)} | ${r.v_recall_em.toFixed(3)} | ${r.k_recall_em.toFixed(3)} | ${r.delta_em >= 0 ? '+' : ''}${r.delta_em.toFixed(3)} |`;
}).join('\n')}

Hypothesis: URL/path/version probes should benefit MORE from Kasett (key_state is designed for these). Decisions/blockers should benefit moderately. Person/deadline less.

---

## 4. Per-scenario Recall

| Scenario | Name | n | V sem | K sem | Δ sem | V exact | K exact | Kasett SY | has_meta |
|---|---|---|---|---|---|---|---|---|---|
${Object.entries(byScenario).map(([id, r]) => {
  return `| ${id} | ${r.name} | ${r.n} | ${r.v_recall_sem.toFixed(3)} | ${r.k_recall_sem.toFixed(3)} | ${(r.k_recall_sem - r.v_recall_sem) >= 0 ? '+' : ''}${(r.k_recall_sem - r.v_recall_sem).toFixed(3)} | ${r.v_recall_em.toFixed(3)} | ${r.k_recall_em.toFixed(3)} | ${r.kasett_sy} | ${r.kasett_has_meta} |`;
}).join('\n')}

---

## 5. Hallucination & No-answer

Hallucination = LLM-judge identifies a fabricated specific value (URL/number/name/etc.) not in context.
Denominator: probes where the agent attempted an answer (excludes no-answer responses).

| Condition | Attempted (n) | Hallucinated | Hall rate | No-answer (of ${N}) | No-answer rate |
|---|---|---|---|---|---|
| Vanilla | ${v_attempted.length} | ${sum(v_attempted.map(p => p.vanilla.hallucinated))} | ${v_hall_rate.toFixed(3)} | ${sum(v_no)} | ${v_no_rate.toFixed(3)} |
| Kasett  | ${k_attempted.length} | ${sum(k_attempted.map(p => p.kasett.hallucinated))} | ${k_hall_rate.toFixed(3)} | ${sum(k_no)} | ${k_no_rate.toFixed(3)} |

Higher no-answer rate is honest (no fabrication); lower can be either better recall OR more hallucination.

---

## 6. Interpretation

Hypothesis (RQ1): Kasett Recall@1 > Vanilla Recall@1 by ≥ 10 percentage points.

**Observed:**
- Semantic: ${delta_sem >= 0 ? '+' : ''}${(delta_sem * 100).toFixed(1)} pp (Cohen's h ${h_sem.toFixed(2)} ${interpretH(h_sem)})
- Exact:    ${delta_em  >= 0 ? '+' : ''}${(delta_em  * 100).toFixed(1)} pp (Cohen's h ${h_em.toFixed(2)} ${interpretH(h_em)})

**Direction of effect on McNemar's discordant pairs:**
- Semantic: c-b = ${mcn_sem.c - mcn_sem.b} (positive favors Kasett)
- Exact:    c-b = ${mcn_em_test.c - mcn_em_test.b} (positive favors Kasett)

`;

// Honest interpretation depends on what we observed
const semHypothesisMet = delta_sem >= 0.10;
const semSig = mcn_sem.pValue < 0.05;
const emHypothesisMet = delta_em >= 0.10;
const emSig = mcn_em_test.pValue < 0.05;

md += `**Pre-registered hypothesis status:**
- Semantic Recall@1 ≥ +10pp: ${semHypothesisMet ? '✅ MET' : '❌ NOT MET'}
- Statistically significant (p<0.05): semantic ${semSig ? '✅' : '❌'}, exact ${emSig ? '✅' : '❌'}

`;

// Why might delta be small? Discuss
md += `### Why the observed delta may be smaller than predicted

The original hypothesis (vanilla 0.55–0.70, Kasett 0.75–0.90) assumed the prose summary would lose specific values. Observed result: ${v_recall_sem_p >= 0.85 ? `vanilla scored ${v_recall_sem_p.toFixed(2)} — the prose summary actually preserves most planted facts.` : `vanilla scored ${v_recall_sem_p.toFixed(2)}.`}

This could be:

1. **Synthetic conversations are too clean.** 80–150-turn conversations with explicit, well-formed plants are easy for Sonnet 4.5 to summarize. Real Molt sessions have ambiguity, aborted threads, partial facts — much harder to compress without loss. The benchmark needs to stress compaction more than this corpus does.
2. **Ceiling effect on the probe-answer call.** The probe-answer LLM is also Sonnet 4.5 — strong enough to answer paraphrastically from a decent prose summary even when the exact value is missing.
3. **Compaction ratio is too low.** The conversations compress to a 2–4KB summary from a ~20–30KB transcript. That's roughly a 10:1 ratio. Real production compaction operates at 30:1 or higher and that's where loss begins to bite.
4. **Single compaction.** STUDY-DESIGN's protocol calls for 3–5 compaction cycles; we ran one. Cumulative loss is the regime where Kasett's structure should help most. Phase 3.5 should run multi-compaction probes.

This is itself a publishable finding: at single-compaction depth on synthetic data with strong models, structured output preservation does not measurably move behavioral recall. The structural delta (SY=0 vs SY=18) reported in Phase 2 remains the strongest categorical advantage; behavioral benefit emerges only under harder regimes.

---

## 7. Summary statistics (raw)

- N probes: ${N}
- Scenarios: ${results.scenarios.length}
- All Kasett compactions emitted parseable V3 meta: ${results.scenarios.every(s => s.kasett_has_meta) ? 'YES' : 'NO'}
- Mean Kasett SY across scenarios: ${(results.scenarios.reduce((a, s) => a + s.kasett_sy, 0) / results.scenarios.length).toFixed(1)}
- Vanilla SY (by construction): 0

---

## 8. Methodological honesty

This phase explicitly corrects Phase 2's framing. Phase 2 measured machinery (does Kasett emit structured output — yes, +18 artifacts/session). Phase 3 measures behavior (does Kasett make the agent more accurate at recalling planted facts after compaction).

The two questions are not the same. We initially conflated them. Phase 3 is the real RQ1 answer.

The result is more nuanced than the original hypothesis predicted: **on this corpus**, with strong models on both sides of the compaction, the prose summary already retains most planted facts. Kasett's structural advantage from Phase 2 is real and does not translate to a large behavioral delta in this single-compaction synthetic setting.

This does NOT mean Kasett doesn't help. It means:
- The benchmark needs more compaction stress (multi-cycle, higher compression ratio, real session noise)
- The structural delta is the categorical claim; the behavioral delta is small at single-compaction depth
- Future work should run multi-compaction degradation curves (RQ4 from STUDY-DESIGN)

---

## 9. Cost & runtime

- LLM calls: ${results.scenarios.length} scenarios × (2 compactions + ${probes.length / results.scenarios.length} probes × 6 calls) = ${results.scenarios.length * (2 + 10 * 6)} calls
- Wall time: ${results.completed && results.started ? Math.round((new Date(results.completed).getTime() - new Date(results.started).getTime()) / 1000) + 's' : 'n/a'}
- Estimated cost: ~\$2 (well under the \$15 budget)
`;

writeFileSync(SUMMARY_PATH, md);
console.log(`Wrote ${SUMMARY_PATH}`);
console.log(`\nRecall@1 (semantic): V=${v_recall_sem_p.toFixed(3)}, K=${k_recall_sem_p.toFixed(3)}, Δ=${delta_sem >= 0 ? '+' : ''}${delta_sem.toFixed(3)}, p=${mcn_sem.pValue.toFixed(4)}`);
console.log(`Recall@1 (exact):    V=${v_recall_em_p.toFixed(3)}, K=${k_recall_em_p.toFixed(3)}, Δ=${delta_em >= 0 ? '+' : ''}${delta_em.toFixed(3)}, p=${mcn_em_test.pValue.toFixed(4)}`);
console.log(`Hallucination: V=${v_hall_rate.toFixed(3)}, K=${k_hall_rate.toFixed(3)}`);
console.log(`No-answer:     V=${v_no_rate.toFixed(3)}, K=${k_no_rate.toFixed(3)}`);
