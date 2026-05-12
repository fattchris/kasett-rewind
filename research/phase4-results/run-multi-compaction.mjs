/**
 * Phase 4 — Multi-compaction feedback loop benchmark harness.
 *
 * For each conversation:
 *   1. Run 4 compactions in TWO conditions (Vanilla + Kasett), in order.
 *   2. Vanilla:  each compaction summarizes only the new turns since last checkpoint, with no previous context.
 *   3. Kasett:   each compaction reads the previous N (=3) sidecars, runs the production
 *                buildSteeringPrompt with previousSubIds + previousKeyState, calls LLM with
 *                full V3 steering, parses with parseCompactionOutputBestEffort, writes sidecar.
 *   4. After all 4 compactions complete: for each probe, give the answering agent the LATEST
 *      compaction (Vanilla summary OR Kasett summary + JSON meta) and ask the question.
 *   5. Score with LLM-judge.
 *
 * Cost budget: ~240 LLM calls × $0.05 ≈ $12.
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const KASETT = '/home/node/.openclaw/workspace/repos/kasett-rewind/dist';
const { SessionReader } = await import(`${KASETT}/storage/reader.js`);
const { writeSidecarEntry } = await import(`${KASETT}/storage/sidecar.js`);
const { weightSummaries } = await import(`${KASETT}/threads/weight.js`);
const { buildSteeringPrompt } = await import(`${KASETT}/threads/steering.js`);
const { parseCompactionOutputBestEffort } = await import(`${KASETT}/threads/parser.js`);

// --- Config ---
const config = JSON.parse(readFileSync('/home/node/.openclaw/workspace/repos/moltaimux/test-env/test-config-live.json', 'utf-8'));
let openrouterKey;
function findKey(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'apiKey' && typeof v === 'string' && v.startsWith('sk-or-')) {
      openrouterKey = v;
      return;
    }
    if (typeof v === 'object') findKey(v);
  }
}
findKey(config);
if (!openrouterKey) throw new Error('No OpenRouter API key found');

const COMPACTION_MODEL = 'anthropic/claude-sonnet-4-5';
const PROBE_MODEL = 'anthropic/claude-sonnet-4-5';
const JUDGE_MODEL = 'anthropic/claude-sonnet-4-6';
const WEIGHTS = [1.0, 0.6, 0.3];
const WINDOW_SIZE = 3;
const COMPACTION_TEMPERATURE = 0;
const PROBE_TEMPERATURE = 0.2;

const ARGV = process.argv.slice(2);
const ARG = Object.fromEntries(
  ARGV.map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const ONLY_CONV = ARG['conv'] || null;
const SKIP_PROBES = ARG['skip-probes'] === true || ARG['skip-probes'] === 'true';
const DRY_RUN = ARG['dry-run'] === true || ARG['dry-run'] === 'true';
const MAX_TOKENS_COMPACTION = 8000;
const MAX_TOKENS_PROBE = 400;
const MAX_TOKENS_JUDGE = 200;

// --- LLM call ---
async function callLLM({ model, system, user, temperature, maxTokens }) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// --- Conversation rendering ---
function turnsToText(turns) {
  return turns.map(([role, content]) => `${role.toUpperCase()}: ${content}`).join('\n');
}

// --- Vanilla compaction: just summarize the new turns ---
const VANILLA_SYSTEM = `You are summarizing a slice of a conversation. Produce a concise narrative summary (2-5 paragraphs) capturing key facts, decisions, current state, and active topics. No bullet lists, no structured output, just narrative prose. Keep specific values verbatim (URLs, ARNs, IDs, names).`;

async function runVanillaCompaction(turns) {
  const userText = turnsToText(turns);
  const summary = await callLLM({
    model: COMPACTION_MODEL,
    system: VANILLA_SYSTEM,
    user: `Summarize this conversation slice:\n\n${userText}`,
    temperature: COMPACTION_TEMPERATURE,
    maxTokens: MAX_TOKENS_COMPACTION,
  });
  return summary;
}

// --- Kasett compaction: build full V3 steering prompt with previous summaries ---
async function runKasettCompaction(turns, previousSummaries /* most-recent-first */) {
  const weighted = weightSummaries(previousSummaries, WEIGHTS);

  // Mine previous IDs + key_state from latest summary
  let previousSubIds, previousKeyState;
  if (previousSummaries.length > 0) {
    const latest = parseCompactionOutputBestEffort(previousSummaries[0]);
    if (latest.metaV2 && latest.metaV2.sub.length > 0) {
      previousSubIds = latest.metaV2.sub.map((s) => s.id);
    }
    if (latest.metaV3?.key_state && latest.metaV3.key_state.length > 0) {
      previousKeyState = latest.metaV3.key_state;
    }
  }

  const steeringPrompt = buildSteeringPrompt(weighted, {
    structuredOutput: 'json',
    ...(previousSubIds ? { previousSubIds } : {}),
    ...(previousKeyState ? { previousKeyState } : {}),
  });

  const userText = turnsToText(turns);
  const fullSummary = await callLLM({
    model: COMPACTION_MODEL,
    system: steeringPrompt,
    user: `Please produce a compaction summary of the following conversation. Follow the thread meta instructions in your system prompt EXACTLY.\n\n---\n\n${userText}`,
    temperature: COMPACTION_TEMPERATURE,
    maxTokens: MAX_TOKENS_COMPACTION,
  });

  // Verify feedback loop fired (steering prompt contained previous content)
  const feedbackLoopFired = previousSummaries.length > 0
    ? steeringPrompt.includes(previousSummaries[0].slice(0, 50))
    : true;

  // Parse the output
  const parsed = parseCompactionOutputBestEffort(fullSummary);

  return {
    summary: fullSummary,
    parsed,
    steeringPromptChars: steeringPrompt.length,
    feedbackLoopFired,
    previousSubIds: previousSubIds ?? [],
    previousKeyState: previousKeyState ?? [],
  };
}

