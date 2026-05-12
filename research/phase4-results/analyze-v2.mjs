/**
 * Phase G — Analyze v2 results and compare against Phase 4 baseline.
 *
 * Reads the three per-conversation v2 results files, computes Recall@1 by
 * depth and probe type, and prints a side-by-side delta against Phase 4.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const root = '/home/node/.openclaw/workspace/research/phase4-results';

// v2 (Phase G — fixed plugin code)
const e2 = JSON.parse(readFileSync(`${root}/results-v2-conv-eks-migration.json`, 'utf-8'));
const a2 = JSON.parse(readFileSync(`${root}/results-v2-conv-auth-launch.json`, 'utf-8'));
const d2 = JSON.parse(readFileSync(`${root}/results-v2-conv-data-pipeline.json`, 'utf-8'));

const merged = {
  config: e2.config,
  timestamp: new Date().toISOString(),
  vanilla: { ...e2.vanilla, ...a2.vanilla, ...d2.vanilla },
  kasett: { ...e2.kasett, ...a2.kasett, ...d2.kasett },
  probes: { ...e2.probes, ...a2.probes, ...d2.probes },
};
writeFileSync(`${root}/results-v2.json`, JSON.stringify(merged, null, 2));

// Phase 4 baseline (already merged)
const baseline = JSON.parse(readFileSync(`${root}/results.json`, 'utf-8'));

const score = (v) => (v === 'CORRECT' ? 1 : v === 'PARTIAL' ? 0.5 : 0);

function flattenProbes(merged) {
  const all = [];
  for (const [convId, probes] of Object.entries(merged.probes)) {
    for (const p of probes) {
      all.push({
        convId,
        probeId: p.probeId,
        depth: p.depth,
        type: p.type,
        vScore: score(p.vanilla.verdict),
        kScore: score(p.kasett.verdict),
        vVerdict: p.vanilla.verdict,
        kVerdict: p.kasett.verdict,
      });
    }
  }
  return all;
}

const v2Probes = flattenProbes(merged);
const baseProbes = flattenProbes(baseline);

console.log(`v2 probes: ${v2Probes.length} | baseline probes: ${baseProbes.length}`);

const depths = ['current', 3, 2, 1];

function recallByDepth(probes, key) {
  const out = {};
  for (const dep of depths) {
    const subset = probes.filter((p) => String(p.depth) === String(dep));
    const sum = subset.reduce((a, p) => a + p[key], 0);
    out[dep] = { n: subset.length, correct: sum, rate: subset.length ? sum / subset.length : 0 };
  }
  const all = probes;
  const sumAll = all.reduce((a, p) => a + p[key], 0);
  out.overall = { n: all.length, correct: sumAll, rate: all.length ? sumAll / all.length : 0 };
  return out;
}

const v2K = recallByDepth(v2Probes, 'kScore');
const v2V = recallByDepth(v2Probes, 'vScore');
const baseK = recallByDepth(baseProbes, 'kScore');
const baseV = recallByDepth(baseProbes, 'vScore');

console.log('\n=== Recall@1 by depth ===');
console.log('Depth     | N  | Phase4 V    | Phase4 K    | PhaseG V    | PhaseG K    | dK (G-4)');
for (const dep of [...depths, 'overall']) {
  const r4V = baseV[dep];
  const r4K = baseK[dep];
  const rGV = v2V[dep];
  const rGK = v2K[dep];
  const dK = (rGK.rate - r4K.rate) * 100;
  console.log(
    `${String(dep).padEnd(9)} | ${String(rGV.n).padStart(2)} | ` +
    `${(r4V.rate * 100).toFixed(1).padStart(4)}% (${r4V.correct}/${r4V.n}) | ` +
    `${(r4K.rate * 100).toFixed(1).padStart(4)}% (${r4K.correct}/${r4K.n}) | ` +
    `${(rGV.rate * 100).toFixed(1).padStart(4)}% (${rGV.correct}/${rGV.n}) | ` +
    `${(rGK.rate * 100).toFixed(1).padStart(4)}% (${rGK.correct}/${rGK.n}) | ` +
    `${dK >= 0 ? '+' : ''}${dK.toFixed(1)}pp`,
  );
}

const types = ['long-range-recall', 'decision-continuity', 'trajectory', 'thread-lineage'];
function recallByType(probes, key) {
  const out = {};
  for (const t of types) {
    const subset = probes.filter((p) => p.type === t);
    const sum = subset.reduce((a, p) => a + p[key], 0);
    out[t] = { n: subset.length, correct: sum, rate: subset.length ? sum / subset.length : 0 };
  }
  return out;
}

console.log('\n=== Recall@1 by probe type (Kasett only) ===');
const baseKT = recallByType(baseProbes, 'kScore');
const v2KT = recallByType(v2Probes, 'kScore');
console.log('Type                  | N  | Phase4      | PhaseG      | Delta');
for (const t of types) {
  const r4 = baseKT[t];
  const rG = v2KT[t];
  const d = (rG.rate - r4.rate) * 100;
  console.log(
    `${t.padEnd(22)}| ${String(rG.n).padStart(2)} | ${(r4.rate * 100).toFixed(0).padStart(3)}% (${r4.correct}/${r4.n}) | ${(rG.rate * 100).toFixed(0).padStart(3)}% (${rG.correct}/${rG.n}) | ${d >= 0 ? '+' : ''}${d.toFixed(1)}pp`,
  );
}

// McNemar (Kasett vs Vanilla within v2)
function mcnemar(probes) {
  let bothC = 0, kOnly = 0, vOnly = 0, bothW = 0;
  for (const p of probes) {
    const v = p.vScore >= 1;
    const k = p.kScore >= 1;
    if (v && k) bothC++;
    else if (k && !v) kOnly++;
    else if (v && !k) vOnly++;
    else bothW++;
  }
  // Exact one-tailed sign test on b vs c (Pr[X >= max(b,c) | n=b+c, p=0.5])
  const n = kOnly + vOnly;
  function binomP(k, n) {
    let p = 0;
    let pmf0 = Math.pow(0.5, n);
    let coeff = 1;
    for (let i = 0; i <= n; i++) {
      const pmfi = pmf0 * coeff;
      if (i >= k) p += pmfi;
      coeff = coeff * (n - i) / (i + 1);
    }
    return p;
  }
  const oneTailed = n > 0 ? binomP(Math.max(kOnly, vOnly), n) : 1;
  return { bothC, kOnly, vOnly, bothW, n, oneTailed, twoTailed: Math.min(1, oneTailed * 2) };
}

const mc = mcnemar(v2Probes);
console.log(`\n=== McNemar (Phase G) ===`);
console.log(`bothCorrect: ${mc.bothC}  kasettOnly: ${mc.kOnly}  vanillaOnly: ${mc.vOnly}  bothWrong: ${mc.bothW}`);
console.log(`one-tailed p ≈ ${mc.oneTailed.toFixed(4)} | two-tailed p ≈ ${mc.twoTailed.toFixed(4)}`);

// Mechanism stats from feedbackLog
console.log('\n=== Mechanism evidence (Phase G) ===');
let totalCore = 0, totalLifecycle = 0, totalKeyState = 0, totalSubs = 0, transitions = 0;
for (const [convId, kdata] of Object.entries(merged.kasett)) {
  for (const f of kdata.feedbackLog ?? []) {
    if (f.depth >= 2) {
      transitions++;
      totalCore += f.coreSubIds?.length ?? 0;
      totalLifecycle += f.recentLifecycleCount ?? 0;
    }
    totalKeyState += f.keyStateCount ?? 0;
    totalSubs += f.subCount ?? 0;
  }
}
console.log(`Avg core sub IDs / transition (depth>=2): ${(totalCore / Math.max(1, transitions)).toFixed(2)}`);
console.log(`Avg lifecycle events surfaced / transition (depth>=2): ${(totalLifecycle / Math.max(1, transitions)).toFixed(2)}`);
console.log(`Total key_state entries across all compactions: ${totalKeyState}`);
console.log(`Total sub-thread entries across all compactions: ${totalSubs}`);

// Save analysis
writeFileSync(`${root}/analysis-v2.json`, JSON.stringify({
  config: merged.config,
  byDepth: { v2K, v2V, baseK, baseV },
  byType: { v2KT, baseKT },
  mcnemar: mc,
  mechanism: { totalCore, totalLifecycle, totalKeyState, totalSubs, transitions },
}, null, 2));

console.log(`\nFull analysis saved: ${root}/analysis-v2.json`);
