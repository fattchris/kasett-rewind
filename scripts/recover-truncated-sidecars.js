#!/usr/bin/env node
/**
 * recover-truncated-sidecars.js — Phase F migration.
 *
 * Walks every `*.kasett-meta.jsonl` under the OC sessions tree and, for each
 * entry whose `summary_rich` contains a fenced ```json``` block but whose
 * `schema_version` is missing/`v1`/`none`, runs the Phase F V3 parser repair
 * (`parseCompactionOutputBestEffort`) to extract structured data.
 *
 * If the parser succeeds at recovery (closed-fence-no-repair OR truncated
 * repair OR lenient extract), the script APPENDS a NEW entry to the same
 * sidecar file with `schema_version: 'v3-recovered'` and `recovered_from`
 * pointing at the original stub_id. Original entries are NEVER modified.
 *
 * Idempotent: if a recovery entry already exists for that stub_id, skip.
 *
 * Usage:
 *   node scripts/recover-truncated-sidecars.js              # live
 *   node scripts/recover-truncated-sidecars.js --dry-run    # just report
 *   node scripts/recover-truncated-sidecars.js --root /path/to/agents
 *   node scripts/recover-truncated-sidecars.js --file <path>   # single file
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompactionOutputBestEffort } from '../dist/threads/parser.js';

const __filename = fileURLToPath(import.meta.url);
void __filename;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let rootArg = null;
let fileArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') rootArg = args[++i];
  else if (args[i] === '--file') fileArg = args[++i];
}

const DEFAULT_ROOT =
  process.env.HOME && fs.existsSync(path.join(process.env.HOME, '.openclaw/agents'))
    ? path.join(process.env.HOME, '.openclaw/agents')
    : '/home/node/.openclaw/agents';

function findSidecarFiles(root) {
  if (fileArg) return [fileArg];
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile() && ent.name.endsWith('.kasett-meta.jsonl')) {
        out.push(p);
      }
    }
  }
  walk(root);
  return out;
}

function readJsonl(file) {
  const lines = [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    return { lines, error: String(err) };
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      lines.push(JSON.parse(t));
    } catch {
      // skip malformed
    }
  }
  return { lines };
}

function alreadyRecovered(allEntries, originalStubId) {
  for (const e of allEntries) {
    if (
      e &&
      e.schema_version === 'v3-recovered' &&
      typeof e.recovered_from === 'string' &&
      e.recovered_from === originalStubId
    ) {
      return true;
    }
  }
  return false;
}

function isCandidate(entry) {
  if (!entry || typeof entry !== 'object') return false;
  // Skip already-recovered entries
  if (entry.schema_version === 'v3-recovered') return false;
  // Skip entries that already parsed as v3 successfully (have key_state on
  // thread_meta_v3) — those are not truncation victims
  if (
    entry.thread_meta_v3 &&
    typeof entry.thread_meta_v3 === 'object' &&
    Array.isArray(entry.thread_meta_v3.key_state) &&
    entry.thread_meta_v3.key_state.length > 0
  ) {
    return false;
  }
  // Has a summary?
  if (typeof entry.summary_rich !== 'string' || entry.summary_rich.length === 0)
    return false;
  // Contains a JSON fence opener?
  return /```(?:json|JSON|Json)\s*\n/.test(entry.summary_rich);
}

function recover(entry) {
  const parsed = parseCompactionOutputBestEffort(entry.summary_rich);
  if (parsed.version === 'v3' && parsed.metaV3) {
    return {
      ok: true,
      version: 'v3',
      metaV3: parsed.metaV3,
      metaV2: parsed.metaV2,
      metaV1: parsed.metaV1,
      errors: parsed.errors,
    };
  }
  if (parsed.version === 'v2' && parsed.metaV2) {
    return {
      ok: true,
      version: 'v2',
      metaV3: null,
      metaV2: parsed.metaV2,
      metaV1: parsed.metaV1,
      errors: parsed.errors,
    };
  }
  return { ok: false, errors: parsed.errors };
}

function buildRecoveryEntry(original, recovered) {
  const entry = {
    ts: new Date().toISOString(),
    session_id: original.session_id,
    compaction_id: original.compaction_id,
    stub_id: original.stub_id,
    summary_rich: original.summary_rich,
    summary_chars: original.summary_chars,
    schema_version: 'v3-recovered',
    recovered_from: original.stub_id || original.compaction_id,
    recovered_at: new Date().toISOString(),
    recovered_via: recovered.version,
    recovered_errors: recovered.errors.slice(0, 6),
  };
  if (recovered.metaV1) entry.thread_meta = recovered.metaV1;
  if (recovered.metaV2) entry.thread_meta_v2 = recovered.metaV2;
  if (recovered.metaV3) entry.thread_meta_v3 = recovered.metaV3;
  if (original.key_state_candidates) {
    entry.key_state_candidates = original.key_state_candidates;
  }
  if (original.model) entry.model = original.model;
  return entry;
}

function processFile(file) {
  const { lines } = readJsonl(file);
  if (lines.length === 0) {
    return { file, skipped: 0, recovered: 0, alreadyRecovered: 0, errors: 0 };
  }
  let recoveredCount = 0;
  let alreadyCount = 0;
  let errorCount = 0;
  let skipped = 0;
  const newEntries = [];
  const recovDetails = [];

  for (const entry of lines) {
    if (!isCandidate(entry)) {
      skipped += 1;
      continue;
    }
    const stubKey = entry.stub_id || entry.compaction_id;
    if (alreadyRecovered(lines.concat(newEntries), stubKey)) {
      alreadyCount += 1;
      continue;
    }
    const rec = recover(entry);
    if (!rec.ok) {
      errorCount += 1;
      recovDetails.push({
        stub: stubKey,
        outcome: 'failed',
        errors: rec.errors.slice(0, 3),
      });
      continue;
    }
    const recoveryEntry = buildRecoveryEntry(entry, rec);
    newEntries.push(recoveryEntry);
    recoveredCount += 1;
    const ks = rec.metaV3?.key_state?.length ?? 0;
    const subs = (rec.metaV2 && rec.metaV2.sub.length) || 0;
    recovDetails.push({
      stub: stubKey,
      outcome: 'recovered',
      version: rec.version,
      sub: subs,
      key_state: ks,
    });
  }

  if (newEntries.length > 0 && !dryRun) {
    const lines = newEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(file, lines, 'utf-8');
  }

  return {
    file,
    skipped,
    recovered: recoveredCount,
    alreadyRecovered: alreadyCount,
    errors: errorCount,
    details: recovDetails,
  };
}

function main() {
  const root = rootArg || DEFAULT_ROOT;
  const files = findSidecarFiles(root);
  if (files.length === 0) {
    console.log(`No *.kasett-meta.jsonl files found under ${root}`);
    return;
  }
  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}Scanning ${files.length} sidecar file(s) under ${root}...`,
  );
  let totalRecovered = 0;
  let totalSkipped = 0;
  let totalAlready = 0;
  let totalErrors = 0;
  const fileSummaries = [];
  for (const f of files) {
    const summary = processFile(f);
    totalRecovered += summary.recovered;
    totalSkipped += summary.skipped;
    totalAlready += summary.alreadyRecovered;
    totalErrors += summary.errors;
    if (summary.recovered > 0 || summary.errors > 0) {
      fileSummaries.push(summary);
    }
  }
  console.log('');
  console.log('=== Per-file results (showing files with activity) ===');
  for (const s of fileSummaries) {
    console.log(
      `  ${path.basename(s.file)}: recovered=${s.recovered} already=${s.alreadyRecovered} errors=${s.errors} skipped=${s.skipped}`,
    );
    for (const d of s.details || []) {
      if (d.outcome === 'recovered') {
        console.log(
          `    + ${d.stub}: ${d.version} sub=${d.sub} key_state=${d.key_state}`,
        );
      } else {
        console.log(`    ! ${d.stub}: failed (${(d.errors || []).join(' | ')})`);
      }
    }
  }
  console.log('');
  console.log('=== Totals ===');
  console.log(`  files scanned:      ${files.length}`);
  console.log(`  entries recovered:  ${totalRecovered}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`  entries skipped:    ${totalSkipped}`);
  console.log(`  already recovered:  ${totalAlready}`);
  console.log(`  recovery failures:  ${totalErrors}`);
}

main();