// --- Probe answering ---
const PROBE_SYSTEM_VANILLA = `You are answering a question based ONLY on the compaction summary provided. If the answer is not in the summary, respond exactly with "NOT_FOUND" and nothing else. Do not guess. Be concise — one sentence answers preferred. Reproduce specific values (URLs, ARNs, IDs, names) verbatim when possible.`;

const PROBE_SYSTEM_KASETT = `You are answering a question based ONLY on the structured compaction artifact provided. The artifact has a narrative summary and a JSON block with thread metadata, decisions, open questions, and key_state values. Use ALL of these — especially the key_state values, which preserve specific URLs/ARNs/IDs verbatim. If the answer is not in any field of the artifact, respond exactly with "NOT_FOUND" and nothing else. Do not guess. Be concise — one sentence answers preferred. Reproduce specific values verbatim.`;

async function answerProbe(condition, summary, question) {
  const system = condition === 'vanilla' ? PROBE_SYSTEM_VANILLA : PROBE_SYSTEM_KASETT;
  const answer = await callLLM({
    model: PROBE_MODEL,
    system,
    user: `Compaction artifact:\n\n${summary}\n\n---\n\nQuestion: ${question}`,
    temperature: PROBE_TEMPERATURE,
    maxTokens: MAX_TOKENS_PROBE,
  });
  return answer.trim();
}

// --- Judge ---
const JUDGE_SYSTEM = `You are a strict but fair grading judge. Given a question, an expected answer, and the agent's actual answer, decide if the actual answer captures the same factual content as the expected. Respond with EXACTLY one of:
  CORRECT
  PARTIAL
  WRONG
followed by a brief reason on the next line. PARTIAL means the answer is on-topic but missing key specifics. WRONG includes "NOT_FOUND" responses (the agent failed to retrieve the answer).`;

