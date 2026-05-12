/**
 * Phase 2 Benchmark v2: Vanilla vs. Real Kasett Plugin Stack
 *
 * Differences from Phase 1 (May 5, null result):
 *  - Uses ACTUAL kasett exports (parseCompactionOutputV3, buildSteeringPrompt
 *    with V3 mode, detectCandidateKeyState).
 *  - Adds Tier 4 high-complexity sessions (80-150 turns, 15-30 key state values).
 *  - Tracks compliance (PARSE_OK / PARSE_REPAIRED / PARSE_FALLBACK / PARSE_NONE).
 *  - Adds Structure Yield metric (Kasett-only — vanilla SY is always 0).
 *  - Pinned to claude-sonnet-4-5 (production model), max_tokens=32000.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ---- Config ----
const testConfig = JSON.parse(
  readFileSync('/home/node/.openclaw/workspace/repos/moltaimux/test-env/test-config-live.json', 'utf8')
);
const API_KEY = testConfig.models.providers.openrouter.apiKey;
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4-5';
const MAX_TOKENS = 32000;
const TEMPERATURE = 0;
const CALL_DELAY_MS = 2000;

// ---- Imports from real plugin stack ----
const { parseCompactionOutputV3 } = await import(join(REPO_ROOT, 'dist', 'threads', 'parser.js'));
const { buildSteeringPrompt } = await import(join(REPO_ROOT, 'dist', 'threads', 'steering.js'));
const { detectCandidateKeyState } = await import(join(REPO_ROOT, 'dist', 'keystate', 'detector.js'));

// ---- Paths ----
const FIXTURES_DIR = join(__dirname, 'fixtures');
const RAW_OUTPUTS_DIR = join(__dirname, 'raw-outputs');
const RESULTS_PATH = join(__dirname, 'results.json');
const SUMMARY_PATH = join(__dirname, 'summary.md');
const COMPLIANCE_PATH = join(__dirname, 'compliance-report.md');
const PROGRESS_PATH = join(__dirname, 'progress.md');

if (!existsSync(RAW_OUTPUTS_DIR)) mkdirSync(RAW_OUTPUTS_DIR, { recursive: true });

function progress(msg) {
  const now = new Date().toISOString();
  const line = `[${now}] ${msg}\n`;
  appendFileSync(PROGRESS_PATH, line);
  console.log(line.trim());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- LLM call ----
async function callLLM(messages, systemPrompt = null) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;
  const body = {
    model: MODEL,
    messages: allMessages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  };
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callLLMWithRetry(messages, systemPrompt) {
  try {
    return await callLLM(messages, systemPrompt);
  } catch (err) {
    console.warn(`Retry after error: ${err.message}`);
    await sleep(5000);
    try {
      return await callLLM(messages, systemPrompt);
    } catch (err2) {
      console.error(`Second failure: ${err2.message}`);
      return '';
    }
  }
}

// ---- Helpers ----
function buildConversationText(messages) {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
}

function calculateTRR_text(threads, output) {
  if (!threads || threads.length === 0) return 1.0;
  const lower = output.toLowerCase();
  let hits = 0;
  const stopWords = new Set([
    'this','that','with','from','have','will','been','were','they','their','what','when','which','into','also','some','more','than','then',
  ]);
  for (const t of threads) {
    const kws = String(t).toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));
    if (kws.length === 0) { hits++; continue; }
    const kwHits = kws.filter((k) => lower.includes(k)).length;
    if (kwHits / kws.length >= 0.6) hits++;
  }
  return hits / threads.length;
}

function calculateTRR_structured(threads, meta, fallbackText) {
  // Score against the union of: main, all sub labels, decisions, open_questions,
  // and the prose summary. This matches how the structure is actually consumed
  // by the next session — the agent reads main + sub + summary together.
  if (!threads || threads.length === 0) return 1.0;
  const main = String(meta?.main || '').toLowerCase();
  const labels = (meta?.sub || []).map((s) => String(s.label || '')).join(' ').toLowerCase();
  const decisions = (meta?.decisions || []).join(' ').toLowerCase();
  const oqs = (meta?.open_questions || []).join(' ').toLowerCase();
  const ksLabels = (meta?.key_state || []).map((e) => `${e.label || ''} ${e.context || ''}`).join(' ').toLowerCase();
  const corpus = [main, labels, decisions, oqs, ksLabels, (fallbackText || '').toLowerCase()].join(' ');
  const stopWords = new Set(['this','that','with','from','have','will','been','were','they','their','what','when','which','into','also','some','more','than','then']);
  let hits = 0;
  for (const t of threads) {
    const tTokens = String(t).toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));
    if (tTokens.length === 0) { hits++; continue; }
    const overlap = tTokens.filter((k) => corpus.includes(k)).length;
    if (overlap / tTokens.length >= 0.6) hits++;
  }
  return hits / threads.length;
}

function calculateKSSR_text(keyState, output) {
  const values = Object.values(keyState || {});
  if (values.length === 0) return 1.0;
  let hits = 0;
  for (const v of values) {
    if (output.includes(v)) hits++;
  }
  return hits / values.length;
}

function calculateKSSR_structured(keyState, ksArr, fallbackText) {
  const values = Object.values(keyState || {});
  if (values.length === 0) return 1.0;
  const ksValues = (ksArr || []).map((e) => String(e.value || ''));
  let hits = 0;
  for (const v of values) {
    if (ksValues.includes(v)) {
      hits++;
      continue;
    }
    // Fallback: also count if value appears in the prose summary
    if (fallbackText && fallbackText.includes(v)) hits++;
  }
  return hits / values.length;
}

function cohensD(group1, group2) {
  if (group1.length < 2 || group2.length < 2) return 0;
  const mean1 = group1.reduce((a, b) => a + b, 0) / group1.length;
  const mean2 = group2.reduce((a, b) => a + b, 0) / group2.length;
  const var1 = group1.reduce((a, b) => a + (b - mean1) ** 2, 0) / (group1.length - 1);
  const var2 = group2.reduce((a, b) => a + (b - mean2) ** 2, 0) / (group2.length - 1);
  const pooledSD = Math.sqrt((var1 + var2) / 2);
  if (pooledSD === 0) return 0;
  return (mean2 - mean1) / pooledSD;
}

function interpretEffect(d) {
  const a = Math.abs(d);
  if (a >= 0.8) return 'Large';
  if (a >= 0.5) return 'Medium';
  if (a >= 0.2) return 'Small';
  return 'Negligible';
}

// ---- Load fixtures ----
function loadFixtures() {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')));
}

// ---- Main ----
async function runBenchmark() {
  progress('Loading fixtures');
  const fixtures = loadFixtures();
  progress(`Loaded ${fixtures.length} fixtures`);

  const results = [];

  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i];
    progress(`[${i + 1}/${fixtures.length}] Processing ${fx.id} (Tier ${fx.tier}, ${fx.messages.length} turns, ${fx.threads.length} threads, ${Object.keys(fx.keyState).length} key state)`);

    const conversationText = buildConversationText(fx.messages);

    // ===== VANILLA =====
    const vanillaSystem = `You are a helpful assistant that summarizes conversations for context continuity.
Produce a clear, comprehensive summary that captures the key decisions, state, technical details, and ongoing work from this conversation.
Include specific values, paths, URLs, and version numbers that were discussed.`;
    const vanillaUser = [{ role: 'user', content: `Please summarize the following conversation for context continuity:\n\n${conversationText}` }];

    let vanillaOut = '';
    const tStartV = Date.now();
    try {
      vanillaOut = await callLLMWithRetry(vanillaUser, vanillaSystem);
    } catch (err) {
      console.error(`Vanilla error ${fx.id}: ${err.message}`);
    }
    const vanillaMs = Date.now() - tStartV;
    writeFileSync(join(RAW_OUTPUTS_DIR, `${fx.id}-vanilla.txt`), vanillaOut);

    const vanillaTRR = calculateTRR_text(fx.threads, vanillaOut);
    const vanillaKSSR = calculateKSSR_text(fx.keyState, vanillaOut);
    progress(`  vanilla: TRR=${vanillaTRR.toFixed(3)} KSSR=${vanillaKSSR.toFixed(3)} (${vanillaMs}ms, ${vanillaOut.length} chars)`);

    await sleep(CALL_DELAY_MS);

    // ===== KASETT =====
    // Detect candidate key state from messages
    const candidates = detectCandidateKeyState(fx.messages);

    // Build V3 steering prompt (no previous metas — first compaction)
    const steeringSection = buildSteeringPrompt([], {
      structuredOutput: 'json',
      previousSubIds: [],
      candidateKeyState: candidates,
      previousKeyState: [],
      recentLifecycle: [],
    });

    const kasettSystem = `You are a helpful assistant performing thread-aware compaction for context continuity.

${steeringSection}`;
    const kasettUser = [{ role: 'user', content: `Compaction target — summarize the conversation below per the instructions above:\n\n${conversationText}` }];

    let kasettRaw = '';
    const tStartK = Date.now();
    try {
      kasettRaw = await callLLMWithRetry(kasettUser, kasettSystem);
    } catch (err) {
      console.error(`Kasett error ${fx.id}: ${err.message}`);
    }
    const kasettMs = Date.now() - tStartK;
    writeFileSync(join(RAW_OUTPUTS_DIR, `${fx.id}-kasett.txt`), kasettRaw);

    // Parse with V3
    const parsed = parseCompactionOutputV3(kasettRaw);

    // Compliance status
    let complianceStatus;
    let parsedMeta = null;
    let parsedSY = 0;
    let kasettTRR;
    let kasettKSSR;

    if (parsed.meta) {
      // Either closed-fence success or repaired
      const errStr = (parsed.errors || []).join(';');
      complianceStatus = errStr.includes('open-fence') || errStr.includes('repair') ? 'PARSE_REPAIRED' : 'PARSE_OK';
      parsedMeta = parsed.meta;
      const subs = parsedMeta.sub || [];
      const ks = parsedMeta.key_state || [];
      const decs = parsedMeta.decisions || [];
      const oqs = parsedMeta.open_questions || [];
      parsedSY = subs.length + ks.length + decs.length + oqs.length;
      kasettTRR = calculateTRR_structured(fx.threads, parsedMeta, parsed.summary || kasettRaw);
      kasettKSSR = calculateKSSR_structured(fx.keyState, ks, parsed.summary || kasettRaw);
    } else {
      // No structure recovered — fall back to text scoring on raw output
      complianceStatus = parsed.errors && parsed.errors.length > 0 ? 'PARSE_FALLBACK' : 'PARSE_NONE';
      kasettTRR = calculateTRR_text(fx.threads, kasettRaw);
      kasettKSSR = calculateKSSR_text(fx.keyState, kasettRaw);
    }

    progress(`  kasett: TRR=${kasettTRR.toFixed(3)} KSSR=${kasettKSSR.toFixed(3)} SY=${parsedSY} status=${complianceStatus} (${kasettMs}ms, ${kasettRaw.length} chars)`);

    results.push({
      id: fx.id,
      tier: fx.tier,
      thread_count: fx.threads.length,
      key_state_count: Object.keys(fx.keyState).length,
      message_count: fx.messages.length,
      vanilla: {
        trr: vanillaTRR,
        kssr: vanillaKSSR,
        sy: 0,
        chars: vanillaOut.length,
        ms: vanillaMs,
      },
      kasett: {
        trr: kasettTRR,
        kssr: kasettKSSR,
        sy: parsedSY,
        chars: kasettRaw.length,
        ms: kasettMs,
        compliance: complianceStatus,
        sub_count: parsedMeta?.sub?.length || 0,
        key_state_emitted: parsedMeta?.key_state?.length || 0,
        decisions_count: parsedMeta?.decisions?.length || 0,
        open_questions_count: parsedMeta?.open_questions?.length || 0,
        schema_version: parsedMeta?.schema_version || null,
      },
    });

    // Persist partial after each fixture
    writeFileSync(RESULTS_PATH, JSON.stringify({ partial: true, results }, null, 2));

    if (i < fixtures.length - 1) await sleep(CALL_DELAY_MS);
  }

  // ---- Aggregate ----
  const tierGroup = (t) => results.filter((r) => r.tier === t);
  const tiers = [1, 2, 3, 4];
  const tierStats = {};
  for (const t of tiers) {
    const g = tierGroup(t);
    if (g.length === 0) continue;
    const vTRR = g.map((r) => r.vanilla.trr);
    const kTRR = g.map((r) => r.kasett.trr);
    const vKSSR = g.map((r) => r.vanilla.kssr);
    const kKSSR = g.map((r) => r.kasett.kssr);
    const kSY = g.map((r) => r.kasett.sy);
    tierStats[t] = {
      n: g.length,
      vanilla_trr: mean(vTRR),
      kasett_trr: mean(kTRR),
      d_trr: cohensD(vTRR, kTRR),
      vanilla_kssr: mean(vKSSR),
      kasett_kssr: mean(kKSSR),
      d_kssr: cohensD(vKSSR, kKSSR),
      mean_sy: mean(kSY),
      compliance_rate: g.filter((r) => r.kasett.compliance === 'PARSE_OK' || r.kasett.compliance === 'PARSE_REPAIRED').length / g.length,
    };
  }

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

  const allVTRR = results.map((r) => r.vanilla.trr);
  const allKTRR = results.map((r) => r.kasett.trr);
  const allVKSSR = results.map((r) => r.vanilla.kssr);
  const allKKSSR = results.map((r) => r.kasett.kssr);
  const allKSY = results.map((r) => r.kasett.sy);

  const aggregate = {
    n: results.length,
    vanilla_trr: mean(allVTRR),
    kasett_trr: mean(allKTRR),
    d_trr: cohensD(allVTRR, allKTRR),
    vanilla_kssr: mean(allVKSSR),
    kasett_kssr: mean(allKKSSR),
    d_kssr: cohensD(allVKSSR, allKKSSR),
    mean_sy: mean(allKSY),
    compliance_rate: results.filter((r) => r.kasett.compliance === 'PARSE_OK' || r.kasett.compliance === 'PARSE_REPAIRED').length / results.length,
  };

  const finalResults = {
    partial: false,
    meta: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      fixture_count: fixtures.length,
      timestamp: new Date().toISOString(),
    },
    aggregate,
    by_tier: tierStats,
    per_session: results,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(finalResults, null, 2));
  progress('Wrote results.json');

  // ---- Summary.md ----
  const lines = [];
  lines.push('# Phase 2 Benchmark Results');
  lines.push('');
  lines.push(`**Model:** ${MODEL}`);
  lines.push(`**Sessions:** ${fixtures.length}`);
  lines.push(`**Timestamp:** ${finalResults.meta.timestamp}`);
  lines.push(`**Method:** Real Kasett plugin pipeline (parseCompactionOutputV3, V3 steering, key state detector).`);
  lines.push('');
  lines.push('## Aggregate Results');
  lines.push('');
  lines.push("| Metric | Vanilla | Kasett | Cohen's d | Effect |");
  lines.push('|---|---|---|---|---|');
  lines.push(`| TRR | ${aggregate.vanilla_trr.toFixed(3)} | ${aggregate.kasett_trr.toFixed(3)} | ${aggregate.d_trr.toFixed(3)} | ${interpretEffect(aggregate.d_trr)} |`);
  lines.push(`| KSSR | ${aggregate.vanilla_kssr.toFixed(3)} | ${aggregate.kasett_kssr.toFixed(3)} | ${aggregate.d_kssr.toFixed(3)} | ${interpretEffect(aggregate.d_kssr)} |`);
  lines.push(`| Structure Yield | 0 | ${aggregate.mean_sy.toFixed(2)} | — | (Kasett-only) |`);
  lines.push(`| V3 Compliance Rate | — | ${(aggregate.compliance_rate * 100).toFixed(1)}% | — | — |`);
  lines.push('');
  lines.push('## By Tier');
  lines.push('');
  lines.push('| Tier | n | V-TRR | K-TRR | d | V-KSSR | K-KSSR | d | Mean SY | Compliance |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of tiers) {
    const s = tierStats[t];
    if (!s) continue;
    lines.push(`| ${t} | ${s.n} | ${s.vanilla_trr.toFixed(3)} | ${s.kasett_trr.toFixed(3)} | ${s.d_trr.toFixed(3)} | ${s.vanilla_kssr.toFixed(3)} | ${s.kasett_kssr.toFixed(3)} | ${s.d_kssr.toFixed(3)} | ${s.mean_sy.toFixed(2)} | ${(s.compliance_rate * 100).toFixed(0)}% |`);
  }
  lines.push('');
  lines.push('## Per-Session');
  lines.push('');
  lines.push('| Session | Tier | Threads | Keys | Turns | V-TRR | K-TRR | V-KSSR | K-KSSR | SY | Status |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.tier} | ${r.thread_count} | ${r.key_state_count} | ${r.message_count} | ${r.vanilla.trr.toFixed(2)} | ${r.kasett.trr.toFixed(2)} | ${r.vanilla.kssr.toFixed(2)} | ${r.kasett.kssr.toFixed(2)} | ${r.kasett.sy} | ${r.kasett.compliance} |`);
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push(`- **TRR delta:** ${(aggregate.kasett_trr - aggregate.vanilla_trr >= 0 ? '+' : '')}${(aggregate.kasett_trr - aggregate.vanilla_trr).toFixed(3)} (Cohen's d = ${aggregate.d_trr.toFixed(3)}, ${interpretEffect(aggregate.d_trr)} effect).`);
  lines.push(`- **KSSR delta:** ${(aggregate.kasett_kssr - aggregate.vanilla_kssr >= 0 ? '+' : '')}${(aggregate.kasett_kssr - aggregate.vanilla_kssr).toFixed(3)} (Cohen's d = ${aggregate.d_kssr.toFixed(3)}, ${interpretEffect(aggregate.d_kssr)} effect).`);
  lines.push(`- **Structure Yield:** Mean ${aggregate.mean_sy.toFixed(2)} structured artifacts per Kasett session vs 0 for vanilla. This is the cleanest demonstration of the structured-vs-prose advantage — vanilla cannot produce structured output by construction.`);
  lines.push(`- **V3 compliance rate:** ${(aggregate.compliance_rate * 100).toFixed(1)}% across all 15 sessions.`);
  lines.push('');
  writeFileSync(SUMMARY_PATH, lines.join('\n') + '\n');
  progress('Wrote summary.md');

  // ---- Compliance report ----
  const cr = [];
  cr.push('# Phase 2 Compliance Report');
  cr.push('');
  cr.push(`Model: ${MODEL}, max_tokens=${MAX_TOKENS}, temperature=${TEMPERATURE}`);
  cr.push('');
  cr.push('## V3 Emission Status by Session');
  cr.push('');
  cr.push('| Session | Tier | Status | sub_thread | key_state | decisions | open_questions | SY |');
  cr.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    cr.push(`| ${r.id} | ${r.tier} | ${r.kasett.compliance} | ${r.kasett.sub_count} | ${r.kasett.key_state_emitted} | ${r.kasett.decisions_count} | ${r.kasett.open_questions_count} | ${r.kasett.sy} |`);
  }
  cr.push('');
  cr.push('## Compliance Rate by Tier');
  cr.push('');
  cr.push('| Tier | n | Compliance Rate |');
  cr.push('|---|---|---|');
  for (const t of tiers) {
    const s = tierStats[t];
    if (!s) continue;
    cr.push(`| ${t} | ${s.n} | ${(s.compliance_rate * 100).toFixed(1)}% |`);
  }
  cr.push('');
  cr.push('## Status Legend');
  cr.push('');
  cr.push('- **PARSE_OK** — closed-fence \\`\\`\\`json block parsed and validated cleanly.');
  cr.push('- **PARSE_REPAIRED** — open-fence (truncated) JSON repaired by F2 stage.');
  cr.push('- **PARSE_FALLBACK** — fenced block found but failed validation; fell back to text scoring.');
  cr.push('- **PARSE_NONE** — no fenced block at all; pure prose output.');
  cr.push('');
  cr.push('## Notes');
  cr.push('');
  cr.push('Compliance below 100% in any tier means the LLM declined to follow the V3 schema instruction in some sessions — typically reverting to plain prose.');
  cr.push('Topic-11727 in production showed prose-only output on simple sessions (similar pattern would manifest as low Tier 1-2 compliance here).');
  writeFileSync(COMPLIANCE_PATH, cr.join('\n') + '\n');
  progress('Wrote compliance-report.md');

  progress('=== BENCHMARK COMPLETE ===');
  console.log(`Aggregate TRR: vanilla=${aggregate.vanilla_trr.toFixed(3)} kasett=${aggregate.kasett_trr.toFixed(3)} d=${aggregate.d_trr.toFixed(3)}`);
  console.log(`Aggregate KSSR: vanilla=${aggregate.vanilla_kssr.toFixed(3)} kasett=${aggregate.kasett_kssr.toFixed(3)} d=${aggregate.d_kssr.toFixed(3)}`);
  console.log(`Mean SY: ${aggregate.mean_sy.toFixed(2)}, Compliance: ${(aggregate.compliance_rate * 100).toFixed(1)}%`);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  progress(`FATAL: ${err.message}`);
  process.exit(1);
});
