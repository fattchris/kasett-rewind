#!/usr/bin/env node
/**
 * Phase 3 — Behavioral Probe Harness
 *
 * For each scenario:
 *   1. Build vanilla compaction (Sonnet 4.5 prose summary)
 *   2. Build Kasett compaction (production V3 steering prompt + parser)
 *   3. For each probe (10 facts × 5 scenarios = 50 probes):
 *        - Vanilla agent answer: prompt = summary + question
 *        - Kasett agent answer:  prompt = summary + structured fields + question
 *   4. Score each answer:
 *        - exact_match: lowercase substring of expected in answer
 *        - semantic_match: LLM-judge yes/no (different model)
 *        - hallucinated: LLM-judge yes/no
 *        - no_answer: regex on common refusal patterns
 *
 * Models:
 *   - Compaction & probe-answer: anthropic/claude-sonnet-4-5 (held constant)
 *   - LLM judge: anthropic/claude-sonnet-4-6 (different model — bias control)
 *
 * Output: results.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
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
const COMPACTION_MODEL = 'anthropic/claude-sonnet-4-5';
const PROBE_MODEL = 'anthropic/claude-sonnet-4-5';
const JUDGE_MODEL = 'anthropic/claude-sonnet-4-6'; // different family for bias control
const COMPACTION_MAX_TOKENS = 32000;
const PROBE_MAX_TOKENS = 400;
const JUDGE_MAX_TOKENS = 200;
const TEMP_COMPACTION = 0;
const TEMP_PROBE = 0.2;
const TEMP_JUDGE = 0;
const CALL_DELAY_MS = 2000;

// ---- Imports from production plugin stack ----
const { parseCompactionOutputV3 } = await import(join(REPO_ROOT, 'dist', 'threads', 'parser.js'));
const { buildSteeringPrompt } = await import(join(REPO_ROOT, 'dist', 'threads', 'steering.js'));
const { detectCandidateKeyState } = await import(join(REPO_ROOT, 'dist', 'keystate', 'detector.js'));

// ---- Paths ----
const CORPUS_PATH = join(__dirname, 'probe-corpus.json');
const RAW_OUTPUTS_DIR = join(__dirname, 'raw-outputs');
const RESULTS_PATH = join(__dirname, 'results.json');
const PROGRESS_PATH = join(__dirname, 'progress.md');

if (!existsSync(RAW_OUTPUTS_DIR)) mkdirSync(RAW_OUTPUTS_DIR, { recursive: true });

function progress(msg) {
  const now = new Date().toISOString();
  const line = `[${now}] ${msg}\n`;
  appendFileSync(PROGRESS_PATH, line);
  console.log(line.trim());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- LLM call ----
async function callLLM({ model, messages, system, temperature, max_tokens }) {
  const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: allMessages, temperature, max_tokens };
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callLLMRetry(opts) {
  try {
    return await callLLM(opts);
  } catch (err) {
    progress(`  RETRY after error: ${err.message}`);
    await sleep(5000);
    try {
      return await callLLM(opts);
    } catch (err2) {
      progress(`  SECOND FAILURE: ${err2.message}`);
      return '';
    }
  }
}

// ---- Helpers ----
function buildConversationText(messages) {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
}

// ---- Compactions ----
async function vanillaCompact(messages) {
  const conversationText = buildConversationText(messages);
  const system = `You are a helpful assistant that summarizes conversations for context continuity.
Produce a clear, comprehensive summary that captures the key decisions, state, technical details, and ongoing work from this conversation.
Include specific values, paths, URLs, and version numbers that were discussed.`;
  const user = [{ role: 'user', content: `Please summarize the following conversation for context continuity:\n\n${conversationText}` }];
  return callLLMRetry({
    model: COMPACTION_MODEL,
    messages: user,
    system,
    temperature: TEMP_COMPACTION,
    max_tokens: COMPACTION_MAX_TOKENS,
  });
}

async function kasettCompact(messages) {
  const conversationText = buildConversationText(messages);
  const candidates = detectCandidateKeyState(messages);
  const steeringSection = buildSteeringPrompt([], {
    structuredOutput: 'json',
    previousSubIds: [],
    candidateKeyState: candidates,
    previousKeyState: [],
    recentLifecycle: [],
  });
  const system = `You are a helpful assistant performing thread-aware compaction for context continuity.

${steeringSection}`;
  const user = [{ role: 'user', content: `Compaction target — summarize the conversation below per the instructions above:\n\n${conversationText}` }];
  const raw = await callLLMRetry({
    model: COMPACTION_MODEL,
    messages: user,
    system,
    temperature: TEMP_COMPACTION,
    max_tokens: COMPACTION_MAX_TOKENS,
  });
  const parsed = parseCompactionOutputV3(raw);
  return { raw, parsed };
}

// ---- Probe answer ----
async function answerProbeVanilla(summary, question) {
  const system = `You are a helpful assistant. You will be given a context summary from a prior conversation and a question about it.
Answer the question concisely based ONLY on the summary. If the summary does not contain the information needed, say "I don't have that information."`;
  const user = [{ role: 'user', content: `Context summary:\n\n${summary}\n\nQuestion: ${question}` }];
  return callLLMRetry({
    model: PROBE_MODEL,
    messages: user,
    system,
    temperature: TEMP_PROBE,
    max_tokens: PROBE_MAX_TOKENS,
  });
}

async function answerProbeKasett(parsed, rawOutput, question) {
  const meta = parsed.meta;
  const summary = parsed.summary || rawOutput || '';
  const main = String(meta?.main || '');
  const subs = (meta?.sub || []).map(s => `  - [${s.id || '?'}] ${s.label || ''}${s.status ? ` (${s.status})` : ''}`).join('\n');
  const ks = (meta?.key_state || []).map(e => `  - ${e.label || ''}: ${e.value || ''}${e.context ? ` (${e.context})` : ''}`).join('\n');
  const decs = (meta?.decisions || []).map(d => `  - ${d}`).join('\n');
  const oqs = (meta?.open_questions || []).map(q => `  - ${q}`).join('\n');

  const structured = `Structured context:
- Main thread: ${main}
- Sub-threads:
${subs || '  (none)'}
- Key values:
${ks || '  (none)'}
- Decisions:
${decs || '  (none)'}
- Open questions:
${oqs || '  (none)'}`;

  const system = `You are a helpful assistant. You will be given a context summary AND structured context fields from a prior conversation, and a question about it.
Answer the question concisely based ONLY on the provided context. If the context does not contain the information needed, say "I don't have that information."`;
  const user = [{ role: 'user', content: `Prose summary:\n\n${summary}\n\n${structured}\n\nQuestion: ${question}` }];
  return callLLMRetry({
    model: PROBE_MODEL,
    messages: user,
    system,
    temperature: TEMP_PROBE,
    max_tokens: PROBE_MAX_TOKENS,
  });
}

// ---- Scoring ----
function exactMatch(expected, answer) {
  if (!expected || !answer) return 0;
  return answer.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
}

function noAnswerHeuristic(answer) {
  if (!answer) return 1;
  const a = answer.toLowerCase();
  return /(don't have that information|do not have that information|not (provided|specified|mentioned|in the context|available)|isn'?t (mentioned|specified|provided)|cannot (find|determine)|unable to (find|determine)|no information|insufficient (context|information))/i.test(a) ? 1 : 0;
}

async function judgeSemantic(question, expected, answer) {
  if (!answer || noAnswerHeuristic(answer)) {
    return { semantic_match: 0, raw: '(skipped — no_answer)' };
  }
  const system = `You are an evaluator. Given a question, an expected answer, and a candidate answer, decide whether the candidate correctly identifies the expected answer (semantically — paraphrases and equivalent expressions count). Be strict but fair.

Reply with EXACTLY one line: SEMANTIC_MATCH: YES or SEMANTIC_MATCH: NO`;
  const user = [{ role: 'user', content: `Question: ${question}\n\nExpected answer: ${expected}\n\nCandidate answer: ${answer}\n\nDoes the candidate answer correctly identify the expected answer?` }];
  const raw = await callLLMRetry({
    model: JUDGE_MODEL,
    messages: user,
    system,
    temperature: TEMP_JUDGE,
    max_tokens: JUDGE_MAX_TOKENS,
  });
  const semantic_match = /SEMANTIC_MATCH:\s*YES/i.test(raw) ? 1 : 0;
  return { semantic_match, raw };
}

async function judgeHallucination(question, expected, answer, summary, structured) {
  if (!answer || noAnswerHeuristic(answer)) {
    return { hallucinated: 0, raw: '(skipped — no_answer)' };
  }
  const system = `You are an evaluator. Given a context, a question, the candidate answer, and the expected answer, decide whether the candidate answer FABRICATED a specific value not supported by the context. Specifically:
- If the candidate gives a specific value (URL, number, name, version, path, etc.) that is NOT in the context: HALLUCINATED.
- If the candidate is vague or honestly says "not specified": NOT HALLUCINATED.
- If the candidate gives the correct answer (matching context): NOT HALLUCINATED.
- If the candidate gives a wrong specific value that is also not in the context: HALLUCINATED.

Reply with EXACTLY one line: HALLUCINATED: YES or HALLUCINATED: NO`;
  const ctx = `Context:\n${summary}\n${structured || ''}`;
  const user = [{ role: 'user', content: `${ctx}\n\nQuestion: ${question}\nExpected answer: ${expected}\nCandidate answer: ${answer}\n\nDid the candidate fabricate a specific value not supported by the context?` }];
  const raw = await callLLMRetry({
    model: JUDGE_MODEL,
    messages: user,
    system,
    temperature: TEMP_JUDGE,
    max_tokens: JUDGE_MAX_TOKENS,
  });
  const hallucinated = /HALLUCINATED:\s*YES/i.test(raw) ? 1 : 0;
  return { hallucinated, raw };
}

// ---- Main ----
async function run() {
  progress('Phase 3 probe harness — START');
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  progress(`Loaded ${corpus.length} scenarios, ${corpus.reduce((a, s) => a + s.facts.length, 0)} probes total`);

  const results = { scenarios: [], started: new Date().toISOString() };

  for (let i = 0; i < corpus.length; i++) {
    const sc = corpus[i];
    progress(`\n=== Scenario ${sc.scenario}: ${sc.name} (${sc.total_turns} turns, ${sc.facts.length} probes) ===`);

    // Vanilla compaction
    progress(`  vanilla compact ...`);
    const tV = Date.now();
    const vanillaSummary = await vanillaCompact(sc.turns);
    const vanillaMs = Date.now() - tV;
    writeFileSync(join(RAW_OUTPUTS_DIR, `${sc.scenario}-vanilla-summary.txt`), vanillaSummary);
    progress(`    ${vanillaSummary.length} chars in ${vanillaMs}ms`);
    await sleep(CALL_DELAY_MS);

    // Kasett compaction
    progress(`  kasett compact ...`);
    const tK = Date.now();
    const { raw: kasettRaw, parsed: kasettParsed } = await kasettCompact(sc.turns);
    const kasettMs = Date.now() - tK;
    writeFileSync(join(RAW_OUTPUTS_DIR, `${sc.scenario}-kasett-raw.txt`), kasettRaw);
    writeFileSync(join(RAW_OUTPUTS_DIR, `${sc.scenario}-kasett-parsed.json`), JSON.stringify(kasettParsed, null, 2));
    const sy = kasettParsed.meta
      ? (kasettParsed.meta.sub?.length || 0) + (kasettParsed.meta.key_state?.length || 0) + (kasettParsed.meta.decisions?.length || 0) + (kasettParsed.meta.open_questions?.length || 0)
      : 0;
    progress(`    ${kasettRaw.length} chars in ${kasettMs}ms, SY=${sy}, has_meta=${!!kasettParsed.meta}`);
    await sleep(CALL_DELAY_MS);

    const scenarioResult = {
      scenario: sc.scenario,
      name: sc.name,
      total_turns: sc.total_turns,
      vanilla_summary_chars: vanillaSummary.length,
      kasett_raw_chars: kasettRaw.length,
      kasett_sy: sy,
      kasett_has_meta: !!kasettParsed.meta,
      probes: [],
    };

    // For each probe
    for (let j = 0; j < sc.facts.length; j++) {
      const f = sc.facts[j];
      progress(`  probe ${f.fact_id} [${f.kind}]: "${f.question}" (expect "${f.expected_answer}")`);

      // Vanilla probe
      const vanillaAnswer = await answerProbeVanilla(vanillaSummary, f.question);
      await sleep(CALL_DELAY_MS);
      // Kasett probe
      const kasettAnswer = await answerProbeKasett(kasettParsed, kasettRaw, f.question);
      await sleep(CALL_DELAY_MS);

      // Score
      const v_em = exactMatch(f.expected_answer, vanillaAnswer);
      const k_em = exactMatch(f.expected_answer, kasettAnswer);
      const v_no = noAnswerHeuristic(vanillaAnswer);
      const k_no = noAnswerHeuristic(kasettAnswer);

      // Semantic match (judge)
      const v_sem = await judgeSemantic(f.question, f.expected_answer, vanillaAnswer);
      await sleep(CALL_DELAY_MS);
      const k_sem = await judgeSemantic(f.question, f.expected_answer, kasettAnswer);
      await sleep(CALL_DELAY_MS);

      // Build kasett structured-context string for hallucination judge
      const meta = kasettParsed.meta;
      const ks = (meta?.key_state || []).map(e => `${e.label || ''}=${e.value || ''}`).join('; ');
      const subs = (meta?.sub || []).map(s => s.label || '').join('; ');
      const kasettStructured = `Structured: subs=[${subs}] key_state=[${ks}] decisions=[${(meta?.decisions || []).join('; ')}] open_questions=[${(meta?.open_questions || []).join('; ')}]`;

      const v_hall = await judgeHallucination(f.question, f.expected_answer, vanillaAnswer, vanillaSummary, '');
      await sleep(CALL_DELAY_MS);
      const k_hall = await judgeHallucination(f.question, f.expected_answer, kasettAnswer, kasettParsed.summary || kasettRaw, kasettStructured);
      await sleep(CALL_DELAY_MS);

      const probeResult = {
        fact_id: f.fact_id,
        kind: f.kind,
        position: f.position,
        question: f.question,
        expected_answer: f.expected_answer,
        vanilla: {
          answer: vanillaAnswer,
          exact_match: v_em,
          semantic_match: v_sem.semantic_match,
          hallucinated: v_hall.hallucinated,
          no_answer: v_no,
        },
        kasett: {
          answer: kasettAnswer,
          exact_match: k_em,
          semantic_match: k_sem.semantic_match,
          hallucinated: k_hall.hallucinated,
          no_answer: k_no,
        },
      };
      scenarioResult.probes.push(probeResult);
      progress(`    V: em=${v_em} sem=${v_sem.semantic_match} hall=${v_hall.hallucinated} noans=${v_no} | K: em=${k_em} sem=${k_sem.semantic_match} hall=${k_hall.hallucinated} noans=${k_no}`);

      // Persist intermediate (so we don't lose progress if it dies)
      results.scenarios = [...results.scenarios.filter(s => s.scenario !== sc.scenario), scenarioResult];
      writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
    }

    progress(`  Scenario ${sc.scenario} complete`);
  }

  results.completed = new Date().toISOString();
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  progress(`\n=== ALL DONE ===`);
}

run().catch((err) => {
  progress(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