async function judge(question, expectedAnswer, acceptableAnswers, actualAnswer) {
  // Quick string-match shortcut: if any acceptable substring is present (case-insensitive), call it CORRECT
  const lower = actualAnswer.toLowerCase();
  for (const acc of acceptableAnswers) {
    if (lower.includes(acc.toLowerCase())) {
      return { verdict: 'CORRECT', reason: 'string-match', autoMatched: true };
    }
  }
  if (lower.includes('not_found') || lower.includes('not found')) {
    return { verdict: 'WRONG', reason: 'NOT_FOUND', autoMatched: true };
  }

  // Otherwise ask the judge
  const verdictText = await callLLM({
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM,
    user: `QUESTION: ${question}\nEXPECTED: ${expectedAnswer}\nACCEPTABLE_KEYWORDS: ${acceptableAnswers.join(', ')}\nACTUAL: ${actualAnswer}`,
    temperature: 0,
    maxTokens: MAX_TOKENS_JUDGE,
  });
  const firstLine = verdictText.trim().split('\n')[0].toUpperCase();
  let verdict = 'WRONG';
  if (firstLine.includes('CORRECT')) verdict = 'CORRECT';
  else if (firstLine.includes('PARTIAL')) verdict = 'PARTIAL';
  return { verdict, reason: verdictText.trim(), autoMatched: false };
}

