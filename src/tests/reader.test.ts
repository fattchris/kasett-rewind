import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionReader, KasettError } from '../storage/reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('SessionReader', () => {
  const reader = new SessionReader();

  describe('readCompactionEvents', () => {
    test('reads compaction events with kaspiett meta', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const events = await reader.readCompactionEvents(filePath);

      assert.equal(events.length, 3);

      // First compaction
      assert.equal(events[0].type, 'compaction');
      assert.ok(events[0].data.kaspiett);
      assert.equal(
        events[0].data.kaspiett.main,
        'building OAuth2 authentication system for MoltAI platform',
      );
      assert.equal(events[0].data.kaspiett.sub.length, 3);
      assert.equal(events[0].data.kaspiett.sub[0], 'setting up Google + GitHub federation');

      // Second compaction
      assert.ok(events[1].data.kaspiett);
      assert.equal(
        events[1].data.kaspiett.sub[1],
        'adding rate limiting to token endpoint',
      );

      // Third compaction
      assert.ok(events[2].data.kaspiett);
      assert.equal(
        events[2].data.kaspiett.sub[0],
        'completing GitHub OAuth integration',
      );
    });

    test('reads plain compaction events (no kaspiett)', async () => {
      const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
      const events = await reader.readCompactionEvents(filePath);

      assert.equal(events.length, 2);
      assert.equal(events[0].data.kaspiett, undefined);
      assert.equal(events[1].data.kaspiett, undefined);
      assert.ok(events[0].data.summary.includes('CI/CD pipeline'));
      assert.ok(events[1].data.summary.includes('GitHub Actions'));
    });

    test('reads mixed session (plain + kaspiett)', async () => {
      const filePath = join(fixturesDir, 'session-mixed.jsonl');
      const events = await reader.readCompactionEvents(filePath);

      assert.equal(events.length, 2);
      assert.equal(events[0].data.kaspiett, undefined);
      assert.ok(events[0].data.summary.includes('notification service'));

      assert.ok(events[1].data.kaspiett);
      assert.equal(
        events[1].data.kaspiett!.main,
        'refactoring notification service to event-driven architecture',
      );
    });

    test('throws KasettError for non-existent file', async () => {
      await assert.rejects(
        () => reader.readCompactionEvents('/nonexistent/path.jsonl'),
        (err: unknown) => {
          assert.ok(err instanceof KasettError);
          assert.equal(err.code, 'READ_ERROR');
          return true;
        },
      );
    });
  });

  describe('readLastNWithMeta', () => {
    test('returns last N events with kaspiett meta', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const events = await reader.readLastNWithMeta(filePath, 2);

      assert.equal(events.length, 2);
      assert.ok(events[0].data.kaspiett);
      assert.ok(events[1].data.kaspiett);
      // Should be the last 2 (cmp_002, cmp_003)
      assert.ok(events[1].data.kaspiett!.sub[0].includes('GitHub OAuth'));
    });

    test('returns all when N exceeds available', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const events = await reader.readLastNWithMeta(filePath, 10);
      assert.equal(events.length, 3);
    });

    test('returns empty for N=0', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const events = await reader.readLastNWithMeta(filePath, 0);
      assert.equal(events.length, 0);
    });

    test('skips events without kaspiett meta', async () => {
      const filePath = join(fixturesDir, 'session-mixed.jsonl');
      const events = await reader.readLastNWithMeta(filePath, 5);

      // Only one event has kaspiett
      assert.equal(events.length, 1);
      assert.ok(events[0].data.kaspiett);
    });
  });

  describe('readLatestMeta', () => {
    test('returns most recent thread meta', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const meta = await reader.readLatestMeta(filePath);

      assert.ok(meta);
      assert.equal(meta.main, 'building OAuth2 authentication system for MoltAI platform');
      assert.equal(meta.sub[0], 'completing GitHub OAuth integration');
    });

    test('returns null when no kaspiett meta exists', async () => {
      const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
      const meta = await reader.readLatestMeta(filePath);
      assert.equal(meta, null);
    });
  });
});
