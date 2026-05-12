#!/usr/bin/env node
/**
 * Phase A — Replay analysis.
 *
 * For every compaction event in OC session JSONL files in the last 7 days,
 * extract the actual stored summary, run kasett's parser over it, and tally:
 *
 *   - total compaction events
 *   - events with a successfully-parsed [THREAD_META] block (meta != null)
 *   - events with [KASETT_STUB::] (hot-swap never replaced)
 *   - events with neither marker (vanilla OC fallback or legacy)
 *
 * Outputs:
 *   - markdown summary written to research/phase-a-replay-report.md
 *   - JSON detail written to research/phase-a-replay-detail.json
 *
 * Run:  node research/phase-a-replay.js
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseCompactionOutput } from '../dist/threads/parser.js';

const SESSIONS_DIR = '/home/node/.openclaw/agents/main/sessions';
const REPORT_PATH = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/phase-a-replay-report.md';
const DETAIL_PATH = '/home/node/.openclaw/workspace/repos/kasett-rewind/research/phase-a-replay-detail.json';
const DAYS = 7;

async function main() {
  const cutoff = Date.now() - DAYS * 86400_000;
  const allFiles = await readdir(SESSIONS_DIR);
  const targets = [];

  for (const f of allFiles) {
    if (!f.endsWith('.jsonl')) continue;
    if (f.endsWith('.lock')) continue;
    if (f.includes('.checkpoint.')) continue;
    const path = join(SESSIONS_DIR, f);
    try {
      const st = await stat(path);
      if (st.mtimeMs < cutoff) continue;
      targets.push(path);
    } catch {
      // ignore unreadable
    }
  }

  let events = 0;
  let hasStub = 0;
  let hasThreadMeta = 0;
  let parsedValid = 0;
  let stubAndMeta = 0;
  let richReplaced = 0; // THREAD_META present, no stub marker — i.e. real summary
  let neither = 0;

  const richExamples = [];
  const stubExamples = [];
  const failedParseExamples = [];

  for (const path of targets) {
    let raw;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      continue;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (obj.type !== 'compaction') continue;
      events += 1;
      const summary = typeof obj.summary === 'string' ? obj.summary : '';
      const stub = summary.includes('[KASETT_STUB::') || summary.includes('KASETT_STUB');
      const tm = summary.includes('[THREAD_META]');

      if (stub) hasStub += 1;
      if (tm) hasThreadMeta += 1;

      if (!stub && !tm) {
        neither += 1;
        continue;
      }

      // Run kasett parser
      const parsed = parseCompactionOutput(summary);
      const validMeta = !!parsed.meta;
      if (validMeta) parsedValid += 1;

      if (stub && validMeta) {
        stubAndMeta += 1;
        if (stubExamples.length < 3) {
          stubExamples.push({
            file: basename(path),
            timestamp: obj.timestamp,
            charCount: summary.length,
            metaMain: parsed.meta?.main ?? null,
            preview: summary.slice(0, 240),
          });
        }
      } else if (!stub && validMeta) {
        // True rich replacement: parser succeeded AND no stub marker present
        richReplaced += 1;
        if (richExamples.length < 5) {
          richExamples.push({
            file: basename(path),
            timestamp: obj.timestamp,
            charCount: summary.length,
            metaMain: parsed.meta?.main ?? null,
            metaSubs: parsed.meta?.sub ?? null,
            preview: summary.slice(0, 240),
          });
        }
      }

      if (tm && !validMeta) {
        if (failedParseExamples.length < 5) {
          failedParseExamples.push({
            file: basename(path),
            timestamp: obj.timestamp,
            charCount: summary.length,
            preview: summary.slice(0, 400),
          });
        }
      }
    }
  }

  const detail = {
    days: DAYS,
    sessionFilesScanned: targets.length,
    events,
    hasStub,
    hasThreadMeta,
    parsedValid,
    stubAndMeta,
    richReplaced,
    neither,
    complianceRate: events === 0 ? null : richReplaced / events,
    parseSuccessRate: hasThreadMeta === 0 ? null : parsedValid / hasThreadMeta,
    richExamples,
    stubExamples,
    failedParseExamples,
  };

  await writeFile(DETAIL_PATH, JSON.stringify(detail, null, 2));

  const md = renderMarkdown(detail);
  await writeFile(REPORT_PATH, md);

  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Wrote ${DETAIL_PATH}`);
  console.log(`Events=${events} richReplaced=${richReplaced} stubOnly=${hasStub - stubAndMeta} stubAndMeta=${stubAndMeta} neither=${neither}`);
}

function renderMarkdown(d) {
  const pct = (x) => (x == null ? 'N/A' : (x * 100).toFixed(1) + '%');
  const lines = [];
  lines.push(`# Phase A — Replay Analysis`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Window:** last ${d.days} days`);
  lines.push(`**Session files scanned:** ${d.sessionFilesScanned} (non-checkpoint)`);
  lines.push('');
  lines.push(`## Headline numbers`);
  lines.push('');
  lines.push(`- Compaction events:         **${d.events}**`);
  lines.push(`- Has [KASETT_STUB::]:       **${d.hasStub}**`);
  lines.push(`- Has [THREAD_META]:         **${d.hasThreadMeta}**`);
  lines.push(`- Parser produced valid meta: **${d.parsedValid}**`);
  lines.push('');
  lines.push(`## Breakdown`);
  lines.push('');
  lines.push(`- **Rich (replaced):** ${d.richReplaced} — \`THREAD_META\` present, **no stub marker**, parser produced valid meta. This is what success looks like.`);
  lines.push(`- **Stub + meta:** ${d.stubAndMeta} — both stub marker and the carry-over THREAD_META from a previous compaction. Hot-swap never replaced this stub.`);
  lines.push(`- **Stub only:** ${d.hasStub - d.stubAndMeta} — stub with no THREAD_META at all (initial compaction with no previous meta to carry).`);
  lines.push(`- **Neither marker (vanilla OC fallback):** ${d.neither}`);
  lines.push('');
  lines.push(`## Compliance`);
  lines.push('');
  lines.push(`- **Compliance rate** (rich / total events): **${pct(d.complianceRate)}**`);
  lines.push(`- **Parser success rate** (valid meta / events with [THREAD_META]): **${pct(d.parseSuccessRate)}**`);
  lines.push('');
  lines.push(`Compliance rate is the fraction of compactions that produced a kasett-rich summary in production. Parser success rate isolates the parser: when a [THREAD_META] block is present, does kasett's parser actually accept it?`);
  lines.push('');
  if (d.richExamples.length > 0) {
    lines.push(`## Rich-replaced examples (${d.richExamples.length})`);
    lines.push('');
    for (const ex of d.richExamples) {
      lines.push(`### ${ex.file}`);
      lines.push(`- timestamp: ${ex.timestamp}`);
      lines.push(`- chars: ${ex.charCount}`);
      lines.push(`- meta.main: \`${ex.metaMain}\``);
      lines.push(`- meta.subs: ${JSON.stringify(ex.metaSubs)}`);
      lines.push(`- preview: \`${(ex.preview || '').replace(/`/g, "'").slice(0, 200)}\``);
      lines.push('');
    }
  }
  if (d.stubExamples.length > 0) {
    lines.push(`## Stub-only examples (${d.stubExamples.length})`);
    lines.push('');
    for (const ex of d.stubExamples) {
      lines.push(`### ${ex.file}`);
      lines.push(`- timestamp: ${ex.timestamp}`);
      lines.push(`- meta.main (carry-over): \`${ex.metaMain}\``);
      lines.push(`- preview: \`${(ex.preview || '').replace(/`/g, "'").slice(0, 200)}\``);
      lines.push('');
    }
  }
  if (d.failedParseExamples.length > 0) {
    lines.push(`## Failed-parse examples (${d.failedParseExamples.length})`);
    lines.push('');
    for (const ex of d.failedParseExamples) {
      lines.push(`### ${ex.file}`);
      lines.push(`- timestamp: ${ex.timestamp}`);
      lines.push(`- preview: \`${(ex.preview || '').replace(/`/g, "'").slice(0, 200)}\``);
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
