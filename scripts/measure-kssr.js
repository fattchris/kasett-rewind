#!/usr/bin/env node
/**
 * measure-kssr.js — Empirical KSSR (Key State Survival Rate) for a session.
 *
 * Reads:
 *   - <session>.jsonl                             (OC session)
 *   - <session>.jsonl.kasett-meta.jsonl           (kasett sidecar)
 *
 * For each compaction event in the sidecar that has `key_state_candidates`
 * (the detected pre-compaction set) and `thread_meta_v3.key_state` (the
 * LLM-preserved set), reports:
 *
 *     KSSR = preserved / detected
 *
 * Computed both per-compaction and aggregated across the session. Compares
 * by exact (kind, value) match — KSSR is about verbatim survival.
 *
 * Usage:
 *
 *     node scripts/measure-kssr.js <session-jsonl-path> [--json]
 *     node scripts/measure-kssr.js --sidecar <sidecar-path>
 *
 * The first form derives the sidecar path automatically; the second uses
 * a sidecar directly (useful when the session JSONL has been moved).
 *
 * Output (default plain text):
 *
 *     === KSSR for <session_id> ===
 *     Compactions analyzed: 12
 *     Aggregate KSSR: 73% (88 preserved / 121 detected)
 *
 *     Per-compaction:
 *       2026-05-12T...  v3  detected=15 preserved=11 KSSR=73%
 *       ...
 *
 * Output (with --json): the per-compaction array plus aggregate fields.
 */

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: node scripts/measure-kssr.js <session.jsonl> [--json]');
  console.error('       node scripts/measure-kssr.js --sidecar <sidecar.jsonl> [--json]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { json: false, session: null, sidecar: null };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--sidecar') args.sidecar = argv[++i];
    else if (a === '-h' || a === '--help') usage();
    else positional.push(a);
  }
  if (!args.sidecar && positional.length > 0) {
    args.session = positional[0];
  }
  if (!args.session && !args.sidecar) usage();
  return args;
}

function readSidecarLines(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) {
    console.error(`Sidecar not found: ${sidecarPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(sidecarPath, 'utf-8');
  const entries = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

function key(e) {
  return `${e.kind}\x00${e.value}`;
}

function analyzeEntry(entry) {
  const detected = Array.isArray(entry.key_state_candidates)
    ? entry.key_state_candidates
    : [];
  const preserved =
    entry.thread_meta_v3 && Array.isArray(entry.thread_meta_v3.key_state)
      ? entry.thread_meta_v3.key_state
      : [];

  const detectedSet = new Set(detected.map(key));
  const preservedSet = new Set(preserved.map(key));

  // KSSR = how many of the DETECTED candidates survived into preserved
  let survivors = 0;
  for (const k of detectedSet) {
    if (preservedSet.has(k)) survivors++;
  }

  // The LLM may also ADD values not in detected (preferred behavior — it
  // saw something the regex missed). Track separately.
  let llmAdded = 0;
  for (const k of preservedSet) {
    if (!detectedSet.has(k)) llmAdded++;
  }

  const denom = detectedSet.size;
  const kssr = denom > 0 ? survivors / denom : null;

  return {
    ts: entry.ts,
    schema_version: entry.schema_version || 'v1',
    detected: detectedSet.size,
    preserved: preservedSet.size,
    survivors,
    llm_added: llmAdded,
    kssr,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const sidecarPath = args.sidecar
    ? path.resolve(args.sidecar)
    : `${path.resolve(args.session)}.kasett-meta.jsonl`;

  const entries = readSidecarLines(sidecarPath);
  const sessionId = entries[0]?.session_id || path.basename(sidecarPath);

  const perCompaction = entries.map(analyzeEntry);

  let totalDetected = 0;
  let totalSurvivors = 0;
  let totalPreserved = 0;
  let totalAdded = 0;
  for (const r of perCompaction) {
    totalDetected += r.detected;
    totalSurvivors += r.survivors;
    totalPreserved += r.preserved;
    totalAdded += r.llm_added;
  }
  const aggKssr = totalDetected > 0 ? totalSurvivors / totalDetected : null;

  const result = {
    session_id: sessionId,
    sidecar: sidecarPath,
    compactions: perCompaction.length,
    aggregate: {
      detected: totalDetected,
      preserved: totalPreserved,
      survivors: totalSurvivors,
      llm_added: totalAdded,
      kssr: aggKssr,
    },
    per_compaction: perCompaction,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Plain text
  const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
  console.log(`=== KSSR for ${sessionId} ===`);
  console.log(`Sidecar: ${sidecarPath}`);
  console.log(`Compactions analyzed: ${perCompaction.length}`);
  console.log(
    `Aggregate KSSR: ${pct(aggKssr)} (${totalSurvivors} preserved / ${totalDetected} detected; ${totalAdded} LLM-added not in detector)`,
  );
  console.log('');
  if (perCompaction.length > 0) {
    console.log('Per-compaction:');
    console.log('  ts                              schema   det  pres  surv  add  KSSR');
    for (const r of perCompaction) {
      const ts = String(r.ts).padEnd(28);
      const sv = String(r.schema_version).padEnd(6);
      const det = String(r.detected).padStart(4);
      const pres = String(r.preserved).padStart(5);
      const surv = String(r.survivors).padStart(5);
      const add = String(r.llm_added).padStart(4);
      const k = pct(r.kssr).padStart(5);
      console.log(`  ${ts} ${sv}  ${det} ${pres} ${surv} ${add}  ${k}`);
    }
  }
}

main();
