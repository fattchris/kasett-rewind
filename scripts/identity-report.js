#!/usr/bin/env node
// scripts/identity-report.js
//
// Phase D — Per-session and aggregate report of thread lifecycle events
// recorded in kasett sidecars.
//
// What it shows
//   - For each compaction with `lifecycle_events`: a per-kind tally
//     (created / completed / blocked / renamed / merged / split)
//   - Per-session aggregates
//   - Cross-session aggregate including a "rename rate" (renames per
//     compaction). High rename rate = LLM not following continuity hints
//     well = a quality signal we can track day over day.
//
// Usage
//   node scripts/identity-report.js [--dir <sessions-dir>] [--days N]
//
// Defaults to scanning ~/.openclaw/agents/main/sessions/*.kasett-meta.jsonl
// for the last 7 days of mtime.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_SESSIONS_DIR = join(homedir(), '.openclaw/agents/main/sessions');

function parseArgs(argv) {
  const out = { dir: DEFAULT_SESSIONS_DIR, days: 7 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--days') out.days = Number.parseInt(argv[++i], 10) || 7;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/identity-report.js [--dir <sessions-dir>] [--days N]');
      process.exit(0);
    }
  }
  return out;
}

function readSidecarLines(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // ignore malformed
    }
  }
  return out;
}

function countEvents(events) {
  const tally = {
    created: 0,
    completed: 0,
    blocked: 0,
    renamed: 0,
    merged: 0,
    split: 0,
  };
  for (const e of events ?? []) {
    if (e && typeof e.kind === 'string' && e.kind in tally) tally[e.kind] += 1;
  }
  return tally;
}

function fmtTally(t) {
  const parts = [];
  for (const k of ['created', 'completed', 'blocked', 'renamed', 'merged', 'split']) {
    if (t[k] > 0) parts.push(`${k}=${t[k]}`);
  }
  return parts.length === 0 ? '(none)' : parts.join(' ');
}

function main() {
  const { dir, days } = parseArgs(process.argv);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.kasett-meta.jsonl'));
  } catch (err) {
    console.error(`identity-report: cannot read ${dir}: ${err.message}`);
    process.exit(1);
  }

  const aggregate = {
    sessions_seen: 0,
    sessions_with_lifecycle: 0,
    compactions_seen: 0,
    compactions_with_lifecycle: 0,
    tally: {
      created: 0,
      completed: 0,
      blocked: 0,
      renamed: 0,
      merged: 0,
      split: 0,
    },
  };

  console.log(`# Kasett identity report — ${dir}`);
  console.log(`# window: last ${days} days`);
  console.log('');

  for (const f of files) {
    const path = join(dir, f);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.mtimeMs < cutoffMs) continue;

    const entries = readSidecarLines(path);
    if (entries.length === 0) continue;

    aggregate.sessions_seen += 1;
    aggregate.compactions_seen += entries.length;
    let sessionHasLifecycle = false;
    const sessionTally = {
      created: 0,
      completed: 0,
      blocked: 0,
      renamed: 0,
      merged: 0,
      split: 0,
    };
    let sessionCompactionsWithLifecycle = 0;

    for (const e of entries) {
      if (Array.isArray(e.lifecycle_events) && e.lifecycle_events.length > 0) {
        sessionCompactionsWithLifecycle += 1;
        sessionHasLifecycle = true;
        const t = countEvents(e.lifecycle_events);
        for (const k of Object.keys(sessionTally)) sessionTally[k] += t[k];
      }
    }

    aggregate.compactions_with_lifecycle += sessionCompactionsWithLifecycle;
    if (sessionHasLifecycle) aggregate.sessions_with_lifecycle += 1;
    for (const k of Object.keys(sessionTally)) aggregate.tally[k] += sessionTally[k];

    console.log(`## ${f}`);
    console.log(
      `  compactions=${entries.length} with_lifecycle=${sessionCompactionsWithLifecycle} ${fmtTally(sessionTally)}`,
    );
  }

  console.log('');
  console.log('## Aggregate');
  console.log(`  sessions_seen=${aggregate.sessions_seen}`);
  console.log(`  sessions_with_lifecycle=${aggregate.sessions_with_lifecycle}`);
  console.log(`  compactions_seen=${aggregate.compactions_seen}`);
  console.log(`  compactions_with_lifecycle=${aggregate.compactions_with_lifecycle}`);
  console.log(`  events: ${fmtTally(aggregate.tally)}`);
  if (aggregate.compactions_with_lifecycle > 0) {
    const renamesPer = (
      aggregate.tally.renamed / aggregate.compactions_with_lifecycle
    ).toFixed(2);
    console.log(`  rename_rate (per compaction with lifecycle): ${renamesPer}`);
    if (aggregate.tally.renamed / Math.max(1, aggregate.compactions_with_lifecycle) > 0.5) {
      console.log(
        '  ⚠️  high rename rate — LLM may not be reusing stable IDs reliably',
      );
    }
  }
}

main();
