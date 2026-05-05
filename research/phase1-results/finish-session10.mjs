import { readFileSync, writeFileSync } from 'node:fs';

const API_KEY = JSON.parse(readFileSync('/home/node/.openclaw/workspace/repos/moltaimux/test-env/test-config-live.json', 'utf8')).models.providers.openrouter.apiKey;

const fixture = JSON.parse(readFileSync('research/phase1-results/fixtures/session-10.json', 'utf8'));

// Build conversation text (truncate to last 30 messages if too long)
const msgs = fixture.messages.slice(-30);
const convText = msgs.map(m => `${m.role}: ${m.content}`).join('\n');

const steeringPrompt = `You are compacting a conversation for context continuity. Produce a comprehensive summary that preserves:
1. All active work threads and their current state
2. All key technical values (URLs, paths, versions, IDs, connection strings)
3. The trajectory of the conversation

At the END of your summary, output a thread meta block in this exact format:
[THREAD_META]
Main: <one-sentence description of the primary thread>
Sub1: <one-sentence description of secondary thread 1>
Sub2: <one-sentence description of secondary thread 2>
Sub3: <one-sentence description of secondary thread 3>
[/THREAD_META]

CRITICAL: Every specific value (URL, version, path, ID, config) mentioned in the conversation MUST appear verbatim in your summary. Do not paraphrase technical values.`;

const messages = [
  {role: 'system', content: steeringPrompt},
  {role: 'user', content: 'Summarize this conversation for context continuity:\n\n' + convText}
];

console.log(`Sending ${JSON.stringify(messages).length} bytes to OpenRouter...`);

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json'},
  body: JSON.stringify({model: 'anthropic/claude-sonnet-4-6', messages, temperature: 0, max_tokens: 4096})
});

if (!res.ok) {
  console.error('API error:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const output = data.choices[0].message.content;
writeFileSync('research/phase1-results/raw-outputs/session-10-kasett.txt', output);
console.log(`Done. Written ${output.length} chars.`);
