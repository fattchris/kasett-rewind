import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = 'research/phase1-results/fixtures';
const outputsDir = 'research/phase1-results/raw-outputs';

const results = [];

for (let i = 1; i <= 10; i++) {
  const id = `session-${String(i).padStart(2, '0')}`;
  const fixture = JSON.parse(readFileSync(join(fixturesDir, `${id}.json`), 'utf8'));
  
  const vanillaOutput = readFileSync(join(outputsDir, `${id}-vanilla.txt`), 'utf8');
  const kasettOutput = readFileSync(join(outputsDir, `${id}-kasett.txt`), 'utf8');
  
  // TRR: Thread Retention Rate
  // Check if thread keywords appear in output (case-insensitive)
  const threads = fixture.threads;
  
  function countRetainedThreads(output, threadList) {
    let retained = 0;
    for (const thread of threadList) {
      // Extract key words from thread description (3+ char words)
      const keywords = thread.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
      // Thread counts as retained if 2+ keywords appear in output
      const matches = keywords.filter(kw => output.toLowerCase().includes(kw));
      if (matches.length >= 2 || (keywords.length <= 2 && matches.length >= 1)) {
        retained++;
      }
    }
    return retained;
  }
  
  const vanillaThreadsRetained = countRetainedThreads(vanillaOutput, threads);
  const kasettThreadsRetained = countRetainedThreads(kasettOutput, threads);
  const vanillaTRR = threads.length > 0 ? vanillaThreadsRetained / threads.length : 0;
  const kasettTRR = threads.length > 0 ? kasettThreadsRetained / threads.length : 0;
  
  // KSSR: Key State Survival Rate
  // Check exact string presence
  const keyValues = Object.values(fixture.keyState);
  
  function countSurvivedValues(output, values) {
    let survived = 0;
    for (const val of values) {
      if (output.includes(val)) survived++;
    }
    return survived;
  }
  
  const vanillaValuesSurvived = countSurvivedValues(vanillaOutput, keyValues);
  const kasettValuesSurvived = countSurvivedValues(kasettOutput, keyValues);
  const vanillaKSSR = keyValues.length > 0 ? vanillaValuesSurvived / keyValues.length : 0;
  const kasettKSSR = keyValues.length > 0 ? kasettValuesSurvived / keyValues.length : 0;
  
  results.push({
    id,
    tier: fixture.tier,
    threadCount: threads.length,
    keyStateCount: keyValues.length,
    vanilla: { TRR: vanillaTRR, KSSR: vanillaKSSR, threadsRetained: vanillaThreadsRetained, valuesRetained: vanillaValuesSurvived },
    kasett: { TRR: kasettTRR, KSSR: kasettKSSR, threadsRetained: kasettThreadsRetained, valuesRetained: kasettValuesSurvived }
  });
}

// Calculate averages
const avgVanillaTRR = results.reduce((s, r) => s + r.vanilla.TRR, 0) / results.length;
const avgKasettTRR = results.reduce((s, r) => s + r.kasett.TRR, 0) / results.length;
const avgVanillaKSSR = results.reduce((s, r) => s + r.vanilla.KSSR, 0) / results.length;
const avgKasettKSSR = results.reduce((s, r) => s + r.kasett.KSSR, 0) / results.length;

