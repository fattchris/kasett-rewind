/**
 * Standalone verification: the Kasett feedback loop actually fires.
 *
 * 1. Create a temp session JSONL + sidecar with two prior compactions
 *    (each with thread_meta_v3 incl. sub IDs and key_state).
 * 2. Run SessionReader.readLastNSummaries to get the rich previous summaries.
 * 3. Run parseCompactionOutputBestEffort on the latest to extract previousSubIds
 *    and previousKeyState (mirrors index.ts buildCompactionContext logic).
 * 4. Run weightSummaries + buildSteeringPrompt.
 * 5. Assert the resulting steering prompt contains the previous threads, IDs,
 *    and key_state values.
 */

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const KASETT = '/home/node/.openclaw/workspace/repos/kasett-rewind/dist';
const { SessionReader } = await import(`${KASETT}/storage/reader.js`);
const { writeSidecarEntry } = await import(`${KASETT}/storage/sidecar.js`);
const { weightSummaries } = await import(`${KASETT}/threads/weight.js`);
const { buildSteeringPrompt } = await import(`${KASETT}/threads/steering.js`);
const { parseCompactionOutputBestEffort } = await import(`${KASETT}/threads/parser.js`);

const tmp = mkdtempSync(join(tmpdir(), 'kasett-feedback-test-'));
const sessionFile = join(tmp, 'sess.jsonl');

// --- Create two fake compaction events in the JSONL ---
const stub1 = '11111111-1111-1111-1111-111111111111';
const stub2 = '22222222-2222-2222-2222-222222222222';

const ev1 = {
  type: 'compaction',
  ts: '2026-05-12T10:00:00Z',
  summary: `[KASETT_STUB::${stub1}] (stub placeholder for compaction 1)`,
};
const ev2 = {
  type: 'compaction',
  ts: '2026-05-12T11:00:00Z',
  summary: `[KASETT_STUB::${stub2}] (stub placeholder for compaction 2)`,
};
appendFileSync(sessionFile, JSON.stringify(ev1) + '\n');
appendFileSync(sessionFile, JSON.stringify(ev2) + '\n');

// --- Create matching sidecar entries (rich content) ---
const meta1 = {
  main: 'Setting up EKS staging cluster',
  sub: [
    { id: 'eks-cluster-bootstrap', label: 'EKS cluster bootstrap', status: 'active' },
    { id: 'iam-roles', label: 'IAM role configuration', status: 'completed' },
  ],
  key_state: [
    { kind: 'url', value: 'https://staging.example.com', label: 'staging URL' },
    { kind: 'arn', value: 'arn:aws:iam::1234:role/clyde-sudo', label: 'sudo role' },
  ],
};
const meta2 = {
  main: 'OAuth redirect debugging on staging',
  sub: [
    { id: 'eks-cluster-bootstrap', label: 'EKS cluster bootstrap', status: 'completed' },
    { id: 'oauth-redirect', label: 'GitHub OAuth redirect URI', status: 'active' },
    { id: 'argocd-sync', label: 'ArgoCD pipeline', status: 'fading' },
  ],
  key_state: [
    { kind: 'url', value: 'https://staging.example.com/callback', label: 'OAuth callback' },
    { kind: 'arn', value: 'arn:aws:iam::1234:role/clyde-sudo', label: 'sudo role' },
    { kind: 'config', value: 'GITHUB_APP_ID=12345', label: 'GitHub App ID' },
  ],
};

