/**
 * Steering prompt builder.
 *
 * Builds prompts for two hooks:
 * 1. Orientation (before_prompt_build, runs on EVERY turn): shows agent the current
 *    thread state and trajectory across recent compactions — light, names only.
 * 2. Pre-compaction (summarize()): instructs the LLM to produce a new summary
 *    with weighted context from previous summaries for continuity.
 *
 * ## Schema versioning
 *
 * As of B2 (2026-05-12), the steering prompt defaults to `structuredOutput: 'json'`,
 * which asks the LLM for a fenced ```json``` block conforming to schema v2.
 * Legacy `'markdown'` mode preserves the v1 `[THREAD_META]` block for callers
 * that need it. A future `'tool'` mode will wire provider-native tool_use /
 * response_format=json_schema; for now it falls through to 'json' and the call
 * site is responsible for adding the API-level structured-output flag.
 */
import { schemaV3AsPromptString } from './schema.js';
/**
 * Build the orientation string for the before_prompt_build hook.
 * Runs on every agent turn. Shows current thread state + trajectory over
 * recent compactions so the agent knows what it was working on.
 *
 * Accepts multiple ThreadMeta objects (most recent first) — typically the
 * last 3 compaction summaries' [THREAD_META] blocks. Shows trajectory:
 * the most recent is the "current" state, older ones show where things came from.
 *
 * @param metas - Thread meta objects, most recent FIRST (up to 3)
 * @returns Orientation string, or null if no metas provided or all are empty
 */
export function buildOrientationPrompt(metas) {
    if (metas.length === 0)
        return null;
    const current = metas[0];
    if (!current.main?.trim())
        return null;
    const lines = [];
    // Current state (most recent compaction)
    lines.push(`You are currently working on: ${current.main}.`);
    const activeSubs = current.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
    if (activeSubs.length > 0) {
        lines.push(`Active sub-threads: ${activeSubs.join(', ')}`);
    }
    // Thread trajectory (previous compactions), if any
    const older = metas.slice(1);
    if (older.length > 0) {
        lines.push('');
        lines.push('Thread trajectory (previous compactions):');
        older.forEach((meta, i) => {
            const olderSubs = meta.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
            const subsStr = olderSubs.length > 0 ? ` | Subs: ${olderSubs.join(', ')}` : '';
            lines.push(`  -${i + 1}: Main: ${meta.main}${subsStr}`);
        });
    }
    return lines.join('\n');
}
/**
 * V2-aware orientation builder. When V2 metas are available we can render
 * status (active/blocked/completed/fading) and decisions inline, which the
 * v1 string-only schema couldn't express.
 *
 * Fallback rule: if a position has only v1 data (no v2), we render the v1
 * line; if v2, we render the richer line. Mixed timelines are normal during
 * the migration window.
 *
 * @param metas - Most-recent-first list. Each entry can be V1, V2, or both.
 *                When both are present, V2 wins.
 */
