/**
 * Prior-Compaction Ablation Runner
 * 
 * Tests 3 arms across 2 compaction transitions (C1→C2 and C2→C3) 
 * on session 3e4586b6-topic-5392 (paper trimming workstream).
 * 
 * Arm 1 (BASELINE): Full prior compaction summaries included in prompt
 * Arm 2 (STRIPPED): Prior summaries removed from prompt  
 * Arm 3 (INSTRUCTED): Prior summaries + explicit ID preservation directive
 */

import { readFileSync, existsSync } from 'fs';
import https from 'https';

const SIDECAR_PATH = '/home/node/.openclaw/agents/main/sessions/3e4586b6-0705-4ed5-8e68-b52dd4b18f00-topic-5392.jsonl.kasett-meta.jsonl';
const CHECKPOINT_BASE = '/home/node/.openclaw/agents/main/sessions/3e4586b6-0705-4ed5-8e68-b52dd4b18f00-topic-5392.checkpoint.';

// Checkpoints ordered by timestamp:
// C1: 3dff82e6 (05:52) - smallest, C1 content
// C2: f0d77bb9 (06:23)
// C3: 2f81e288 (06:36) - largest
const CHECKPOINTS = {
  C1: CHECKPOINT_BASE + '3dff82e6-b7d9-4fb0-9046-afe5373e4444.jsonl',
  C2: CHECKPOINT_BASE + 'f0d77bb9-91fa-48ee-8fcd-535535b54ea7.jsonl',
  C3: CHECKPOINT_BASE + '2f81e288-0107-4f3b-b389-c0f8ec3f1db9.jsonl',
};

// --- Load sidecar compactions ---
function loadSidecar() {
  const lines = readFileSync(SIDECAR_PATH, 'utf8').trim().split('\n');
  return lines.map(l => JSON.parse(l));
}

// --- Load checkpoint messages ---
function loadCheckpoint(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // Extract message events
  return events.filter(e => e.type === 'message' && e.message);
}

// --- Convert messages to text for compaction prompt ---
function messagesToText(messages) {
  const textParts = [];
  for (const ev of messages) {
    const msg = ev.message;
    const role = msg.role;
    const content = msg.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(p => p.type === 'text' && p.text)
        .map(p => p.text)
        .join('\n');
    }
    if (!text.trim()) continue;
    // Skip very long tool results to keep prompts manageable
    const prefix = role === 'user' ? 'Human' : role === 'assistant' ? 'Assistant' : role;
    // Truncate very long messages
    if (text.length > 8000) {
      text = text.slice(0, 8000) + '\n[... truncated for compaction ...]';
    }
    textParts.push(`${prefix}: ${text}`);
  }
  return textParts.join('\n\n');
}

// --- Build the schema v3 prompt string (matches schemaV3AsPromptString()) ---
function schemaV3AsPromptString() {
  return JSON.stringify({
    main: "string — ONE sentence: the primary task right now",
    sub: [
      {
        id: "kebab-case-id (REUSE from prior compactions for continuing threads)",
        label: "string — what this sub-thread is",
        status: "active | blocked | completed | fading"
      }
    ],
    decisions: ["string — key decision (optional, max 5)"],
    open_questions: ["string — open blocker (optional, max 5)"],
    key_state: [
      {
        kind: "url | id | path | version | config | value",
        value: "exact value verbatim",
        label: "short label (optional)",
        context: "brief context (optional)",
        thread_id: "sub-thread this belongs to (optional)"
      }
    ]
  }, null, 2);
}

