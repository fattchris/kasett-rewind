/**
 * Tests for the sidecar storage module + reader integration.
 *
 * Phase B1 (2026-05-12).
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSidecarEntry,
  readSidecar,
  findEntryForCompaction,
  sidecarPathFor,
  sidecarExists,
  type SidecarEntry,
} from '../storage/sidecar.js';
import { SessionReader } from '../storage/reader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kasett-sidecar-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(over: Partial<SidecarEntry> = {}): SidecarEntry {
  return {
    ts: '2026-05-12T14:38:00Z',
    session_id: 'test-session',
    compaction_id: 'cmp-' + Math.random().toString(36).slice(2),
    summary_rich:
      'A rich compaction summary with [THREAD_META]\nmain: x\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]',
    summary_chars: 100,
    thread_meta: { main: 'x', sub: ['idle', 'idle', 'idle'] },
    ...over,
  };
}

describe('sidecar — basic write/read', () => {
  test('writes and reads back a single entry', () => {
    const sessionFile = join(tmpDir, 'session-A.jsonl');
    const entry = makeEntry({ compaction_id: 'cmp-1' });

    const path = writeSidecarEntry(sessionFile, entry);
    assert.equal(path, `${sessionFile}.kasett-meta.jsonl`);
    assert.equal(sidecarPathFor(sessionFile), `${sessionFile}.kasett-meta.jsonl`);

    const back = readSidecar(sessionFile);
    assert.equal(back.length, 1);
    assert.equal(back[0].compaction_id, 'cmp-1');
    assert.equal(back[0].summary_rich, entry.summary_rich);
    assert.deepEqual(back[0].thread_meta, entry.thread_meta);
  });

  test('returns empty array when sidecar does not exist', () => {
    const sessionFile = join(tmpDir, 'session-missing.jsonl');
    assert.equal(sidecarExists(sessionFile), false);
    assert.deepEqual(readSidecar(sessionFile), []);
  });

  test('multiple appends preserve order', () => {
    const sessionFile = join(tmpDir, 'session-multi.jsonl');
    const ids = ['cmp-1', 'cmp-2', 'cmp-3'];
    for (const id of ids) {
      writeSidecarEntry(sessionFile, makeEntry({ compaction_id: id, summary_rich: `summary ${id}` }));
    }
    const back = readSidecar(sessionFile);
    assert.equal(back.length, 3);
    assert.deepEqual(back.map((e) => e.compaction_id), ids);
    assert.equal(back[0].summary_rich, 'summary cmp-1');
    assert.equal(back[2].summary_rich, 'summary cmp-3');
  });

  test('skips malformed lines without throwing', () => {
    const sessionFile = join(tmpDir, 'session-corrupt.jsonl');
    writeSidecarEntry(sessionFile, makeEntry({ compaction_id: 'cmp-good' }));
    // Append garbage by hand
    const sidecarPath = sidecarPathFor(sessionFile);
    writeFileSync(sidecarPath, '{ this is not json\n', { flag: 'a' });
    writeSidecarEntry(sessionFile, makeEntry({ compaction_id: 'cmp-good-2' }));

    const back = readSidecar(sessionFile);
    assert.equal(back.length, 2);
    assert.deepEqual(back.map((e) => e.compaction_id), ['cmp-good', 'cmp-good-2']);
  });

  test('findEntryForCompaction matches by compaction_id', () => {
    const sessionFile = join(tmpDir, 'session-find.jsonl');
    writeSidecarEntry(sessionFile, makeEntry({ compaction_id: 'A' }));
    writeSidecarEntry(sessionFile, makeEntry({ compaction_id: 'B' }));
    writeSidecarEntry(sessionFile, makeEntry({ compaction_id: 'C' }));
    const found = findEntryForCompaction(sessionFile, 'B');
    assert.ok(found);
    assert.equal(found!.compaction_id, 'B');
    assert.equal(findEntryForCompaction(sessionFile, 'missing'), undefined);
  });

  test('findEntryForCompaction also matches by stub_id', () => {
    const sessionFile = join(tmpDir, 'session-stubid.jsonl');
    writeSidecarEntry(
      sessionFile,
      makeEntry({ compaction_id: 'C-1', stub_id: 'stub-uuid-1' }),
    );
    const found = findEntryForCompaction(sessionFile, 'stub-uuid-1');
    assert.ok(found);
    assert.equal(found!.compaction_id, 'C-1');
  });

  test('sidecarExists reports false for empty file, true for non-empty', () => {
    const sessionFile = join(tmpDir, 'session-empty.jsonl');
    const sidecarPath = sidecarPathFor(sessionFile);
    writeFileSync(sidecarPath, '');
    assert.equal(sidecarExists(sessionFile), false);
    writeFileSync(sidecarPath, '{"compaction_id":"x","summary_rich":"y"}\n');
    assert.equal(sidecarExists(sessionFile), true);
  });
});

describe('SessionReader — sidecar integration', () => {
  test('reader prefers sidecar rich summary over JSONL stub', async () => {
    const sessionFile = join(tmpDir, 'session-A.jsonl');
    const stubId = '11111111-2222-3333-4444-555555555555';
    const stub = `[KASETT_STUB::${stubId}]\n[THREAD_META]\nmain: stub-main\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]`;

    // Write OC-style JSONL with a stub at top-level summary
    const jsonl =
      JSON.stringify({ type: 'session', id: 'test', cwd: '/tmp' }) + '\n' +
      JSON.stringify({
        type: 'compaction',
        id: 'cmp_001',
        timestamp: '2026-05-12T14:38:00Z',
        summary: stub,
      }) + '\n';
    writeFileSync(sessionFile, jsonl);

    // Sidecar carries the rich version
    writeSidecarEntry(sessionFile, makeEntry({
      compaction_id: stubId,
      stub_id: stubId,
      summary_rich: 'RICH SUMMARY [THREAD_META]\nmain: rich-main\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]',
      thread_meta: { main: 'rich-main', sub: ['idle', 'idle', 'idle'] },
    }));

    const reader = new SessionReader();
    const summaries = await reader.readLastNSummaries(sessionFile, 3);
    assert.equal(summaries.length, 1);
    assert.ok(summaries[0].includes('RICH SUMMARY'), 'should prefer sidecar rich summary');
    assert.ok(!summaries[0].includes('[KASETT_STUB::'), 'should not include stub marker');

    const latest = await reader.readLatestSummary(sessionFile);
    assert.ok(latest?.includes('RICH SUMMARY'));

    const meta = await reader.readLatestMeta(sessionFile);
    assert.equal(meta?.main, 'rich-main');
  });

  test('reader falls back to JSONL when sidecar missing (legacy compat)', async () => {
    const sessionFile = join(tmpDir, 'session-legacy.jsonl');
    const richInline =
      'Legacy rich summary [THREAD_META]\nmain: legacy-main\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]';

    const jsonl =
      JSON.stringify({ type: 'session', id: 'test', cwd: '/tmp' }) + '\n' +
      JSON.stringify({
        type: 'compaction',
        id: 'cmp_001',
        summary: richInline,
      }) + '\n';
    writeFileSync(sessionFile, jsonl);

    const reader = new SessionReader();
    const meta = await reader.readLatestMeta(sessionFile);
    assert.equal(meta?.main, 'legacy-main', 'legacy [THREAD_META] inline parsing must still work');

    const summaries = await reader.readLastNSummaries(sessionFile, 3);
    assert.equal(summaries.length, 1);
    assert.ok(summaries[0].includes('legacy-main'));
  });

  test('reader handles top-level summary field (real OC layout)', async () => {
    // Phase A confirmed real OC stores summary at top-level, not data.summary
    const sessionFile = join(tmpDir, 'session-real.jsonl');
    const jsonl = JSON.stringify({
      type: 'compaction',
      id: 'cmp_real',
      summary: 'Real OC summary [THREAD_META]\nmain: real\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]',
    }) + '\n';
    writeFileSync(sessionFile, jsonl);

    const reader = new SessionReader();
    const meta = await reader.readLatestMeta(sessionFile);
    assert.equal(meta?.main, 'real');
  });

  test('reader handles legacy data.summary field (fixture layout)', async () => {
    const sessionFile = join(tmpDir, 'session-fixture.jsonl');
    const jsonl = JSON.stringify({
      type: 'compaction',
      id: 'cmp_fix',
      data: {
        summary: 'Fixture summary [THREAD_META]\nmain: fixture\nsub1: idle\nsub2: idle\nsub3: idle\n[/THREAD_META]',
      },
    }) + '\n';
    writeFileSync(sessionFile, jsonl);

    const reader = new SessionReader();
    const meta = await reader.readLatestMeta(sessionFile);
    assert.equal(meta?.main, 'fixture');
  });
});