export function buildOrientationPromptV2(metas) {
    if (metas.length === 0)
        return null;
    const current = metas[0];
    const currentV2 = current.v2;
    const currentV1 = current.v1;
    const currentMain = currentV2?.main?.trim() || currentV1?.main?.trim() || '';
    if (!currentMain)
        return null;
    const lines = [];
    lines.push(`You are currently working on: ${currentMain}.`);
    if (currentV2) {
        if (currentV2.sub.length > 0) {
            const activeSubs = currentV2.sub
                .filter((s) => s.status === 'active' || s.status === 'blocked')
                .map((s) => `${s.label}${s.status === 'blocked' ? ' (blocked)' : ''}`);
            if (activeSubs.length > 0) {
                lines.push(`Active sub-threads: ${activeSubs.join(', ')}`);
            }
            const completed = currentV2.sub.filter((s) => s.status === 'completed');
            if (completed.length > 0) {
                lines.push(`Recently completed: ${completed.map((s) => s.label).join(', ')}`);
            }
        }
        if (currentV2.decisions && currentV2.decisions.length > 0) {
            lines.push('');
            lines.push('Recent decisions:');
            for (const d of currentV2.decisions)
                lines.push(`  - ${d}`);
        }
        if (currentV2.open_questions && currentV2.open_questions.length > 0) {
            lines.push('');
            lines.push('Open questions:');
            for (const q of currentV2.open_questions)
                lines.push(`  - ${q}`);
        }
    }
    else if (currentV1) {
        const activeSubs = currentV1.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
        if (activeSubs.length > 0) {
            lines.push(`Active sub-threads: ${activeSubs.join(', ')}`);
        }
    }
    const older = metas.slice(1);
    if (older.length > 0) {
        lines.push('');
        lines.push('Thread trajectory (previous compactions):');
        older.forEach((m, i) => {
            const v2 = m.v2;
            const v1 = m.v1;
            if (v2) {
                const labels = v2.sub.map((s) => `${s.label}[${s.status[0]}]`);
                const subsStr = labels.length > 0 ? ` | Subs: ${labels.join(', ')}` : '';
                lines.push(`  -${i + 1}: Main: ${v2.main}${subsStr}`);
            }
            else if (v1) {
                const olderSubs = v1.sub.filter((s) => s.trim() && s.trim().toLowerCase() !== 'idle');
                const subsStr = olderSubs.length > 0 ? ` | Subs: ${olderSubs.join(', ')}` : '';
                lines.push(`  -${i + 1}: Main: ${v1.main}${subsStr}`);
            }
        });
    }
    return lines.join('\n');
}
/**
 * V3-aware orientation builder. Extends V2 by appending a "Recent values"
 * section pulled from the most recent meta's `key_state[]`. Falls back to
 * the V2 builder when no V3 data is present.
 *
 * @param metas — Most-recent-first list. Each entry can be V1, V2, V3, or any
 *                 mix. V3 wins when both V2 and V3 are present.
 */
export function buildOrientationPromptV3(metas) {
    if (metas.length === 0)
        return null;
    // Project V3 → V2 for the V2 builder so we don't duplicate that logic.
    const v2Metas = metas.map((m) => ({
        v1: m.v1,
        v2: m.v3 ?? m.v2,
    }));
    const base = buildOrientationPromptV2(v2Metas);
    if (!base)
        return null;
    // Append Recent values from the MOST RECENT meta's key_state
    const current = metas[0];
    const ks = current.v3?.key_state;
    if (!ks || ks.length === 0)
        return base;
    const lines = [base, '', '## Recent values'];
    for (const e of ks) {
        const label = e.label ? `${e.label}: ` : '';
        lines.push(`  - ${label}${e.value}`);
    }
    return lines.join('\n');
}
/**
 * Build the pre-compaction steering prompt.
 *
 * Default mode (v2/json) asks the LLM for both a human-readable summary AND
 * a fenced ```json``` block conforming to the v2 thread-meta schema. The
 * combination is non-negotiable in tone — we treat this as a contract, not
 * a suggestion.
 *
 * Legacy mode ('markdown') preserves the v1 [THREAD_META] sentinel for
 * callers that haven't migrated.
 *
 * @param weightedSummaries - Previous summaries with temporal weights, most recent first
 * @param options - Output format and continuity hints
 * @returns Steering prompt string to inject as system context
 */
