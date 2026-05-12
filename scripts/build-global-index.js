#!/usr/bin/env node
/**
 * build-global-index.js — Phase E migration
 *
 * Bootstrap the global thread index from existing per-session sidecars.
 * Scans every `*.jsonl.kasett-meta.jsonl` file under the agent's sessions
 * directory and replays each compaction's sub-threads into the global index.
 *
 * Idempotent: dedup by (ts, session_id, thread_id, is_main). Records already
 * present in the index are skipped. Safe to run multiple times.
 *
 * Usage:
 *   node scripts/build-global-index.js [--agent main] [--dry-run]
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  appendGlobalRecord,
  readGlobalRecords,
} from '../dist/global/index-writer.js';
import { findCanonicalThread } from '../dist/global/matcher.js';
import { refreshSnapshot } from '../dist/global/snapshot.js';

function parseArgs(argv) {
  const args = { agent: 'main', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') args.agent = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/build-global-index.js [--agent <name>] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

function listSidecars(sessionsDir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith('.jsonl.kasett-meta.jsonl')) continue;
    const full = join(sessionsDir, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

function readSidecarFile(path) {
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
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object' && parsed.summary_rich) {
        out.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function dedupKey(rec) {
  return `${rec.ts}|${rec.session_id}|${rec.thread_id}|${rec.is_main ? 1 : 0}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agentRoot = join(homedir(), '.openclaw', 'agents', args.agent);
  const sessionsDir = join(agentRoot, 'sessions');

  console.log(`# Build Global Index — agent=${args.agent}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`Sessions dir: ${sessionsDir}`);

  const sidecars = listSidecars(sessionsDir);
  console.log(`Found ${sidecars.length} sidecar file(s).`);
  if (sidecars.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  // Build dedup set from existing records
  const existing = readGlobalRecords(agentRoot);
  const seen = new Set(existing.map(dedupKey));
  console.log(`Existing global records: ${existing.length} (${seen.size} unique keys).`);

  let scanned = 0;
  let written = 0;
  let skipped = 0;

  // Process sidecars oldest-first by mtime so canonical resolution mirrors
  // worker behavior at write time. Within a sidecar, entries are already
  // in chronological order.
  sidecars.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

  for (const path of sidecars) {
    const entries = readSidecarFile(path);
    const sessionId = path
      .split('/')
      .pop()
      .replace(/\.jsonl\.kasett-meta\.jsonl$/, '');

    for (const e of entries) {
      scanned += 1;
      const ts = e.ts || new Date().toISOString();
      const schema = e.schema_version || (e.thread_meta_v3 ? 'v3' : e.thread_meta_v2 ? 'v2' : 'v1');
      const meta = e.thread_meta_v3 || e.thread_meta_v2;

      // For v1-only entries we don't have ids/statuses — skip (they
      // wouldn't survive the cross-session matcher anyway, and v1 entries
      // are pre-Phase B2 legacy).
      if (!meta || !Array.isArray(meta.sub) || meta.sub.length === 0) {
        if (!meta && !e.thread_meta) {
          skipped += 1;
        }
        continue;
      }

      // Sub-threads
      for (const sub of meta.sub) {
        const rec = {
          ts,
          agent_id: args.agent,
          session_id: sessionId,
          thread_id: sub.id,
          label: sub.label,
          status: sub.status,
          schema_version: schema,
        };
        const key = dedupKey(rec);
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }

        // Resolve canonical against records we've already replayed
        const seedRecords = readGlobalRecords(agentRoot);
        const m = findCanonicalThread(
          { thread_id: sub.id, label: sub.label },
          seedRecords,
        );
        if (m.canonical_id) rec.canonical_id = m.canonical_id;
        else rec.canonical_id = sub.id;
        if (m.contributing_record?.ts_first_seen) {
          rec.ts_first_seen = m.contributing_record.ts_first_seen;
        } else if (m.contributing_record?.ts) {
          rec.ts_first_seen = m.contributing_record.ts;
        }

        if (args.dryRun) {
          written += 1;
        } else {
          const result = appendGlobalRecord(agentRoot, rec);
          if (result.written) {
            written += 1;
            seen.add(key);
          }
        }
      }

      // Main thread as synthetic record
      if (meta.main) {
        const mainRec = {
          ts,
          agent_id: args.agent,
          session_id: sessionId,
          thread_id: `${sessionId}::main`,
          label: meta.main,
          status: 'active',
          schema_version: schema,
          is_main: true,
        };
        const key = dedupKey(mainRec);
        if (seen.has(key)) {
          skipped += 1;
        } else {
          const seedRecords = readGlobalRecords(agentRoot);
          const m = findCanonicalThread(
            { thread_id: mainRec.thread_id, label: mainRec.label },
            seedRecords,
          );
          mainRec.canonical_id = m.canonical_id ?? mainRec.thread_id;
          if (m.contributing_record?.ts_first_seen) {
            mainRec.ts_first_seen = m.contributing_record.ts_first_seen;
          } else if (m.contributing_record?.ts) {
            mainRec.ts_first_seen = m.contributing_record.ts;
          }
          if (args.dryRun) {
            written += 1;
          } else {
            const result = appendGlobalRecord(agentRoot, mainRec);
            if (result.written) {
              written += 1;
              seen.add(key);
            }
          }
        }
      }
    }
  }

  console.log('');
  console.log(`Sidecar entries scanned: ${scanned}`);
  console.log(`Records ${args.dryRun ? 'would be ' : ''}written: ${written}`);
  console.log(`Records skipped (dedup or v1-only): ${skipped}`);

  if (!args.dryRun && written > 0) {
    console.log('Refreshing snapshot…');
    try {
      refreshSnapshot(agentRoot);
      console.log('Snapshot refreshed.');
    } catch (e) {
      console.error(`Snapshot refresh failed: ${String(e)}`);
    }
  }
}

main().catch((err) => {
  console.error(`build-global-index failed: ${String(err)}`);
  process.exit(1);
});