// --- Per-conversation runner ---
async function runConversation(conv, results) {
  console.log(`\n=== ${conv.id} (${conv.topic}) ===`);

  // VANILLA condition: 4 compactions, each independent
  console.log(`-- Vanilla pass --`);
  const vanillaSummaries = []; // chronological: index 0 = compaction 1
  for (let i = 0; i < conv.segments.length; i++) {
    const seg = conv.segments[i];
    process.stdout.write(`  C${i + 1} (${seg.narrative.length} turns)... `);
    if (DRY_RUN) {
      vanillaSummaries.push(`[VANILLA stub for compaction ${i + 1}]`);
      console.log('(dry-run)');
      continue;
    }
    const summary = await runVanillaCompaction(seg.narrative);
    vanillaSummaries.push(summary);
    console.log(`${summary.length} chars`);
  }
  results.vanilla[conv.id] = { summaries: vanillaSummaries };

  // KASETT condition: 4 compactions, each reads previous N from sidecar
  console.log(`-- Kasett pass --`);
  const tmp = mkdtempSync(join(tmpdir(), `phase4-${conv.id}-`));
  const sessionFile = join(tmp, 'sess.jsonl');
  // Initialize empty session file
  writeFileSync(sessionFile, '');

  const kasettSummaries = [];
  const kasettMeta = []; // parsed thread_meta_v3 per compaction
  const feedbackLog = [];

  for (let i = 0; i < conv.segments.length; i++) {
    const seg = conv.segments[i];
    process.stdout.write(`  C${i + 1} (${seg.narrative.length} turns)... `);

    // Read previous summaries (rich) from the sidecar via SessionReader
    const reader = new SessionReader();
    const events = await reader.readLastNSummaries(sessionFile, WINDOW_SIZE);
    const previousSummaries = [...events].reverse(); // most-recent-first

    if (DRY_RUN) {
      const fakeSummary = `[KASETT stub C${i + 1} prev=${previousSummaries.length}]`;
      kasettSummaries.push(fakeSummary);
      kasettMeta.push(null);
      feedbackLog.push({ depth: i + 1, prevCount: previousSummaries.length, fired: previousSummaries.length === Math.min(i, WINDOW_SIZE) });
      console.log('(dry-run)');
      continue;
    }

    const result = await runKasettCompaction(seg.narrative, previousSummaries);
    kasettSummaries.push(result.summary);
    kasettMeta.push(result.parsed);
    feedbackLog.push({
      depth: i + 1,
      prevCount: previousSummaries.length,
      fired: result.feedbackLoopFired,
      steeringChars: result.steeringPromptChars,
      previousSubIds: result.previousSubIds,
      schema: result.parsed.version,
      subCount: result.parsed.metaV2?.sub.length ?? 0,
      keyStateCount: result.parsed.metaV3?.key_state?.length ?? 0,
    });
    console.log(
      `${result.summary.length} chars, schema=${result.parsed.version}, subs=${result.parsed.metaV2?.sub.length ?? 0}, key_state=${result.parsed.metaV3?.key_state?.length ?? 0}, prev=${previousSummaries.length}, fired=${result.feedbackLoopFired}`,
    );

    // Write sidecar entry + JSONL stub for next iteration
    const stubId = `c${i + 1}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const stubLine = JSON.stringify({
      type: 'compaction',
      ts: new Date().toISOString(),
      summary: `[KASETT_STUB::${stubId.padEnd(36, '0').slice(0, 36)}] (stub for compaction ${i + 1})`,
    });
    // Append the stub
    const fs = await import('node:fs/promises');
    await fs.appendFile(sessionFile, stubLine + '\n');

    // Write the rich sidecar entry
    const stubIdUuid = stubId.padEnd(36, '0').slice(0, 36);
    writeSidecarEntry(sessionFile, {
      ts: new Date().toISOString(),
      session_id: 'sess',
      compaction_id: stubIdUuid,
      stub_id: stubIdUuid,
      schema_version: result.parsed.version === 'none' ? 'v1' : result.parsed.version,
      ...(result.parsed.metaV1 ? { thread_meta: result.parsed.metaV1 } : {}),
      ...(result.parsed.metaV2 ? { thread_meta_v2: result.parsed.metaV2 } : {}),
      ...(result.parsed.metaV3 ? { thread_meta_v3: result.parsed.metaV3 } : {}),
      summary_rich: result.summary,
      summary_chars: result.summary.length,
    });
  }

  results.kasett[conv.id] = {
    summaries: kasettSummaries,
    metas: kasettMeta,
    feedbackLog,
  };

  if (SKIP_PROBES) return;

  // PROBES — answer using ONLY the LATEST compaction (depth-current view)
  console.log(`-- Probes (${conv.probes.length}) --`);
  const probeResults = [];
  for (const probe of conv.probes) {
    const vanillaArtifact = vanillaSummaries[vanillaSummaries.length - 1];
    const kasettArtifact = kasettSummaries[kasettSummaries.length - 1];

    if (DRY_RUN) {
      probeResults.push({
        probeId: probe.id,
        depth: probe.depth,
        type: probe.type,
        question: probe.question,
        vanilla: { answer: '(dry-run)', verdict: 'WRONG' },
        kasett: { answer: '(dry-run)', verdict: 'CORRECT' },
      });
      continue;
    }

    const vAns = await answerProbe('vanilla', vanillaArtifact, probe.question);
    const kAns = await answerProbe('kasett', kasettArtifact, probe.question);
    const vJ = await judge(probe.question, probe.expectedAnswer, probe.acceptableAnswers, vAns);
    const kJ = await judge(probe.question, probe.expectedAnswer, probe.acceptableAnswers, kAns);

    console.log(
      `  [${probe.id}] depth=${probe.depth} type=${probe.type}: vanilla=${vJ.verdict} kasett=${kJ.verdict}`,
    );
    probeResults.push({
      probeId: probe.id,
      depth: probe.depth,
      type: probe.type,
      question: probe.question,
      expectedAnswer: probe.expectedAnswer,
      vanilla: { answer: vAns, verdict: vJ.verdict, reason: vJ.reason, autoMatched: vJ.autoMatched },
      kasett: { answer: kAns, verdict: kJ.verdict, reason: kJ.reason, autoMatched: kJ.autoMatched },
    });
  }
  results.probes[conv.id] = probeResults;
}

// --- Main ---
async function main() {
  const corpus = JSON.parse(readFileSync('/home/node/.openclaw/workspace/research/phase4-results/long-corpus.json', 'utf-8'));
  const results = {
    config: {
      compactionModel: COMPACTION_MODEL,
      probeModel: PROBE_MODEL,
      judgeModel: JUDGE_MODEL,
      weights: WEIGHTS,
      windowSize: WINDOW_SIZE,
    },
    timestamp: new Date().toISOString(),
    vanilla: {},
    kasett: {},
    probes: {},
  };

  for (const conv of corpus.conversations) {
    if (ONLY_CONV && conv.id !== ONLY_CONV) continue;
    try {
      await runConversation(conv, results);
    } catch (err) {
      console.error(`Error in ${conv.id}:`, err);
      results.errors = results.errors ?? {};
      results.errors[conv.id] = String(err);
    }
    // Save partial results after each conversation
    writeFileSync(
      '/home/node/.openclaw/workspace/research/phase4-results/results.json',
      JSON.stringify(results, null, 2),
    );
  }

  console.log('\n=== Done ===');
  writeFileSync(
    '/home/node/.openclaw/workspace/research/phase4-results/results.json',
    JSON.stringify(results, null, 2),
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