// Cohen's d
function cohensD(group1, group2) {
  const n1 = group1.length, n2 = group2.length;
  const mean1 = group1.reduce((s, v) => s + v, 0) / n1;
  const mean2 = group2.reduce((s, v) => s + v, 0) / n2;
  const var1 = group1.reduce((s, v) => s + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2 = group2.reduce((s, v) => s + (v - mean2) ** 2, 0) / (n2 - 1);
  const pooledSD = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
  if (pooledSD === 0) return 0;
  return (mean2 - mean1) / pooledSD;
}

const trrD = cohensD(results.map(r => r.vanilla.TRR), results.map(r => r.kasett.TRR));
const kssrD = cohensD(results.map(r => r.vanilla.KSSR), results.map(r => r.kasett.KSSR));

// Per-tier averages
const tiers = [1, 2, 3];
const tierResults = {};
for (const t of tiers) {
  const tierData = results.filter(r => r.tier === t);
  tierResults[t] = {
    vanillaTRR: tierData.reduce((s, r) => s + r.vanilla.TRR, 0) / tierData.length,
    kasettTRR: tierData.reduce((s, r) => s + r.kasett.TRR, 0) / tierData.length,
    vanillaKSSR: tierData.reduce((s, r) => s + r.vanilla.KSSR, 0) / tierData.length,
    kasettKSSR: tierData.reduce((s, r) => s + r.kasett.KSSR, 0) / tierData.length,
  };
}

// Write results.json
const fullResults = {
  timestamp: new Date().toISOString(),
  model: 'anthropic/claude-sonnet-4-6',
  temperature: 0,
  sessions: results,
  summary: {
    overall: { vanillaTRR: avgVanillaTRR, kasettTRR: avgKasettTRR, vanillaKSSR: avgVanillaKSSR, kasettKSSR: avgKasettKSSR },
    effectSizes: { TRR_cohens_d: trrD, KSSR_cohens_d: kssrD },
    byTier: tierResults
  }
};
writeFileSync('research/phase1-results/results.json', JSON.stringify(fullResults, null, 2));

// Write summary.md
let md = `# Phase 1 Benchmark Results

## Overview

**Model:** anthropic/claude-sonnet-4-6 (temperature=0)
**Conditions:** Vanilla compaction vs. Kasett-steered compaction
**Sessions:** 10 (3 × Tier 1, 4 × Tier 2, 3 × Tier 3)
**Date:** ${new Date().toISOString().split('T')[0]}

## Results

### Per-Session

| Session | Tier | Threads | Keys | Vanilla TRR | Kasett TRR | Vanilla KSSR | Kasett KSSR |
|---------|------|---------|------|-------------|------------|--------------|-------------|
`;

for (const r of results) {
  md += `| ${r.id} | ${r.tier} | ${r.threadCount} | ${r.keyStateCount} | ${r.vanilla.TRR.toFixed(2)} | ${r.kasett.TRR.toFixed(2)} | ${r.vanilla.KSSR.toFixed(2)} | ${r.kasett.KSSR.toFixed(2)} |\n`;
}

md += `
### Averages by Tier

| Tier | Vanilla TRR | Kasett TRR | Δ TRR | Vanilla KSSR | Kasett KSSR | Δ KSSR |
|------|-------------|------------|-------|--------------|-------------|--------|
`;

for (const t of tiers) {
  const tr = tierResults[t];
  md += `| ${t} | ${tr.vanillaTRR.toFixed(2)} | ${tr.kasettTRR.toFixed(2)} | ${(tr.kasettTRR - tr.vanillaTRR >= 0 ? '+' : '')}${(tr.kasettTRR - tr.vanillaTRR).toFixed(2)} | ${tr.vanillaKSSR.toFixed(2)} | ${tr.kasettKSSR.toFixed(2)} | ${(tr.kasettKSSR - tr.vanillaKSSR >= 0 ? '+' : '')}${(tr.kasettKSSR - tr.vanillaKSSR).toFixed(2)} |\n`;
}

md += `
### Overall

| Metric | Vanilla | Kasett | Δ | Cohen's d | Interpretation |
|--------|---------|--------|---|-----------|----------------|
| TRR | ${avgVanillaTRR.toFixed(3)} | ${avgKasettTRR.toFixed(3)} | ${(avgKasettTRR - avgVanillaTRR >= 0 ? '+' : '')}${(avgKasettTRR - avgVanillaTRR).toFixed(3)} | ${trrD.toFixed(2)} | ${Math.abs(trrD) < 0.2 ? 'negligible' : Math.abs(trrD) < 0.5 ? 'small' : Math.abs(trrD) < 0.8 ? 'medium' : 'large'} |
| KSSR | ${avgVanillaKSSR.toFixed(3)} | ${avgKasettKSSR.toFixed(3)} | ${(avgKasettKSSR - avgVanillaKSSR >= 0 ? '+' : '')}${(avgKasettKSSR - avgVanillaKSSR).toFixed(3)} | ${kssrD.toFixed(2)} | ${Math.abs(kssrD) < 0.2 ? 'negligible' : Math.abs(kssrD) < 0.5 ? 'small' : Math.abs(kssrD) < 0.8 ? 'medium' : 'large'} |

## Interpretation

TRR (Thread Retention Rate): Higher = more threads survived compaction.
KSSR (Key State Survival Rate): Higher = more specific values (URLs, paths, versions) survived verbatim.
Cohen's d: Effect size. |d| < 0.2 = negligible, 0.2-0.5 = small, 0.5-0.8 = medium, > 0.8 = large.

---
*Generated ${new Date().toISOString()} by kasett-rewind Phase 1 benchmark harness.*
`;

writeFileSync('research/phase1-results/summary.md', md);

console.log('=== RESULTS ===');
console.log(`Vanilla TRR: ${avgVanillaTRR.toFixed(3)} | Kasett TRR: ${avgKasettTRR.toFixed(3)} | d=${trrD.toFixed(2)}`);
console.log(`Vanilla KSSR: ${avgVanillaKSSR.toFixed(3)} | Kasett KSSR: ${avgKasettKSSR.toFixed(3)} | d=${kssrD.toFixed(2)}`);
console.log('\nPer tier:');
for (const t of tiers) {
  const tr = tierResults[t];
  console.log(`  Tier ${t}: TRR ${tr.vanillaTRR.toFixed(2)}→${tr.kasettTRR.toFixed(2)} | KSSR ${tr.vanillaKSSR.toFixed(2)}→${tr.kasettKSSR.toFixed(2)}`);
}
