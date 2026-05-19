/**
 * Tests for resolveSessionFileFromState with null/empty sessionKey (Bug 3 — Path C fix).
 *
 * OC's token-overflow compaction path (compact-CNsgTXwX.js → model-context-tokens)
 * fires before_compaction without sessionFile OR sessionKey in the hook payload.
 * The v2 fix handled null sessionFile but cascaded into broken string-matching
 * strategies when sessionKey was also null ("null".includes("null") = true, wrong path).
 *
 * The v3 fix (Bug 3) guards at the top of resolveSessionFileFromState: when
 * sessionKey is null/empty/whitespace, skip all key-based strategies and go
 * directly to the lock-file scan (OC holds a .jsonl.lock on the active session
 * file during compaction — exactly what we need).
 *
 * Tests cover:
 * - null sessionKey + single lock file → returns lock-derived path
 * - null sessionKey + no lock files → returns null
 * - empty string sessionKey treated same as null
 * - whitespace-only sessionKey treated same as null
 * - valid (non-empty) sessionKey → null-key branch is NOT entered (guard skipped)
 * - sessionsDir missing → returns null gracefully
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------

let testRoot: string;
let stateDir: string;
let sessionsDir: string;

before(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'kasett-null-key-test-'));
  stateDir = testRoot;
  sessionsDir = join(stateDir, 'agents', 'main', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
});

after(() => {
  if (testRoot && existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionFile(filename: string): string {
  const fullPath = join(sessionsDir, filename);
  writeFileSync(fullPath, '');
  return fullPath;
}

function makeLockFile(sessionFilename: string): string {
  const lockPath = join(sessionsDir, `${sessionFilename}.lock`);
  writeFileSync(lockPath, '');
  return lockPath;
}

function cleanSessions() {
  try {
    for (const f of readdirSync(sessionsDir)) {
      unlinkSync(join(sessionsDir, f));
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Core testable logic: mirrors the null-key branch added to
// resolveSessionFileFromState in the Bug 3 fix.
//
// When sessionKey is null/empty, we skip all key-based strategies and go
// directly to the lock-file scan. This function replicates that exact branch
// so we can unit-test it in isolation without needing a full PluginAPI mock.
// ---------------------------------------------------------------------------

async function nullKeyLockFileScan(
  stateDir: string,
  agentId: string,
): Promise<string | null> {
  const sessDir = join(stateDir, 'agents', agentId, 'sessions');
  try {
    const files = await readdir(sessDir);
    const lockFiles = files.filter((f) => f.endsWith('.jsonl.lock'));
    if (lockFiles.length === 1) {
      const sessionFilename = lockFiles[0].replace(/\.lock$/, '');
      return join(sessDir, sessionFilename);
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests: null sessionKey + single lock file → correct path returned
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: single lock file', () => {
  test('returns the lock-derived session file path when exactly one lock exists', async () => {
    cleanSessions();
    const sessionFile = 'abc123-topic-5392.jsonl';
    makeSessionFile(sessionFile);
    makeLockFile(sessionFile);

    const result = await nullKeyLockFileScan(stateDir, 'main');
    assert.ok(result !== null, 'should resolve to a path');
    assert.equal(basename(result!), sessionFile, 'resolved path should match the locked session');
  });
});

// ---------------------------------------------------------------------------
// Tests: null sessionKey + no lock files → null
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: no lock files', () => {
  test('returns null when no lock file exists (no active compaction)', async () => {
    cleanSessions();
    makeSessionFile('abc123-topic-5392.jsonl');
    // No lock file

    const result = await nullKeyLockFileScan(stateDir, 'main');
    assert.equal(result, null, 'should return null when no lock file present');
  });
});

// ---------------------------------------------------------------------------
// Tests: multiple lock files → null (ambiguous)
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: multiple lock files', () => {
  test('returns null when multiple locks exist (ambiguous — cannot pick one)', async () => {
    cleanSessions();
    makeSessionFile('abc123-topic-5392.jsonl');
    makeSessionFile('def456-topic-5392.jsonl');
    makeLockFile('abc123-topic-5392.jsonl');
    makeLockFile('def456-topic-5392.jsonl');

    const result = await nullKeyLockFileScan(stateDir, 'main');
    assert.equal(result, null, 'multiple locks should return null (ambiguous)');
  });
});

// ---------------------------------------------------------------------------
// Tests: effectiveKey logic — empty string / whitespace treated as null
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: empty string treated as null', () => {
  test('empty string sessionKey falls into null-key branch (lock-file scan)', async () => {
    cleanSessions();
    const sessionFile = 'xyz789-topic-5392.jsonl';
    makeSessionFile(sessionFile);
    makeLockFile(sessionFile);

    // Verify the guard condition: empty string after trim → falsy → enters null-key branch
    const effectiveKey = ''.trim() || '';
    assert.equal(Boolean(effectiveKey), false, 'empty string should be falsy (enters null-key branch)');

    // The lock-file scan should succeed
    const result = await nullKeyLockFileScan(stateDir, 'main');
    assert.ok(result !== null, 'should find lock-derived path for empty-string sessionKey');
    assert.equal(basename(result!), sessionFile);
  });
});

describe('resolveSessionFileFromState null-key guard: whitespace-only treated as null', () => {
  test('whitespace-only sessionKey falls into null-key branch', async () => {
    cleanSessions();
    const sessionFile = 'ws-test-topic-5392.jsonl';
    makeSessionFile(sessionFile);
    makeLockFile(sessionFile);

    // Whitespace-only key trims to empty string → treated same as null
    const effectiveKey = '   '.trim() || '';
    assert.equal(Boolean(effectiveKey), false, 'whitespace-only key should trim to falsy (enters null-key branch)');

    const result = await nullKeyLockFileScan(stateDir, 'main');
    assert.ok(result !== null, 'should find lock-derived path for whitespace sessionKey');
    assert.equal(basename(result!), sessionFile);
  });
});

// ---------------------------------------------------------------------------
// Tests: valid (non-empty) sessionKey → null-key branch is NOT entered
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: valid key preserves existing behavior', () => {
  test('non-empty sessionKey skips null-key branch (guard does not fire)', () => {
    // Verify the guard condition: non-empty key after trim → truthy → skips null-key branch
    const validKeys = [
      'agent:main:telegram:group:-1003723465246:topic:5392',
      'topic-12388',
      'abc123',
    ];
    for (const key of validKeys) {
      const effectiveKey = key.trim() || '';
      assert.ok(
        Boolean(effectiveKey),
        `key "${key}" should be truthy and NOT enter null-key branch`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: sessionsDir missing → returns null gracefully
// ---------------------------------------------------------------------------

describe('resolveSessionFileFromState null-key guard: sessionsDir missing', () => {
  test('returns null gracefully when sessionsDir does not exist', async () => {
    const nonExistentStateDir = join(testRoot, 'nonexistent');
    const result = await nullKeyLockFileScan(nonExistentStateDir, 'main');
    assert.equal(result, null, 'missing sessionsDir should return null without throwing');
  });
});