// --- Build steering prompt (matches buildSteeringPrompt in prod) ---
function buildSteeringPrompt(weightedSummaries, options = {}) {
  const sections = [];
  sections.push('## Thread-Aware Compaction Instructions');
  sections.push('');

  if (weightedSummaries.length > 0) {
    sections.push('### Previous Compaction Summaries (for continuity)');
    sections.push('');
    sections.push('These summaries are from previous compactions. ' +
      'Weight indicates how much influence each should have on the new summary: ' +
      '1.0 = most recent (high relevance), lower = older (retain only if still relevant).');
    sections.push('');
    for (const ws of weightedSummaries) {
      sections.push(`#### ${ws.label}`);
      sections.push('');
      sections.push(ws.summary.trim());
      sections.push('');
    }
  }

  sections.push('### Output Requirements');
  sections.push('');
  sections.push('Write a concise compaction summary of the conversation below. ' +
    'Use the previous summaries above as context — higher-weighted summaries describe ' +
    'more recent work and should inform the summary more heavily. ' +
    'Lower-weighted summaries are older background context; include only what remains relevant.');
  sections.push('');

  // JSON instructions
  const lines = [];
  lines.push('Your response MUST contain TWO things, in this order:');
  lines.push('');
  lines.push('1. A concise human-readable narrative summary of the conversation. Plain prose. No JSON yet. No headings. 2-6 paragraphs is typical.');
  lines.push('2. AFTER the narrative, a single fenced JSON block (```json``` … ```) that conforms EXACTLY to the schema below. This block is non-negotiable — your response is invalid without it.');
  lines.push('');
  lines.push('### Thread Meta JSON Schema (v3)');
  lines.push('');
  lines.push('```json');
  lines.push(schemaV3AsPromptString());
  lines.push('```');
  lines.push('');
  lines.push('### Field Guidance');
  lines.push('');
  lines.push('- `main` is the SINGLE overarching thing being worked on right now. One sentence.');
  lines.push('- `sub` is 0 to 5 sub-threads. Each sub-thread has a stable `id` (lowercase-kebab) ' +
    'that you should REUSE from previous compactions when the same thread continues, and only mint ' +
    'new ids for genuinely new work. The `status` field is critical: ' +
    '`active` = currently being worked on, ' +
    '`blocked` = paused on something external, ' +
    '`completed` = finished this session, ' +
    '`fading` = no longer active but recently relevant.');

  if (options.previousSubIds && options.previousSubIds.length > 0) {
    lines.push(`- Previous sub-thread IDs (REUSE when threads continue): ${options.previousSubIds.map(id => `"${id}"`).join(', ')}`);
    if (options.coreSubIds && options.coreSubIds.length > 0) {
      lines.push(`- CORE sub-thread IDs — these have appeared in MULTIPLE previous compactions ` +
        `and represent durable threads. Strongly prefer reusing them when they remain ` +
        `relevant: ${options.coreSubIds.map(id => `"${id}"`).join(', ')}`);
    }
  }

  lines.push('- `decisions` (optional, max 5) captures KEY decisions made since last compaction.');
  lines.push('- `open_questions` (optional, max 5) captures genuinely open items / blockers.');
  lines.push('- `key_state` (optional, max 20) preserves SPECIFIC values verbatim across compactions.');

  if (options.previousKeyState && options.previousKeyState.length > 0) {
    lines.push('');
    lines.push("#### Previous compaction's `key_state` (carry forward when still relevant)");
    lines.push('');
    for (const e of options.previousKeyState.slice(0, 20)) {
      const label = e.label ? ` [${e.label}]` : '';
      lines.push(`  - ${e.kind}=${e.value}${label}`);
    }
  }

  // Arm 3 instruction (injected if requested)
  if (options.preservationDirective) {
    lines.push('');
    lines.push('### THREAD ID PRESERVATION DIRECTIVE (MANDATORY)');
    lines.push('');
    lines.push('When work continues from a prior compaction, REUSE the existing thread IDs (sub1, sub2, sub3) ' +
      'for that ongoing work rather than minting new IDs. Only create new sub_thread IDs for genuinely new ' +
      'workstreams not represented in the prior thread_meta. If a workstream from prior has clearly ended, ' +
      'mark it completed in lifecycle_events instead of replacing it.');
  }

  lines.push('');
  lines.push('CRITICAL: the ```json``` block must be valid JSON, parseable by `JSON.parse`. Use double quotes only. No trailing commas. No comments.');

  sections.push(lines.join('\n'));
  return sections.join('\n');
}

// --- Parse thread meta from LLM response ---
function parseThreadMeta(response) {
  // Try to extract JSON block
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    // Try raw JSON
    const rawMatch = response.match(/\{[\s\S]*"main"[\s\S]*\}/);
    if (rawMatch) {
      try { return JSON.parse(rawMatch[0]); } catch {}
    }
    return null;
  }
  try {
    return JSON.parse(jsonMatch[1]);
  } catch (e) {
    console.error('JSON parse error:', e.message, '\nRaw:', jsonMatch[1].slice(0, 200));
    return null;
  }
}