writeSidecarEntry(sessionFile, {
  ts: '2026-05-12T10:00:00Z',
  session_id: 'sess',
  compaction_id: stub1,
  stub_id: stub1,
  schema_version: 'v3',
  thread_meta_v3: meta1,
  thread_meta_v2: { main: meta1.main, sub: meta1.sub },
  summary_rich:
    `We bootstrapped a fresh EKS staging cluster, configured the cluster IAM roles, and pinned worker AMIs to v1.27.\n\n` +
    `\`\`\`json\n${JSON.stringify(meta1, null, 2)}\n\`\`\``,
  summary_chars: 200,
});
writeSidecarEntry(sessionFile, {
  ts: '2026-05-12T11:00:00Z',
  session_id: 'sess',
  compaction_id: stub2,
  stub_id: stub2,
  schema_version: 'v3',
  thread_meta_v3: meta2,
  thread_meta_v2: { main: meta2.main, sub: meta2.sub },
  summary_rich:
    `Continued from the EKS work. We hit an OAuth redirect mismatch on the staging app — the GitHub app callback was pointing at the old ALB DNS. Updated the app config and confirmed login. ArgoCD work paused.\n\n` +
    `\`\`\`json\n${JSON.stringify(meta2, null, 2)}\n\`\`\``,
  summary_chars: 250,
});

// --- Mirror the index.ts buildCompactionContext logic ---
const reader = new SessionReader();
const events = await reader.readLastNSummaries(sessionFile, 4); // request more than exist
console.log(`Read ${events.length} previous summaries from sidecar+JSONL`);

// Reverse so most-recent-first (matches index.ts behavior)
const previousSummaries = [...events].reverse();
const weighted = weightSummaries(previousSummaries, [1.0, 0.6, 0.3]);
console.log(`Weighted ${weighted.length} summaries`);
for (const w of weighted) {
  console.log(`  - ${w.label} (chars: ${w.summary.length})`);
}

// Mine previous IDs + key_state from the latest summary
let previousSubIds, previousKeyState;
if (previousSummaries.length > 0) {
  const latest = parseCompactionOutputBestEffort(previousSummaries[0]);
  console.log(`Latest summary parsed as schema=${latest.version}`);
  if (latest.metaV2 && latest.metaV2.sub.length > 0) {
    previousSubIds = latest.metaV2.sub.map((s) => s.id);
  }
  if (latest.metaV3?.key_state && latest.metaV3.key_state.length > 0) {
    previousKeyState = latest.metaV3.key_state;
  }
}

console.log('previousSubIds:', previousSubIds);
console.log('previousKeyState count:', previousKeyState?.length);

const steeringPrompt = buildSteeringPrompt(weighted, {
  structuredOutput: 'json',
  ...(previousSubIds ? { previousSubIds } : {}),
  ...(previousKeyState ? { previousKeyState } : {}),
});

console.log(`\nSteering prompt length: ${steeringPrompt.length} chars\n`);

// Assertions
const checks = {
  contains_previous_summary_label: steeringPrompt.includes('Previous Compaction Summaries'),
  contains_eks_cluster_bootstrap: steeringPrompt.includes('eks-cluster-bootstrap'),
  contains_oauth_redirect: steeringPrompt.includes('oauth-redirect'),
  contains_argocd_sync: steeringPrompt.includes('argocd-sync'),
  contains_main1_text: steeringPrompt.includes('Setting up EKS staging cluster'),
  contains_main2_text: steeringPrompt.includes('OAuth redirect debugging on staging'),
  contains_callback_url: steeringPrompt.includes('staging.example.com/callback'),
  contains_sudo_arn: steeringPrompt.includes('arn:aws:iam::1234:role/clyde-sudo'),
  contains_github_app_id: steeringPrompt.includes('GITHUB_APP_ID=12345'),
  contains_reuse_instruction: steeringPrompt.toLowerCase().includes('reuse'),
  contains_weight_label: steeringPrompt.includes('weight 1') || steeringPrompt.includes('weight 0.6'),
};

let allPass = true;
console.log('=== FEEDBACK LOOP VERIFICATION CHECKS ===');
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? '✅' : '❌'}  ${name}`);
  if (!pass) allPass = false;
}

if (!allPass) {
  console.error('\nFAILED. Dumping first 2000 chars of steering prompt:\n');
  console.error(steeringPrompt.slice(0, 2000));
  process.exit(1);
}

console.log('\n✅ All checks pass. Feedback loop is live.');
console.log(`Tmp dir: ${tmp}`);
