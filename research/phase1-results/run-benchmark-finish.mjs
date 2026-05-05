/**
 * Finish benchmark: run session-10 only and compute final aggregates.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const testConfig = JSON.parse(
  readFileSync('/home/node/.openclaw/workspace/repos/moltaimux/test-env/test-config-live.json', 'utf8')
);
const API_KEY = testConfig.models.providers.openrouter.apiKey;
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4-6';

const { buildSteeringPrompt, analyzeThreads, parseCompactionOutput } = await import(
  join(REPO_ROOT, 'dist', 'index.js')
);

const FIXTURES_DIR = join(__dirname, 'fixtures');
const RAW_OUTPUTS_DIR = join(__dirname, 'raw-outputs');
const RESULTS_PATH = join(__dirname, 'results.json');
const SUMMARY_PATH = join(__dirname, 'summary.md');
const PROGRESS_PATH = join(__dirname, 'progress.md');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function updateProgress(msg) {
  const now = new Date().toISOString();
  const existing = readFileSync(PROGRESS_PATH, 'utf8');
  writeFileSync(PROGRESS_PATH, existing + `\n[${now}] ${msg}`);
  console.log(`[${now}] ${msg}`);
}

async function callLLM(messages, systemPrompt = null) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: allMessages, temperature: 0, max_tokens: 4096 }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t.slice(0, 500)}`); }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callLLMWithRetry(messages, systemPrompt = null) {
  try { return await callLLM(messages, systemPrompt); }
  catch (err) {
    console.warn(`Retry: ${err.message}`);
    await sleep(5000);
    return await callLLM(messages, systemPrompt);
  }
}

function buildConversationText(messages) {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
}

function calculateTRR(threads, output) {
  if (threads.length === 0) return 1.0;
  const lowerOutput = output.toLowerCase();
  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'they', 'their', 'what', 'when', 'which', 'into', 'also', 'some', 'more', 'than', 'then']);
  let hits = 0;
  for (const thread of threads) {
    const keywords = thread.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));
    if (keywords.length === 0) { hits++; continue; }
    const keywordHits = keywords.filter((kw) => lowerOutput.includes(kw)).length;
    if (keywordHits / keywords.length >= 0.6) hits++;
  }
  return hits / threads.length;
}

function calculateKSSR(keyState, output) {
  const values = Object.values(keyState);
  if (values.length === 0) return 1.0;
  let hits = 0;
  for (const val of values) { if (output.includes(val)) hits++; }
  return hits / values.length;
}

function cohensD(group1, group2) {
  const mean1 = group1.reduce((a, b) => a + b, 0) / group1.length;
  const mean2 = group2.reduce((a, b) => a + b, 0) / group2.length;
  const var1 = group1.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / (group1.length - 1);
  const var2 = group2.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / (group2.length - 1);
  const pooledSD = Math.sqrt((var1 + var2) / 2);
  if (pooledSD === 0) return 0;
  return (mean2 - mean1) / pooledSD;
}

function interpretEffect(d) {
  const abs = Math.abs(d);
  if (abs >= 0.8) return 'Large';
  if (abs >= 0.5) return 'Medium';
  if (abs >= 0.2) return 'Small';
  return 'Negligible';
}

// Load partial results
const partialData = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
const results = partialData.results;
console.log(`Loaded ${results.length} partial results`);

// Load session-10 fixture
const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, 'session-10.json'), 'utf8'));
console.log(`\n=== Processing ${fixture.id} (Tier ${fixture.tier}) ===`);
updateProgress(`Running fixture ${fixture.id}`);

const conversationText = buildConversationText(fixture.messages);

// Vanilla
console.log(`  [${fixture.id}] Running vanilla...`);
const vanillaSystemPrompt = `You are a helpful assistant that summarizes conversations for context continuity. 
Produce a clear, comprehensive summary that captures the key decisions, state, technical details, and ongoing work from this conversation.
Include specific values, paths, URLs, and version numbers that were discussed.`;
const vanillaOutput = await callLLMWithRetry(
  [{ role: 'user', content: `Please summarize the following conversation for context continuity:\n\n${conversationText}` }],
  vanillaSystemPrompt
);
writeFileSync(join(RAW_OUTPUTS_DIR, `${fixture.id}-vanilla.txt`), vanillaOutput);
const vanillaTRR = calculateTRR(fixture.threads, vanillaOutput);
const vanillaKSSR = calculateKSSR(fixture.keyState, vanillaOutput);
console.log(`  [${fixture.id}] Vanilla TRR=${vanillaTRR.toFixed(3)} KSSR=${vanillaKSSR.toFixed(3)}`);

// Wait between calls
await sleep(3000);

// Kasett
console.log(`  [${fixture.id}] Running kasett...`);
const analysis = analyzeThreads([], []);
const kasettSteering = buildSteeringPrompt(analysis, []);
const kasettSystemPrompt = `You are a helpful assistant that summarizes conversations for context continuity.\n${kasettSteering}`;
const kasettRawOutput = await callLLMWithRetry(
  [{ role: 'user', content: `Please summarize the following conversation for context continuity:\n\n${conversationText}` }],
  kasettSystemPrompt
);
writeFileSync(join(RAW_OUTPUTS_DIR, `${fixture.id}-kasett.txt`), kasettRawOutput);
const { meta: kasettMeta } = parseCompactionOutput(kasettRawOutput);
const kasettTRR = calculateTRR(fixture.threads, kasettRawOutput);
const kasettKSSR = calculateKSSR(fixture.keyState, kasettRawOutput);
console.log(`  [${fixture.id}] Kasett TRR=${kasettTRR.toFixed(3)} KSSR=${kasettKSSR.toFixed(3)} (meta_parsed=${kasettMeta !== null})`);

results.push({
  id: fixture.id,
  tier: fixture.tier,
  thread_count: fixture.threads.length,
  key_state_count: Object.keys(fixture.keyState).length,
  vanilla: { trr: vanillaTRR, kssr: vanillaKSSR },
  kasett: { trr: kasettTRR, kssr: kasettKSSR, meta_parsed: kasettMeta !== null },
});

// Compute aggregates
const vanillaTRRs = results.map((r) => r.vanilla.trr);
const kasettTRRs = results.map((r) => r.kasett.trr);
const vanillaKSSRs = results.map((r) => r.vanilla.kssr);
const kasettKSSRs = results.map((r) => r.kasett.kssr);

const meanVanillaTRR = vanillaTRRs.reduce((a, b) => a + b, 0) / vanillaTRRs.length;
const meanKasettTRR = kasettTRRs.reduce((a, b) => a + b, 0) / kasettTRRs.length;
const meanVanillaKSSR = vanillaKSSRs.reduce((a, b) => a + b, 0) / vanillaKSSRs.length;
const meanKasettKSSR = kasettKSSRs.reduce((a, b) => a + b, 0) / kasettKSSRs.length;

const dTRR = cohensD(vanillaTRRs, kasettTRRs);
const dKSSR = cohensD(vanillaKSSRs, kasettKSSRs);

const finalResults = {
  partial: false,
  meta: { model: MODEL, fixture_count: results.length, timestamp: new Date().toISOString(), temperature: 0 },
  aggregate: {
    ttr: { vanilla: meanVanillaTRR, kasett: meanKasettTRR, cohens_d: dTRR },
    kssr: { vanilla: meanVanillaKSSR, kasett: meanKasettKSSR, cohens_d: dKSSR },
  },
  per_session: results,
};

writeFileSync(RESULTS_PATH, JSON.stringify(finalResults, null, 2));
updateProgress('Step 5: Final results.json written');

// Summary.md
const summaryLines = [];
summaryLines.push('# Phase 1 Benchmark Results');
summaryLines.push('');
summaryLines.push(`**Model:** ${MODEL}`);
summaryLines.push(`**Sessions:** ${results.length}`);
summaryLines.push(`**Timestamp:** ${finalResults.meta.timestamp}`);
summaryLines.push('');
summaryLines.push('## Aggregate Results');
summaryLines.push('');
summaryLines.push('| Metric | Vanilla | Kasett | Cohen\'s d | Interpretation |');
summaryLines.push('|--------|---------|--------|-----------|----------------|');
summaryLines.push(`| TRR (Thread Retention Rate) | ${meanVanillaTRR.toFixed(3)} | ${meanKasettTRR.toFixed(3)} | ${dTRR.toFixed(3)} | ${interpretEffect(dTRR)} |`);
summaryLines.push(`| KSSR (Key State Survival) | ${meanVanillaKSSR.toFixed(3)} | ${meanKasettKSSR.toFixed(3)} | ${dKSSR.toFixed(3)} | ${interpretEffect(dKSSR)} |`);
summaryLines.push('');
summaryLines.push('## Per-Session Results');
summaryLines.push('');
summaryLines.push('| Session | Tier | Threads | Keys | V-TRR | K-TRR | V-KSSR | K-KSSR | Meta? |');
summaryLines.push('|---------|------|---------|------|-------|-------|--------|--------|-------|');
for (const r of results) {
  summaryLines.push(`| ${r.id} | ${r.tier} | ${r.thread_count} | ${r.key_state_count} | ${r.vanilla.trr.toFixed(2)} | ${r.kasett.trr.toFixed(2)} | ${r.vanilla.kssr.toFixed(2)} | ${r.kasett.kssr.toFixed(2)} | ${r.kasett.meta_parsed ? '✓' : '✗'} |`);
}
summaryLines.push('');
summaryLines.push('## Interpretation');
summaryLines.push('');
if (dTRR >= 0.8) summaryLines.push('**TRR:** Large effect — kasett steering significantly improves thread retention across compaction boundaries.');
else if (dTRR >= 0.5) summaryLines.push('**TRR:** Medium effect — kasett steering moderately improves thread retention.');
else if (dTRR >= 0.2) summaryLines.push('**TRR:** Small effect — some improvement in thread retention.');
else summaryLines.push('**TRR:** Negligible effect — minimal difference in thread retention between conditions.');
summaryLines.push('');
if (dKSSR >= 0.8) summaryLines.push('**KSSR:** Large effect — kasett steering significantly improves survival of specific key state values.');
else if (dKSSR >= 0.5) summaryLines.push('**KSSR:** Medium effect — kasett steering moderately improves key state survival.');
else if (dKSSR >= 0.2) summaryLines.push('**KSSR:** Small effect — some improvement in key state survival.');
else summaryLines.push('**KSSR:** Negligible effect — minimal difference in key state survival between conditions.');
summaryLines.push('');
summaryLines.push('## Notes');
summaryLines.push('');
summaryLines.push('- This is Phase 1 (first compaction, no prior thread metas). Kasett advantage should grow in Phase 2 (multi-compaction sessions with prior meta feedback).');
summaryLines.push('- TRR uses keyword matching (60% threshold). KSSR requires exact string match.');
summaryLines.push(`- All raw outputs preserved in research/phase1-results/raw-outputs/`);
summaryLines.push(`- session-01 kasett TRR=0.000 anomaly: the [THREAD_META] block truncated the narrative summary such that thread keywords appear only in the meta block. Scoring against the full raw output in Phase 2 will address this.`);

writeFileSync(SUMMARY_PATH, summaryLines.join('\n'));
updateProgress('Step 5: summary.md written');

console.log('\n=== FINAL RESULTS ===');
console.log(`TRR:  vanilla=${meanVanillaTRR.toFixed(3)} kasett=${meanKasettTRR.toFixed(3)} d=${dTRR.toFixed(3)}`);
console.log(`KSSR: vanilla=${meanVanillaKSSR.toFixed(3)} kasett=${meanKasettKSSR.toFixed(3)} d=${dKSSR.toFixed(3)}`);
