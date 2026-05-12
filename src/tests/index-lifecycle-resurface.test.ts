/**
 * Phase G — Lifecycle event re-surfacing.
 *
 * Tests that the wiring from sidecar → reader → steering prompt is intact:
 * lifecycle events (renames/merges/splits) detected at compaction N-1 and
 * stored on the sidecar are re-read at compaction N and surfaced in the
 * steering prompt as continuity hints.
 *
 * This proves the production path that `buildCompactionContext` exercises:
 *   1. Worker writes sidecar entry with `lifecycle_events: [...]` at C{N-1}.
 *   2. At C{N}, `SessionReader.readLatestLifecycleEvents(sessionFile)` returns them.
 *   3. They're passed to `buildSteeringPrompt({ recentLifecycle })`.
 *   4. The resulting prompt instructs the LLM to keep IDs stable across the rename.
 *
 * `buildCompactionContext` itself is not directly invoked here (it requires
 * a full PluginAPI mock). The pure-function half of its work \u2014 lifecycle
 * loading and steering \u2014 is what these tests cover; the wiring code in
 * `buildCompactionContext` is a 3-line `try/await/pass-through` whose
 * correctness is enforced by the type system.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeSidecarEntry, type SidecarEntry } from '../storage/sidecar.js';
import { SessionReader } from '../storage/reader.js';
import { buildSteeringPrompt } from '../threads/steering.js';
import { weightSummaries } from '../threads/weight.js';
import type { LifecycleEvent } from '../threads/lifecycle.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kasett-phaseg-lifecycle-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

function makeSidecarEntry(
  compactionId: string,
  over: Partial<SidecarEntry> = {},
): SidecarEntry {
  return {
    ts: '2026-05-12T14:38:00Z',
    session_id: 'phaseg-test',
    compaction_id: compactionId,
    stub_id: compactionId,
    summary_rich: 'A summary.',
    summary_chars: 10,
    schema_version: 'v3',
    ...over,
  };
}

function fakeSessionFile(): string {
  // The session file is referenced by path but its content is not required
  // for `readLatestLifecycleEvents` \u2014 the reader looks at the sidecar.
  const path = join(tmpDir, 'session-A.jsonl');
  writeFileSync(path, '');
  return path;
}

// ---------------------------------------------------------------------------

describe('readLatestLifecycleEvents', () => {
  test('returns empty array when sidecar does not exist (backward compat)', async () => {
    const reader = new SessionReader();
    const sessionFile = join(tmpDir, 'session-no-sidecar.jsonl');
    writeFileSync(sessionFile, '');
    const events = await reader.readLatestLifecycleEvents(sessionFile);
    assert.deepEqual(events, []);
  });

  test('returns empty array when sidecar exists but has no lifecycle_events', async () => {
    const sessionFile = fakeSessionFile();
    writeSidecarEntry(sessionFile, makeSidecarEntry('cmp-1'));
    const reader = new SessionReader();
    const events = await reader.readLatestLifecycleEvents(sessionFile);
    assert.deepEqual(events, []);
  });

  test('returns events from the most recent sidecar entry that has them', async () => {
    const sessionFile = fakeSessionFile();
    // Older entry: no lifecycle events.
    writeSidecarEntry(sessionFile, makeSidecarEntry('cmp-1'));
    // Middle entry: has rename + merge.
    const events: LifecycleEvent[] = [
      {
        kind: 'renamed',
        from_id: 'old-thread',
        from_label: 'Old thread label',
        to_id: 'new-thread',
        to_label: 'New thread label',
        strategy: 'semantic',
        confidence: 0.92,
      },
      {
        kind: 'merged',
        from_ids: ['a', 'b'],
        into_id: 'combined',
      },
    ];
    writeSidecarEntry(
      sessionFile,
      makeSidecarEntry('cmp-2', { lifecycle_events: events }),
    );
    // Newer entry: no lifecycle events. Reader should still return cmp-2's
    // events because it scans backward and returns the most recent NON-EMPTY
    // lifecycle list.
    writeSidecarEntry(sessionFile, makeSidecarEntry('cmp-3'));

    const reader = new SessionReader();
    const got = await reader.readLatestLifecycleEvents(sessionFile);
    assert.equal(got.length, 2);
    assert.equal(got[0].kind, 'renamed');
    assert.equal(got[1].kind, 'merged');
  });
});

describe('lifecycle events flow into the steering prompt', () => {
  test('renamed events are surfaced as a "Recent thread lifecycle" section', async () => {
    const sessionFile = fakeSessionFile();
    const events: LifecycleEvent[] = [
      {
        kind: 'renamed',
        from_id: 'oauth-setup',
        from_label: 'OAuth setup',
        to_id: 'oauth-flow',
        to_label: 'OAuth flow',
        strategy: 'semantic',
        confidence: 0.88,
      },
    ];
    writeSidecarEntry(
      sessionFile,
      makeSidecarEntry('cmp-1', { lifecycle_events: events }),
    );

    const reader = new SessionReader();
    const recentLifecycle = await reader.readLatestLifecycleEvents(sessionFile);
    assert.equal(recentLifecycle.length, 1);

    const weighted = weightSummaries(['the most recent summary'], [1.0]);
    const prompt = buildSteeringPrompt(weighted, {
      structuredOutput: 'json',
      previousSubIds: ['oauth-flow'],
      recentLifecycle,
    });

    // Critical text from the lifecycle section must appear.
    assert.ok(
      prompt.includes('Recent thread lifecycle'),
      'steering prompt should include the lifecycle section header',
    );
    assert.ok(prompt.includes('renamed:'));
    assert.ok(prompt.includes('"oauth-setup"'));
    assert.ok(prompt.includes('"oauth-flow"'));
    assert.ok(prompt.includes('"OAuth setup"'));
  });

  test('merged + split events are surfaced as well', async () => {
    const sessionFile = fakeSessionFile();
    const events: LifecycleEvent[] = [
      {
        kind: 'merged',
        from_ids: ['build-pipeline', 'test-pipeline'],
        into_id: 'ci-pipeline',
      },
      {
        kind: 'split',
        from_id: 'auth-system',
        into_ids: ['auth-frontend', 'auth-backend'],
      },
    ];
    writeSidecarEntry(
      sessionFile,
      makeSidecarEntry('cmp-1', { lifecycle_events: events }),
    );

    const reader = new SessionReader();
    const recentLifecycle = await reader.readLatestLifecycleEvents(sessionFile);

    const weighted = weightSummaries(['summary'], [1.0]);
    const prompt = buildSteeringPrompt(weighted, {
      structuredOutput: 'json',
      previousSubIds: ['ci-pipeline', 'auth-frontend', 'auth-backend'],
      recentLifecycle,
    });

    assert.ok(prompt.includes('merged:'));
    assert.ok(prompt.includes('"build-pipeline"'));
    assert.ok(prompt.includes('"ci-pipeline"'));
    assert.ok(prompt.includes('split:'));
    assert.ok(prompt.includes('"auth-system"'));
    assert.ok(prompt.includes('"auth-frontend"'));
    assert.ok(prompt.includes('"auth-backend"'));
  });

  test('empty lifecycle list does not emit the lifecycle section', async () => {
    const sessionFile = fakeSessionFile();
    writeSidecarEntry(sessionFile, makeSidecarEntry('cmp-1'));

    const reader = new SessionReader();
    const recentLifecycle = await reader.readLatestLifecycleEvents(sessionFile);
    assert.deepEqual(recentLifecycle, []);

    const weighted = weightSummaries(['summary'], [1.0]);
    const prompt = buildSteeringPrompt(weighted, {
      structuredOutput: 'json',
      previousSubIds: ['x'],
      recentLifecycle,
    });

    // Section is gated on length>0.
    assert.ok(!prompt.includes('Recent thread lifecycle'));
  });
});
