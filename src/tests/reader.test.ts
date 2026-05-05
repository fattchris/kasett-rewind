import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionReader } from '../storage/reader.js';
import { KasettError } from '../phase1/instructions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('SessionReader', () => {
  const reader = new SessionReader();

  describe('readCompactionSummaries', () => {
    test('reads kasett-enriched compaction events', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const summaries = await reader.readCompactionSummaries(filePath);

      assert.equal(summaries.length, 2);

      // First compaction
      assert.equal(summaries[0].windowIndex, 0);
      assert.equal(summaries[0].windowTotal, 2);
      assert.equal(summaries[0].timestamp, '2026-05-05T07:00:00Z');
      assert.equal(
        summaries[0].threadSnapshot.mainThread,
        'Building OAuth2 authentication system for MoltAI platform',
      );
      assert.equal(summaries[0].threadSnapshot.subThreads.length, 2);
      assert.equal(
        summaries[0].threadSnapshot.keyState['targetVersion'],
        'PostgreSQL 15.2',
      );
      assert.equal(summaries[0].threadSnapshot.unresolved.length, 2);
      assert.equal(summaries[0].tokenCount, 320);

      // Second compaction
      assert.equal(summaries[1].windowIndex, 1);
      assert.equal(summaries[1].threadSnapshot.threadHistory.length, 1);
      assert.equal(
        summaries[1].threadSnapshot.threadHistory[0].thread,
        'Database migration',
      );
      assert.equal(
        summaries[1].threadSnapshot.threadHistory[0].status,
        'completed',
      );
    });

    test('reads plain compaction events (no kasettMeta) with fallback', async () => {
      const filePath = join(fixturesDir, 'session-plain-compaction.jsonl');
      const summaries = await reader.readCompactionSummaries(filePath);

      assert.equal(summaries.length, 2);

      // Fallback: should have empty thread snapshot
      assert.equal(summaries[0].threadSnapshot.mainThread, 'Unknown');
      assert.deepEqual(summaries[0].threadSnapshot.subThreads, []);
      assert.deepEqual(summaries[0].threadSnapshot.keyState, {});
      assert.equal(summaries[0].windowIndex, 0);
      assert.equal(summaries[0].windowTotal, 1);

      // Should preserve the summary text
      assert.ok(summaries[0].summary.includes('CI/CD pipeline'));
      assert.ok(summaries[1].summary.includes('GitHub Actions'));
    });

    test('reads mixed session (plain + kasett-enriched)', async () => {
      const filePath = join(fixturesDir, 'session-mixed.jsonl');
      const summaries = await reader.readCompactionSummaries(filePath);

      assert.equal(summaries.length, 2);

      // First is plain (no kasettMeta)
      assert.equal(summaries[0].threadSnapshot.mainThread, 'Unknown');
      assert.ok(summaries[0].summary.includes('notification service'));

      // Second is kasett-enriched
      assert.equal(
        summaries[1].threadSnapshot.mainThread,
        'Refactoring notification service to event-driven architecture',
      );
      assert.equal(summaries[1].threadSnapshot.subThreads.length, 2);
      assert.equal(
        summaries[1].threadSnapshot.keyState['webhookEndpoint'],
        '/api/webhooks/notify',
      );
    });

    test('throws KasettError for non-existent file', async () => {
      await assert.rejects(
        () => reader.readCompactionSummaries('/nonexistent/path.jsonl'),
        (err: unknown) => {
          assert.ok(err instanceof KasettError);
          assert.equal(err.code, 'READ_ERROR');
          return true;
        },
      );
    });

    test('readLastN returns empty for count 0', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const summaries = await reader.readLastN(filePath, 0);
      assert.deepEqual(summaries, []);
    });
  });

  describe('readLastN', () => {
    test('returns last N summaries', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const summaries = await reader.readLastN(filePath, 1);

      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].windowIndex, 1); // Should be the second/last one
    });

    test('returns all when N exceeds available', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const summaries = await reader.readLastN(filePath, 10);

      assert.equal(summaries.length, 2);
    });

    test('returns empty for N=0', async () => {
      const filePath = join(fixturesDir, 'session-with-kasett-meta.jsonl');
      const summaries = await reader.readLastN(filePath, 0);

      assert.equal(summaries.length, 0);
    });
  });
});