// --- Compute Jaccard on sub-thread IDs ---
function jaccardSubIds(priorSubs, newSubs) {
  const priorIds = new Set(priorSubs.map(s => (typeof s === 'string' ? s : s.id)));
  const newIds = new Set(newSubs.map(s => (typeof s === 'string' ? s : s.id)));
  const intersection = new Set([...priorIds].filter(id => newIds.has(id)));
  const union = new Set([...priorIds, ...newIds]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// --- LLM call via OpenRouter ---
async function callLLM(systemPrompt, userPrompt, model = 'anthropic/claude-sonnet-4-5') {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: systemPrompt,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://kasett-rewind.moltaicorp.com',
        'X-Title': 'kasett-rewind ablation',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`API error: ${JSON.stringify(json.error)}`));
            return;
          }
          const content = json.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error(`No content in response: ${data.slice(0, 200)}`));
            return;
          }
          resolve(content);
        } catch (e) {
          reject(new Error(`Response parse error: ${e.message}\nRaw: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Weight summaries for the prompt ---
function weightSummaries(summaries, weights = [1.0, 0.6, 0.3]) {
  const labels = ['Compaction: Most Recent', 'Compaction: Previous', 'Compaction: Oldest Retained'];
  return summaries.map((s, i) => ({
    summary: s,
    weight: weights[i] ?? 0.1,
    label: `${labels[i] ?? `Compaction -${i+1}`} (weight: ${weights[i] ?? 0.1})`,
  }));
}

// --- Main ablation ---
async function runAblation() {
  console.log('Loading sidecar compactions...');
  const compactions = loadSidecar();
  console.log(`Found ${compactions.length} compactions: C1(${compactions[0].ts}), C2(${compactions[1].ts}), C3(${compactions[2].ts})`);

  // Load conversation slices
  console.log('Loading checkpoints...');
  const ck1 = loadCheckpoint(CHECKPOINTS.C1);
  const ck2 = loadCheckpoint(CHECKPOINTS.C2);
  const ck3 = loadCheckpoint(CHECKPOINTS.C3);
  console.log(`Checkpoint sizes: C1=${ck1.length} events, C2=${ck2.length} events, C3=${ck3.length} events`);

  // The checkpoints are CUMULATIVE (each contains all messages up to that compaction)
  // We need just the SLICE between checkpoints for the user prompt content
  // C1 transition: conv slice = ck1 content (all messages before C1)
  // C2 transition: conv slice = ck2 content minus ck1 (messages between C1 and C2)
  // For the ablation prompt: we use the checkpoint DIRECTLY as the conversation context
  // (as kasett does — it passes all messages in context to the LLM)
  
  // Parse the sidecar summaries to get sub-thread IDs for continuity hints
  const c1Meta = compactions[0].thread_meta_v3;
  const c2Meta = compactions[1].thread_meta_v3;
  const c3Meta = compactions[2].thread_meta_v3;

  console.log('\n=== Prior sub IDs ===');
  console.log('C1 sub IDs:', c1Meta.sub.map(s => s.id));
  console.log('C2 sub IDs:', c2Meta.sub.map(s => s.id));
  console.log('C3 sub IDs:', c3Meta.sub.map(s => s.id));

  // Compute production Jaccard (ground truth from sidecar)
  const prodJaccardC1C2 = jaccardSubIds(c1Meta.sub, c2Meta.sub);
  const prodJaccardC2C3 = jaccardSubIds(c2Meta.sub, c3Meta.sub);
  console.log(`\nProduction Jaccard C1→C2: ${prodJaccardC1C2.toFixed(3)}`);
  console.log(`Production Jaccard C2→C3: ${prodJaccardC2C3.toFixed(3)}`);

  const results = {};

  // ===== TRANSITION 1: C1→C2 =====
  // At C2 compaction time, kasett had C1 summary in its window
  // Conversation content is messages in ck2 (everything up to C2)
  
  console.log('\n\n=== TRANSITION 1: C1→C2 ===');
  const conv1Text = messagesToText(ck1); // Messages before C1 compaction
  // Note: The actual C2 compaction input would be messages AFTER C1 stub was injected
  // But for reconstruction we use ck2 minus ck1 content — let's use ck2 as it's what kasett sees
  const conv1to2Text = messagesToText(ck2);
  
  const userPrompt1 = 'Please produce a compaction summary of the following conversation. ' +
    'Follow the thread meta instructions in your system prompt exactly.\n\n---\n\n' + conv1to2Text;

  // Arm 1: BASELINE — C1 summary in context
  console.log('  Running Arm 1 (BASELINE)...');
  const arm1SysPrompt = buildSteeringPrompt(
    weightSummaries([compactions[0].summary_rich]),
    {
      previousSubIds: c1Meta.sub.map(s => s.id),
      previousKeyState: c1Meta.key_state,
    }
  );
  let arm1Result1, arm1Meta1;
  try {
    arm1Result1 = await callLLM(arm1SysPrompt, userPrompt1);
    arm1Meta1 = parseThreadMeta(arm1Result1);
    console.log('  Arm 1 sub IDs:', arm1Meta1?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 1 error:', e.message);
    arm1Meta1 = null;
  }

  // Arm 2: STRIPPED — no prior summaries
  console.log('  Running Arm 2 (STRIPPED)...');
  const arm2SysPrompt = buildSteeringPrompt([], {});
  let arm2Result1, arm2Meta1;
  try {
    arm2Result1 = await callLLM(arm2SysPrompt, userPrompt1);
    arm2Meta1 = parseThreadMeta(arm2Result1);
    console.log('  Arm 2 sub IDs:', arm2Meta1?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 2 error:', e.message);
    arm2Meta1 = null;
  }

  // Arm 3: INSTRUCTED — prior + preservation directive
  console.log('  Running Arm 3 (INSTRUCTED)...');
  const arm3SysPrompt = buildSteeringPrompt(
    weightSummaries([compactions[0].summary_rich]),
    {
      previousSubIds: c1Meta.sub.map(s => s.id),
      previousKeyState: c1Meta.key_state,
      preservationDirective: true,
    }
  );
  let arm3Result1, arm3Meta1;
  try {
    arm3Result1 = await callLLM(arm3SysPrompt, userPrompt1);
    arm3Meta1 = parseThreadMeta(arm3Result1);
    console.log('  Arm 3 sub IDs:', arm3Meta1?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 3 error:', e.message);
    arm3Meta1 = null;
  }

  // Compute Jaccard for T1
  const t1 = {
    prior_sub_ids: c1Meta.sub.map(s => s.id),
    production_jaccard: prodJaccardC1C2,
    arm1: {
      sub_ids: arm1Meta1?.sub?.map(s => s.id) ?? [],
      jaccard: arm1Meta1 ? jaccardSubIds(c1Meta.sub, arm1Meta1.sub) : null,
      canonical_carry: arm1Meta1 ? c1Meta.sub.filter(s => arm1Meta1.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
    arm2: {
      sub_ids: arm2Meta1?.sub?.map(s => s.id) ?? [],
      jaccard: arm2Meta1 ? jaccardSubIds(c1Meta.sub, arm2Meta1.sub) : null,
      canonical_carry: arm2Meta1 ? c1Meta.sub.filter(s => arm2Meta1.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
    arm3: {
      sub_ids: arm3Meta1?.sub?.map(s => s.id) ?? [],
      jaccard: arm3Meta1 ? jaccardSubIds(c1Meta.sub, arm3Meta1.sub) : null,
      canonical_carry: arm3Meta1 ? c1Meta.sub.filter(s => arm3Meta1.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
  };
  results.transition1 = t1;
  console.log('\nT1 Jaccard results:');
  console.log(`  Production: ${t1.production_jaccard.toFixed(3)}`);
  console.log(`  Arm 1 (baseline): ${t1.arm1.jaccard?.toFixed(3) ?? 'N/A'}`);
  console.log(`  Arm 2 (stripped): ${t1.arm2.jaccard?.toFixed(3) ?? 'N/A'}`);
  console.log(`  Arm 3 (instructed): ${t1.arm3.jaccard?.toFixed(3) ?? 'N/A'}`);

  // ===== TRANSITION 2: C2→C3 =====
  console.log('\n\n=== TRANSITION 2: C2→C3 ===');
  const conv2to3Text = messagesToText(ck3); // Messages up to C3

  const userPrompt2 = 'Please produce a compaction summary of the following conversation. ' +
    'Follow the thread meta instructions in your system prompt exactly.\n\n---\n\n' + conv2to3Text;

  // Arm 1: BASELINE — C2 (most recent) + C1 (older) in window
  console.log('  Running Arm 1 (BASELINE)...');
  const arm1SysPrompt2 = buildSteeringPrompt(
    weightSummaries([compactions[1].summary_rich, compactions[0].summary_rich]),
    {
      previousSubIds: [...c2Meta.sub.map(s => s.id), ...c1Meta.sub.map(s => s.id)],
      coreSubIds: c1Meta.sub.filter(s => c2Meta.sub.some(cs => cs.id === s.id)).map(s => s.id),
      previousKeyState: [...(c2Meta.key_state ?? []), ...(c1Meta.key_state ?? [])],
    }
  );
  let arm1Result2, arm1Meta2;
  try {
    arm1Result2 = await callLLM(arm1SysPrompt2, userPrompt2);
    arm1Meta2 = parseThreadMeta(arm1Result2);
    console.log('  Arm 1 sub IDs:', arm1Meta2?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 1 error:', e.message);
    arm1Meta2 = null;
  }

  // Arm 2: STRIPPED — no prior summaries
  console.log('  Running Arm 2 (STRIPPED)...');
  const arm2SysPrompt2 = buildSteeringPrompt([], {});
  let arm2Result2, arm2Meta2;
  try {
    arm2Result2 = await callLLM(arm2SysPrompt2, userPrompt2);
    arm2Meta2 = parseThreadMeta(arm2Result2);
    console.log('  Arm 2 sub IDs:', arm2Meta2?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 2 error:', e.message);
    arm2Meta2 = null;
  }

  // Arm 3: INSTRUCTED
  console.log('  Running Arm 3 (INSTRUCTED)...');
  const arm3SysPrompt2 = buildSteeringPrompt(
    weightSummaries([compactions[1].summary_rich, compactions[0].summary_rich]),
    {
      previousSubIds: [...c2Meta.sub.map(s => s.id), ...c1Meta.sub.map(s => s.id)],
      coreSubIds: c1Meta.sub.filter(s => c2Meta.sub.some(cs => cs.id === s.id)).map(s => s.id),
      previousKeyState: [...(c2Meta.key_state ?? []), ...(c1Meta.key_state ?? [])],
      preservationDirective: true,
    }
  );
  let arm3Result2, arm3Meta2;
  try {
    arm3Result2 = await callLLM(arm3SysPrompt2, userPrompt2);
    arm3Meta2 = parseThreadMeta(arm3Result2);
    console.log('  Arm 3 sub IDs:', arm3Meta2?.sub?.map(s => s.id) ?? 'PARSE FAILED');
  } catch (e) {
    console.error('  Arm 3 error:', e.message);
    arm3Meta2 = null;
  }

  // Compute Jaccard for T2
  const t2 = {
    prior_sub_ids: c2Meta.sub.map(s => s.id),
    production_jaccard: prodJaccardC2C3,
    arm1: {
      sub_ids: arm1Meta2?.sub?.map(s => s.id) ?? [],
      jaccard: arm1Meta2 ? jaccardSubIds(c2Meta.sub, arm1Meta2.sub) : null,
      canonical_carry: arm1Meta2 ? c2Meta.sub.filter(s => arm1Meta2.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
    arm2: {
      sub_ids: arm2Meta2?.sub?.map(s => s.id) ?? [],
      jaccard: arm2Meta2 ? jaccardSubIds(c2Meta.sub, arm2Meta2.sub) : null,
      canonical_carry: arm2Meta2 ? c2Meta.sub.filter(s => arm2Meta2.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
    arm3: {
      sub_ids: arm3Meta2?.sub?.map(s => s.id) ?? [],
      jaccard: arm3Meta2 ? jaccardSubIds(c2Meta.sub, arm3Meta2.sub) : null,
      canonical_carry: arm3Meta2 ? c2Meta.sub.filter(s => arm3Meta2.sub.some(ns => ns.id === s.id)).map(s => s.id) : [],
    },
  };
  results.transition2 = t2;
  console.log('\nT2 Jaccard results:');
  console.log(`  Production: ${t2.production_jaccard.toFixed(3)}`);
  console.log(`  Arm 1 (baseline): ${t2.arm1.jaccard?.toFixed(3) ?? 'N/A'}`);
  console.log(`  Arm 2 (stripped): ${t2.arm2.jaccard?.toFixed(3) ?? 'N/A'}`);
  console.log(`  Arm 3 (instructed): ${t2.arm3.jaccard?.toFixed(3) ?? 'N/A'}`);

  // Save raw LLM outputs
  results.raw_outputs = {
    t1_arm1: arm1Result1 ?? 'ERROR',
    t1_arm2: arm2Result1 ?? 'ERROR',
    t1_arm3: arm3Result1 ?? 'ERROR',
    t2_arm1: arm1Result2 ?? 'ERROR',
    t2_arm2: arm2Result2 ?? 'ERROR',
    t2_arm3: arm3Result2 ?? 'ERROR',
  };

  return results;
}

// Run
const openrouterKey = process.env['OPENROUTER_API_KEY'];
if (!openrouterKey) {
  // Try reading from secrets file
  try {
    const envContent = readFileSync('/home/node/.openclaw/workspace/data/.secrets/openrouter.env', 'utf8');
    const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) process.env['OPENROUTER_API_KEY'] = match[1].trim();
  } catch {}
}

runAblation().then(results => {
  const output = JSON.stringify(results, null, 2);
  process.stdout.write('\n\n=== FINAL RESULTS ===\n');
  process.stdout.write(output);
  process.stdout.write('\n');
}).catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
