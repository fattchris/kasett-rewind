import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CompactionEvent, ThreadMeta } from '../types.js';

/**
 * Error class for kasett-rewind operations.
 */
export class KasettError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'KasettError';
    this.code = code;
  }
}

/**
 * Reads session JSONL files and extracts compaction events with kaspiett thread meta.
 * Uses streaming for memory efficiency on large session files.
 */
export class SessionReader {
  /**
   * Read all compaction events from a session JSONL file.
   * Returns events in chronological order (oldest first).
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @returns Array of CompactionEvent objects
   * @throws KasettError if file cannot be read
   */
  async readCompactionEvents(filePath: string): Promise<CompactionEvent[]> {
    const events: CompactionEvent[] = [];

    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = this.parseLine(trimmed);
        if (event) {
          events.push(event);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new KasettError(
        `Failed to read session file: ${filePath} — ${message}`,
        'READ_ERROR',
      );
    }

    return events;
  }

  /**
   * Read the last N compaction events that have kaspiett thread meta.
   * Falls back to events without kaspiett if fewer than N have it.
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @param count - Maximum number of events to return
   * @returns The last N CompactionEvent objects with kaspiett (oldest first)
   */
  async readLastNWithMeta(filePath: string, count: number): Promise<CompactionEvent[]> {
    if (count <= 0) return [];
    const all = await this.readCompactionEvents(filePath);
    const withMeta = all.filter((e) => e.data.kaspiett != null);
    return withMeta.slice(-count);
  }

  /**
   * Read the most recent thread meta from the session JSONL.
   * Returns null if no compaction with kaspiett meta exists.
   */
  async readLatestMeta(filePath: string): Promise<ThreadMeta | null> {
    const all = await this.readCompactionEvents(filePath);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].data.kaspiett) {
        return all[i].data.kaspiett!;
      }
    }
    return null;
  }

  /**
   * Parse a single JSONL line into a CompactionEvent.
   * Returns undefined if the line is not a valid compaction event.
   */
  private parseLine(line: string): CompactionEvent | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        (parsed as Record<string, unknown>).type === 'compaction' &&
        'data' in parsed
      ) {
        const obj = parsed as Record<string, unknown>;
        const data = obj.data as Record<string, unknown>;
        if (typeof data?.summary !== 'string') return undefined;

        // Extract kaspiett if present
        let kaspiett: ThreadMeta | undefined;
        if (data.kaspiett && typeof data.kaspiett === 'object') {
          const k = data.kaspiett as Record<string, unknown>;
          if (
            typeof k.main === 'string' &&
            Array.isArray(k.sub) &&
            k.sub.length === 3 &&
            k.sub.every((s: unknown) => typeof s === 'string')
          ) {
            kaspiett = {
              main: k.main,
              sub: k.sub as [string, string, string],
            };
          }
        }

        return {
          type: 'compaction',
          id: typeof obj.id === 'string' ? obj.id : undefined,
          timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
          data: {
            summary: data.summary as string,
            kaspiett,
          },
        };
      }
      return undefined;
    } catch {
      // Skip unparseable lines
      return undefined;
    }
  }
}
