/**
 * Analyze Phase 4 results: combine 3 per-conversation results files,
 * compute Recall@1 by depth, thread continuity, key state, and
 * statistical separation.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const root = '/home/node/.openclaw/workspace/research/phase4-results';
const e = JSON.parse(readFileSync(`${root}/results-eks.json`, 'utf-8'));
const a = JSON.parse(readFileSync(`${root}/results-auth.json`, 'utf-8'));
const d = JSON.parse(readFileSync(`${root}/results-data.json`, 'utf-8'));

// Merge
const merged = {
  config: e.config,
  timestamp: new Date().toISOString(),
  vanilla: { ...e.vanilla, ...a.vanilla, ...d.vanilla },
  kasett: { ...e.kasett, ...a.kasett, ...d.kasett },
  probes: { ...e.probes, ...a.probes, ...d.probes },
};

writeFileSync(`${root}/results.json`, JSON.stringify(merged, null, 2));

// Score
const score = (v) => (v === 'CORRECT' ? 1 : v === 'PARTIAL' ? 0.5 : 0);

const allProbes = [];
for (const [convId, probes] of Object.entries(merged.probes)) {
  for (const p of probes) {
    allProbes.push({
      convId,
      probeId: p.probeId,
      depth: p.depth,
      type: p.type,
      vScore: score(p.vanilla.verdict),
      kScore: score(p.kasett.verdict),
      vVerdict: p.vanilla.verdict,
      kVerdict: p.kasett.verdict,
      vAnswer: p.vanilla.answer,
      kAnswer: p.kasett.answer,
      expected: p.expectedAnswer,
      question: p.question,
    });
  }
}

console.log(`Total probes: ${allProbes.length}`);

// Recall@1 by depth
const depths = ['current', 3, 2, 1];
const byDepth = {};
for (const dep of depths) {
  const subset = allProbes.filter((p) => String(p.depth) === String(dep));
  const vSum = subset.reduce((a, p) => a + p.vScore, 0);
  const kSum = subset.reduce((a, p) => a + p.kScore, 0);
  byDepth[dep] = {
    n: subset.length,
    vanilla: { correct: vSum, rate: vSum / subset.length },
    kasett: { correct: kSum, rate: kSum / subset.length },
    delta: (kSum - vSum) / subset.length,
  };
}

console.log('\n=== Recall@1 by depth ===');
console.log('Depth     | N  | Vanilla       | Kasett        | Delta');
for (const dep of depths) {
  const r = byDepth[dep];
  console.log(
    `${String(dep).padEnd(9)} | ${String(r.n).padStart(2)} | ${r.vanilla.correct}/${r.n} (${(r.vanilla.rate * 100).toFixed(1)}%) | ${r.kasett.correct}/${r.n} (${(r.kasett.rate * 100).toFixed(1)}%) | +${(r.delta * 100).toFixed(1)}pp`,
  );
}

// By probe type
const types = ['long-range-recall', 'decision-continuity', 'trajectory', 'thread-lineage'];
const byType = {};
for (const t of types) {
  const subset = allProbes.filter((p) => p.type === t);
  const vSum = subset.reduce((a, p) => a + p.vScore, 0);
  const kSum = subset.reduce((a, p) => a + p.kScore, 0);
  byType[t] = {
    n: subset.length,
    vanilla: { correct: vSum, rate: vSum / subset.length },
    kasett: { correct: kSum, rate: kSum / subset.length },
  };
}

console.log('\n=== Recall@1 by probe type ===');
for (const t of types) {
  const r = byType[t];
  console.log(
    `${t.padEnd(22)} | n=${r.n} | V=${r.vanilla.correct}/${r.n} (${(r.vanilla.rate * 100).toFixed(0)}%) | K=${r.kasett.correct}/${r.n} (${(r.kasett.rate * 100).toFixed(0)}%)`,
  );
}

// Overall
const vTotal = allProbes.reduce((a, p) => a + p.vScore, 0);
const kTotal = allProbes.reduce((a, p) => a + p.kScore, 0);
console.log(`\n=== Overall ===`);
console.log(`Vanilla: ${vTotal}/${allProbes.length} (${(vTotal / allProbes.length * 100).toFixed(1)}%)`);
console.log(`Kasett:  ${kTotal}/${allProbes.length} (${(kTotal / allProbes.length * 100).toFixed(1)}%)`);
console.log(`Delta:   +${((kTotal - vTotal) / allProbes.length * 100).toFixed(1)}pp`);

// Wilson 95% CI
function wilson95(s, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = s / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

console.log('\n=== Wilson 95% CIs ===');
for (const dep of depths) {
  const r = byDepth[dep];
  const v = wilson95(r.vanilla.correct, r.n);
  const k = wilson95(r.kasett.correct, r.n);
  console.log(
    `Depth ${String(dep).padEnd(7)} | V CI: [${(v[0] * 100).toFixed(1)}%, ${(v[1] * 100).toFixed(1)}%] | K CI: [${(k[0] * 100).toFixed(1)}%, ${(k[1] * 100).toFixed(1)}%]`,
  );
}

// McNemar's test (paired): for each probe, was Kasett right & Vanilla wrong, vs vice versa?
let kRightVWrong = 0;
let vRightKWrong = 0;
let bothRight = 0;
let bothWrong = 0;
let bothPartial = 0;
for (const p of allProbes) {
  const kCorrect = p.kVerdict === 'CORRECT';
  const vCorrect = p.vVerdict === 'CORRECT';
  if (kCorrect && vCorrect) bothRight++;
  else if (!kCorrect && !vCorrect) bothWrong++;
  else if (kCorrect && !vCorrect) kRightVWrong++;
  else if (!kCorrect && vCorrect) vRightKWrong++;
}

console.log('\n=== McNemar contingency ===');
console.log(`  Both CORRECT:        ${bothRight}`);
console.log(`  Kasett CORRECT only: ${kRightVWrong}`);
console.log(`  Vanilla CORRECT only: ${vRightKWrong}`);
console.log(`  Both WRONG/partial:  ${bothWrong}`);

// McNemar exact test (since n is small): one-tailed P(X >= kRightVWrong | X ~ Binomial(kRightVWrong+vRightKWrong, 0.5))
function binomCDF(k, n, p) {
  // P(X >= k)
  let logp = Math.log(p);
  let logq = Math.log(1 - p);
  let logFactN = 0;
  for (let i = 1; i <= n; i++) logFactN += Math.log(i);
  let prob = 0;
  for (let x = k; x <= n; x++) {
    let logFactX = 0;
    for (let i = 1; i <= x; i++) logFactX += Math.log(i);
    let logFactNX = 0;
    for (let i = 1; i <= n - x; i++) logFactNX += Math.log(i);
    prob += Math.exp(logFactN - logFactX - logFactNX + x * logp + (n - x) * logq);
  }
  return prob;
}

const discordant = kRightVWrong + vRightKWrong;
const pValue = binomCDF(kRightVWrong, discordant, 0.5);
console.log(`\nMcNemar one-tailed p (Kasett > Vanilla): p = ${pValue.toFixed(4)} (n_disc=${discordant})`);
const pTwoTailed = pValue * 2;
console.log(`McNemar two-tailed p: ${pTwoTailed.toFixed(4)}`);

// Effect size: Cohen's h for proportion difference, overall
function cohensH(p1, p2) {
  const phi1 = 2 * Math.asin(Math.sqrt(p1));
  const phi2 = 2 * Math.asin(Math.sqrt(p2));
  return Math.abs(phi1 - phi2);
}
const overallH = cohensH(kTotal / allProbes.length, vTotal / allProbes.length);
console.log(`Cohen's h (overall): ${overallH.toFixed(3)} (small=0.2, medium=0.5, large=0.8)`);

// Thread continuity rate (Kasett only)
console.log('\n=== Kasett thread continuity ===');
let totalThreadCarryovers = 0;
let totalThreadsAtN = 0;
for (const [convId, kData] of Object.entries(merged.kasett)) {
  const metas = kData.metas;
  if (!metas) continue;
  for (let i = 1; i < metas.length; i++) {
    const cur = metas[i]?.metaV2?.sub ?? [];
    const prev = metas[i - 1]?.metaV2?.sub ?? [];
    const prevIds = new Set(prev.map((s) => s.id));
    const carryover = cur.filter((s) => prevIds.has(s.id)).length;
    totalThreadCarryovers += carryover;
    totalThreadsAtN += cur.length;
    console.log(`  ${convId} C${i + 1}: ${carryover}/${cur.length} threads carried over from C${i}`);
  }
}
console.log(`Overall: ${totalThreadCarryovers}/${totalThreadsAtN} sub-threads carried over (${(totalThreadCarryovers / totalThreadsAtN * 100).toFixed(1)}%)`);

// Key state accumulation
console.log('\n=== Kasett key_state accumulation ===');
for (const [convId, kData] of Object.entries(merged.kasett)) {
  const metas = kData.metas;
  if (!metas) continue;
  const counts = metas.map((m) => m?.metaV3?.key_state?.length ?? 0);
  console.log(`  ${convId}: [${counts.join(', ')}] (per compaction)`);
}

// Feedback loop fired
console.log('\n=== Feedback loop firings ===');
for (const [convId, kData] of Object.entries(merged.kasett)) {
  const fbLog = kData.feedbackLog ?? [];
  const fired = fbLog.filter((e) => e.fired && e.prevCount > 0).length;
  const expected = fbLog.filter((e) => e.prevCount > 0).length;
  console.log(`  ${convId}: ${fired}/${expected} fired (prev > 0)`);
}

// Save analysis
const analysis = {
  totals: {
    n: allProbes.length,
    vanilla: { correct: vTotal, rate: vTotal / allProbes.length },
    kasett: { correct: kTotal, rate: kTotal / allProbes.length },
  },
  byDepth,
  byType,
  mcnemar: { bothRight, bothWrong, kRightVWrong, vRightKWrong, pOneTailed: pValue, pTwoTailed },
  cohenH: overallH,
  threadCarryover: { count: totalThreadCarryovers, total: totalThreadsAtN, rate: totalThreadCarryovers / totalThreadsAtN },
};

writeFileSync(`${root}/analysis.json`, JSON.stringify(analysis, null, 2));
console.log('\nSaved: results.json + analysis.json');