export function buildSteeringPrompt(weightedSummaries, options = {}) {
    const mode = options.structuredOutput ?? 'json';
    const sections = [];
    sections.push('## Thread-Aware Compaction Instructions');
    sections.push('');
    // Show weighted previous summaries as context
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
    // Output format instructions
    sections.push('### Output Requirements');
    sections.push('');
    sections.push('Write a concise compaction summary of the conversation below. ' +
        'Use the previous summaries above as context — higher-weighted summaries describe ' +
        'more recent work and should inform the summary more heavily. ' +
        'Lower-weighted summaries are older background context; include only what remains relevant.');
    sections.push('');
    if (mode === 'markdown') {
        sections.push(buildMarkdownInstructions());
    }
    else {
        // 'json' or 'tool' — the prompt is the same; the call site decides
        // whether to also pass response_format / tool_choice to the provider.
        sections.push(buildJsonInstructions(options.previousSubIds, options.candidateKeyState, options.previousKeyState));
    }
    return sections.join('\n');
}
// ---------------------------------------------------------------------------
// V1 markdown-mode instructions (legacy / fallback)
// ---------------------------------------------------------------------------
function buildMarkdownInstructions() {
    const lines = [];
    lines.push('Then IMMEDIATELY after the summary, append this structured block (filled in with real values):');
    lines.push('');
    lines.push('[THREAD_META]');
    lines.push('main: Setting up K8s staging on AWS EKS');
    lines.push('sub1: ArgoCD deployment pipeline configuration');
    lines.push('sub2: Database credential management');
    lines.push('sub3: idle');
    lines.push('[/THREAD_META]');
    lines.push('');
    lines.push('That example shows the format. Replace the values with the ACTUAL thread state from the conversation you are summarizing.');
    lines.push('The [THREAD_META] block describes the current conversation threads for agent orientation — ' +
        'it is NOT a task tracker. Threads reflect what the conversation is actually about right now. ' +
        'They change naturally as conversation topics shift.');
    lines.push('The [THREAD_META] block must appear at the end. Exactly 1 main + 3 subs. ' +
        'Use "idle" for inactive sub-thread slots.');
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// V2 JSON-mode instructions (default)
// ---------------------------------------------------------------------------
function buildJsonInstructions(previousSubIds, candidateKeyState, previousKeyState) {
    const lines = [];
    lines.push('Your response MUST contain TWO things, in this order:');
    lines.push('');
    lines.push('1. A concise human-readable narrative summary of the conversation. Plain prose. ' +
        'No JSON yet. No headings. 2-6 paragraphs is typical.');
    lines.push('2. AFTER the narrative, a single fenced JSON block (```json``` … ```) that conforms ' +
        'EXACTLY to the schema below. This block is non-negotiable — your response is invalid without it.');
    lines.push('');
    lines.push('### Thread Meta JSON Schema (v3)');
    lines.push('');
    lines.push('```json');
    lines.push(schemaV3AsPromptString());
    lines.push('```');
    lines.push('');
    lines.push('### Field Guidance');
    lines.push('');
    lines.push('- `main` is the SINGLE overarching thing being worked on right now. One sentence. ' +
        'Not a list of topics, not a description of every thread, not a meta-comment about the conversation. ' +
        'If you are tempted to use "and", split into a different field.');
    lines.push('- `sub` is 0 to 5 sub-threads. Each sub-thread has a stable `id` (lowercase-kebab) ' +
        'that you should REUSE from previous compactions when the same thread continues, and only mint ' +
        'new ids for genuinely new work. The `status` field is critical: ' +
        '`active` = currently being worked on, ' +
        '`blocked` = paused on something external, ' +
        '`completed` = finished this session, ' +
        '`fading` = no longer active but recently relevant.');
    if (previousSubIds && previousSubIds.length > 0) {
        lines.push(`- Previous sub-thread IDs (REUSE when threads continue): ${previousSubIds
            .map((id) => `"${id}"`)
            .join(', ')}`);
    }
    lines.push('- `decisions` (optional, max 5) captures KEY decisions made since last compaction. ' +
        'Skip if nothing important was decided. Plain sentences.');
    lines.push('- `open_questions` (optional, max 5) captures genuinely open items / blockers. ' +
        'Not every conversation has these. Skip if not applicable.');
    lines.push('- `key_state` (optional, max 20) preserves SPECIFIC values verbatim across compactions: ' +
        'URLs, IDs (ARNs/UUIDs/AWS resource ids), filesystem paths, version strings/git SHAs/model ids, ' +
        'config tokens (KEY=value), or any other exact value worth keeping. ' +
        'Each entry is `{ kind, value, label?, context?, thread_id? }`. ' +
        'Use exact values — do NOT paraphrase. Skip values that have been superseded or are no longer relevant.');
    // Continuity hints (Phase C)
    if (previousKeyState && previousKeyState.length > 0) {
        lines.push('');
        lines.push('#### Previous compaction\'s `key_state` (carry forward when still relevant)');
        lines.push('');
        for (const e of previousKeyState.slice(0, 20)) {
            lines.push(`  - ${formatKeyStateHint(e)}`);
        }
    }
    if (candidateKeyState && candidateKeyState.length > 0) {
        lines.push('');
        lines.push('#### Detected candidate values from this conversation (KEEP the still-relevant ones)');
        lines.push('');
        lines.push('These were auto-detected by regex — they are HINTS, not commands. ' +
            'Drop ones that are no longer relevant. Add ones we missed. Keep the values exact.');
        lines.push('');
        for (const e of candidateKeyState.slice(0, 30)) {
            lines.push(`  - ${formatKeyStateHint(e)}`);
        }
    }
    lines.push('');
    lines.push('### Example Response');
    lines.push('');
    lines.push('We spent the session debugging the OAuth redirect flow on the staging EKS cluster. ' +
        'The redirect URI in the GitHub app was pointing at the old ALB DNS, which has rotated since ' +
        'last week. We updated the GitHub app config and confirmed the staging login flow now works. ' +
        'Toward the end we started looking at moving the same fix into the prod CDK definition but ' +
        'paused waiting for Thomson to review the PR.');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(buildExampleV3Object(), null, 2));
    lines.push('```');
    lines.push('');
    lines.push('CRITICAL: the ```json``` block must be valid JSON, parseable by `JSON.parse`. ' +
        'Use double quotes only. No trailing commas. No comments. No markdown inside the JSON.');
    return lines.join('\n');
}
/**
 * Format a single key-state entry for display in the prompt as a hint.
 * Compact: `kind=value [label]` or just `kind=value` when no label.
 */
