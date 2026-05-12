#!/usr/bin/env node
/**
 * global-thread-report.js — Phase E
 *
 * Read the global thread index for an agent and print a human-readable report:
 *   - Total active threads across sessions
 *   - Threads spanning ≥2 sessions (the cross-session work)
 *   - Per-thread session count, status, last activity
 *
 * Usage:
 *   node scripts/global-thread-report.js [--agent main] [--status active] [--since 7d]
 *
 * Defaults:
 *   --agent  main
 *   --status all (filter to one of active|blocked|completed|fading if provided)
 *   --since  no cutoff (use --since 7d, --since 24h, --since 30d, etc.)
 */

import { readGlobalRecords } from '../dist/global/index-writer.js';
import { buildSnapshot } from '../dist/global/snapshot.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = { agent: 'main', status: undefined, since: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') args.agent = argv[++i];
    else if (a === '--status') args.status = argv[++i];
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/global-thread-report.js [--agent <name>] [--status active|blocked|completed|fading] [--since 7d|24h|30d]',
      );
      process.exit(0);
    }
  }
  return args;
}

function parseSince(s) {
  if (!s) return undefined;
  const m = /^(\d+)([dhm])$/.exec(s);
  if (!m) {
    console.error(`Bad --since format: ${s}. Use 7d, 24h, or 30m.`);
    process.exit(2);
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const factor = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000;
  return n * factor;
}

function fmtAgo(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '?';
  const delta = Date.now() - ms;
  const min = Math.floor(delta / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sinceMs = parseSince(args.since);
  const agentRoot = join(homedir(), '.openclaw', 'agents', args.agent);

  const records = readGlobalRecords(agentRoot, sinceMs ? { sinceMs } : {});
  if (records.length === 0) {
    console.log(`No global thread records found for agent "${args.agent}".`);
    console.log(`Index path: ${agentRoot}/sessions/.kasett-global-threads.jsonl`);
    return;
  }

  const snapshot = buildSnapshot(agentRoot, { records });
  const all = Object.values(snapshot.threads);
  const filtered = args.status ? all.filter((t) => t.status === args.status) : all;

  // Summary header
  console.log(`# Cross-Session Thread Report (agent: ${args.agent})`);
  console.log('');
  console.log(`Records read: ${records.length}`);
  console.log(`Total threads (canonical): ${all.length}`);
  if (sinceMs) {
    console.log(`Window: --since ${args.since} (cutoff ${new Date(Date.now() - sinceMs).toISOString()})`);
  }
  console.log('');

  // Status breakdown
  const byStatus = { active: 0, blocked: 0, completed: 0, fading: 0 };
  for (const t of all) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  console.log('## By status');
  console.log(`  active: ${byStatus.active}, blocked: ${byStatus.blocked}, completed: ${byStatus.completed}, fading: ${byStatus.fading}`);
  console.log('');

  // Cross-session work
  const crossSession = all
    .filter((t) => t.sessions.length >= 2)
    .sort((a, b) => b.sessions.length - a.sessions.length);
  console.log(`## Threads spanning ≥2 sessions: ${crossSession.length}`);
  console.log('');
  if (crossSession.length > 0) {
    for (const t of crossSession.slice(0, 20)) {
      const sessNames = t.sessions
        .map((s) => s.topic_name ?? s.session_id)
        .join(', ');
      console.log(
        `  - "${t.label}" [${t.status}] across ${t.sessions.length} sessions (last ${fmtAgo(t.last_compaction)} ago) → ${sessNames}`,
      );
    }
    console.log('');
  }

  // Per-thread detail (filtered)
  if (filtered.length > 0) {
    console.log(`## Threads (${args.status ? `status=${args.status}, ` : ''}${filtered.length} total)`);
    console.log('');
    const sorted = [...filtered].sort((a, b) =>
      (b.last_compaction || '').localeCompare(a.last_compaction || ''),
    );
    for (const t of sorted.slice(0, 50)) {
      console.log(
        `  - ${t.canonical_id} | ${t.status} | ${t.sessions.length}s | ${fmtAgo(t.last_compaction)} ago | ${t.label}`,
      );
    }
    if (sorted.length > 50) {
      console.log(`  ... and ${sorted.length - 50} more`);
    }
  }
}

main();
