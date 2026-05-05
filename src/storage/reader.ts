import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CompactionSummary, ThreadSnapshot } from '../types.js';
import { KasettError } from '../phase1/instructions.js';

/**
 * Represents a raw compaction event read from a session JSONL file.
 */
interface RawCompactionEvent {
  readonly type: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly data?: {
    readonly summary?: string;
    readonly kasettMeta?: {
      readonly windowIndex?: number;
      readonly windowTotal?: number;
      readonly threadSnapshot?: ThreadSnapshot;
      readonly tokenCount?: number;
    };
  };
}

/**
 * Reads session JSONL files and extracts compaction summaries.
 * Handles both kasett-enriched events (with kasettMeta) and
 * plain OC compaction events (graceful fallback).
 *
 * Uses streaming for memory efficiency on large session files.
 */
export class SessionReader {
  /**
   * Read all compaction summaries from a session JSONL file.
   * Returns summaries in chronological order (oldest first).
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @returns Array of CompactionSummary objects
   * @throws KasettError if file cannot be read
   */
  async readCompactionSummaries(filePath: string): Promise<CompactionSummary[]> {
    const summaries: CompactionSummary[] = [];

    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = this.parseLine(trimmed);
        if (!event) continue;

        if (event.type === 'compaction' && event.data?.summary) {
          const summary = this.eventToSummary(event);
          if (summary) {
            summaries.push(summary);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new KasettError(
        `Failed to read session file: ${filePath} — ${message}`,
        'READ_ERROR',
      );
    }

    return summaries;
  }

  /**
   * Read the last N compaction summaries from a session file.
   * More efficient for large files when only recent history is needed.
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @param count - Maximum number of summaries to return
   * @returns The last N CompactionSummary objects (oldest first)
   */
  async readLastN(filePath: string, count: number): Promise<CompactionSummary[]> {
    if (count <= 0) return [];
    const all = await this.readCompactionSummaries(filePath);
    return all.slice(-count);
  }

  /**
   * Parse a single JSONL line into a raw event.
   * Returns undefined if the line is not valid JSON or not a compaction event.
   */
  private parseLine(line: string): RawCompactionEvent | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        typeof (parsed as Record<string, unknown>).type === 'string'
      ) {
        return parsed as RawCompactionEvent;
      }
      return undefined;
    } catch {
      // Skip unparseable lines — session JSONL can contain non-JSON markers
      return undefined;
    }
  }

  /**
   * Convert a raw compaction event to a CompactionSummary.
   * If the event has kasettMeta, use it. Otherwise, create a
   * fallback summary from the raw summary text.
   */
  private eventToSummary(event: RawCompactionEvent): CompactionSummary | undefined {
    const data = event.data;
    if (!data?.summary) return undefined;

    const meta = data.kasettMeta;

    if (meta?.threadSnapshot) {
      // Full kasett-enriched event
      return {
        summary: data.summary,
        windowIndex: meta.windowIndex ?? 0,
        windowTotal: meta.windowTotal ?? 1,
        threadSnapshot: meta.threadSnapshot,
        timestamp: event.timestamp ?? new Date().toISOString(),
        tokenCount: meta.tokenCount ?? estimateTokens(data.summary),
      };
    }

    // Fallback: plain OC compaction event without kasettMeta
    return {
      summary: data.summary,
      windowIndex: 0,
      windowTotal: 1,
      threadSnapshot: createEmptyThreadSnapshot(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      tokenCount: estimateTokens(data.summary),
    };
  }
}

/**
 * Creates an empty thread snapshot for fallback use.
 */
function createEmptyThreadSnapshot(): ThreadSnapshot {
  return {
    mainThread: 'Unknown',
    subThreads: [],
    keyState: {},
    unresolved: [],
    threadHistory: [],
  };
}

/**
 * Rough token estimate (4 chars per token for English).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
