#!/usr/bin/env node
/**
 * migrate-to-sidecar.js — one-shot migration from inline [THREAD_META] in OC
 * session JSONLs to per-session sidecar files.
 *
 * For each non-checkpoint session JSONL under SESSIONS_DIR:
 *   - Walk every compaction event
 *   - If the summary has [THREAD_META] (rich content already produced by a
 *     pre-B1 successful hot-swap, or by a legacy build), copy the summary into
 *     a sidecar entry
 *   - Compaction_id is derived from the session compaction event's `id` field
 *     when available, otherwise SHA-1 of the first 256 chars of the summary
 *   - Idempotent: if a sidecar entry with the same compaction_id already
 *     exists, skip
 *
 * USAGE:
 *   node scripts/migrate-to-sidecar.js [--dry-run] [--sessions-dir <path>]
 *
 * NOT run automatically. Operator runs it manually after Phase B1 deploys.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
let SESSIONS_DIR = '/home/node/.openclaw/agents/main/sessions';
const sdIdx = args.indexOf('--sessions-dir');
if (sdIdx >= 0 && args[sdIdx + 1]) SESSIONS_DIR = args[sdIdx + 1];

const STUB_RE = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
const THREAD_META_RE = /\[THREAD_META\]\s*\n([\s\S]*?)\n?\s*\[\/THREAD_META\]/;

function parseMetaBlock(block) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  let main = '';
  const subs = [];
  for (const line of lines) {
    const m = line.match(/^main:\s*(.+)/i);
    if (m) { main = m[1].trim(); continue; }
    const s = line.match(/^sub[123]:\s*(.+)/i);
    if (s) subs.push(s[1].trim());
  }
  if (!main || subs.length !== 3) return null;
  return { main, sub: [subs[0], subs[1], subs[2]] };
}

function parseSummary(raw) {
  const m = raw.match(THREAD_META_RE);
  if (!m) return { meta: null };
  return { meta: parseMetaBlock(m[1]) };
}

function compactionIdFor(obj, summary) {
  // Stub UUID first (if present, kasett-tagged event)
  const stubMatch = summary.match(STUB_RE);
  if (stubMatch) return { id: stubMatch[1], stubId: stubMatch[1] };
  // OC event id
  if (typeof obj.id === 'string' && obj.id) return { id: obj.id, stubId: undefined };
  // Fallback: SHA-1 of summary head
  const hash = createHash('sha1').update(summary.slice(0, 256)).digest('hex');
  return { id: `sha1:${hash}`, stubId: undefined };
}

function readExistingSidecarIds(sidecarPath) {
  const ids = new Set();
  if (!existsSync(sidecarPath)) return ids;
  try {
    const raw = readFileSync(sidecarPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (typeof obj.compaction_id === 'string') ids.add(obj.compaction_id);
        if (typeof obj.stub_id === 'string') ids.add(obj.stub_id);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return ids;
}

function processSessionFile(sessionFile) {
  const sidecarPath = `${sessionFile}.kasett-meta.jsonl`;
  const existing = readExistingSidecarIds(sidecarPath);

  let scanned = 0;
  let candidates = 0;
  let toAppend = 0;
  const toWrite = [];

  let raw;
  try {
    raw = readFileSync(sessionFile, 'utf-8');
  } catch {
    return { scanned: 0, candidates: 0, appended: 0 };
  }

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (!obj || obj.type !== 'compaction') continue;
    scanned++;

    // Real OC stores summary at top level; legacy at data.summary
    const summary = (typeof obj.summary === 'string')
      ? obj.summary
      : (obj.data && typeof obj.data.summary === 'string' ? obj.data.summary : null);
    if (!summary) continue;
    if (!summary.includes('[THREAD_META]')) continue;
    if (summary.includes('[KASETT_STUB::')) continue; // stub-only events have no rich content to migrate

    candidates++;
    const { id: cid, stubId } = compactionIdFor(obj, summary);
    if (existing.has(cid) || (stubId && existing.has(stubId))) continue;

    const { meta } = parseSummary(summary);
    const entry = {
      ts: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
      session_id: basename(sessionFile, '.jsonl'),
      compaction_id: cid,
      ...(stubId ? { stub_id: stubId } : {}),
      summary_rich: summary,
      summary_chars: summary.length,
      ...(meta ? { thread_meta: meta } : {}),
      debug: { migrated: true, source: 'jsonl_inline' },
    };
    toWrite.push(entry);
    existing.add(cid);
    if (stubId) existing.add(stubId);
    toAppend++;
  }

  if (toAppend > 0 && !DRY_RUN) {
    const text = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(sidecarPath, text, { flag: 'a', encoding: 'utf-8' });
  }
  return { scanned, candidates, appended: toAppend, sidecarPath };
}

function main() {
  if (!existsSync(SESSIONS_DIR)) {
    console.error(`Sessions directory not found: ${SESSIONS_DIR}`);
    process.exit(2);
  }
  const files = readdirSync(SESSIONS_DIR);
  const sessionFiles = files.filter((f) =>
    f.endsWith('.jsonl') && !f.includes('.checkpoint.') && !f.endsWith('.kasett-meta.jsonl'),
  );

  let totalScanned = 0;
  let totalCandidates = 0;
  let totalAppended = 0;
  let touched = 0;

  console.log(`migrate-to-sidecar ${DRY_RUN ? '(dry run) ' : ''}— scanning ${sessionFiles.length} session files in ${SESSIONS_DIR}`);
  for (const f of sessionFiles) {
    const path = join(SESSIONS_DIR, f);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (!stat.isFile()) continue;
    const r = processSessionFile(path);
    totalScanned += r.scanned;
    totalCandidates += r.candidates;
    totalAppended += r.appended;
    if (r.appended > 0) {
      touched++;
      console.log(`  ${DRY_RUN ? '[would write]' : '[wrote]'} ${r.appended} entries  ${f}`);
    }
  }

  console.log('---');
  console.log(`scanned compactions: ${totalScanned}`);
  console.log(`migration candidates: ${totalCandidates}`);
  console.log(`entries ${DRY_RUN ? 'would-append' : 'appended'}: ${totalAppended}`);
  console.log(`session files touched: ${touched}`);
}

main();