function formatKeyStateHint(e) {
    const labelPart = e.label ? ` [${e.label}]` : '';
    return `${e.kind}=${e.value}${labelPart}`;
}
/**
 * Reference example used in the prompt. Kept type-checked so a future schema
 * change forces us to update the example too. (V2 retained for tests.)
 */
function buildExampleV2Object() {
    return {
        main: 'OAuth redirect debugging on staging EKS cluster',
        sub: [
            {
                id: 'github-app-redirect-uri',
                label: 'Update GitHub app redirect URI to new ALB DNS',
                status: 'completed',
            },
            {
                id: 'cdk-prod-rollout',
                label: 'Mirror redirect-URI fix in prod CDK definition',
                status: 'blocked',
            },
            {
                id: 'thomson-pr-review',
                label: 'Wait for Thomson PR review on prod CDK PR',
                status: 'blocked',
            },
        ],
        decisions: [
            'Pin redirect URIs to ALB DNS rather than tracking a custom CNAME, until DNS strategy lands.',
        ],
        open_questions: [
            'Does the staging fix also affect the SSO callback flow, or only the GitHub login path?',
        ],
    };
}
/**
 * V3 example with key_state — used in the prompt body so the LLM has a
 * concrete pattern to copy.
 */
function buildExampleV3Object() {
    return {
        main: 'OAuth redirect debugging on staging EKS cluster',
        sub: [
            {
                id: 'github-app-redirect-uri',
                label: 'Update GitHub app redirect URI to new ALB DNS',
                status: 'completed',
            },
            {
                id: 'cdk-prod-rollout',
                label: 'Mirror redirect-URI fix in prod CDK definition',
                status: 'blocked',
            },
            {
                id: 'thomson-pr-review',
                label: 'Wait for Thomson PR review on prod CDK PR',
                status: 'blocked',
            },
        ],
        decisions: [
            'Pin redirect URIs to ALB DNS rather than tracking a custom CNAME, until DNS strategy lands.',
        ],
        open_questions: [
            'Does the staging fix also affect the SSO callback flow, or only the GitHub login path?',
        ],
        key_state: [
            {
                kind: 'url',
                value: 'https://staging.example.com/oauth/callback',
                label: 'staging OAuth callback URL',
                thread_id: 'github-app-redirect-uri',
            },
            {
                kind: 'id',
                value: 'arn:aws:iam::843979154439:role/clyde-sudo',
                label: 'clyde-sudo role ARN',
            },
            {
                kind: 'path',
                value: '/home/node/.openclaw/workspace/repos/molt-infra',
                label: 'molt-infra repo',
            },
            {
                kind: 'version',
                value: 'v2.4.1-rc.3',
                label: 'CDK release candidate under review',
                thread_id: 'cdk-prod-rollout',
            },
        ],
    };
}
//# sourceMappingURL=steering.js.map