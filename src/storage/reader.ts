import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CompactionEvent, ThreadMeta } from '../types.js';
import { readSidecar, sidecarExists, type SidecarEntry } from './sidecar.js';
import {
  parseCompactionOutput,
  parseCompactionOutputV2,
  parseCompactionOutputV3,
} from '../threads/parser.js';
import type { ThreadMetaV2, ThreadMetaV3 } from '../threads/schema.js';
import { projectV2ToV1, projectV3ToV2 } from '../threads/schema.js';

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
 * Reads session JSONL files (and the kasett sidecar) and extracts compaction
 * events with thread meta. Uses streaming for memory efficiency on large
 * session files.
 *
 * ## Storage layout
 *
 * As of Phase B1 (2026-05-12), kasett stores rich compaction summaries in a
 * sidecar file alongside the OC session JSONL:
 *
 *     <session>.jsonl                    ← OC stub stays here
 *     <session>.jsonl.kasett-meta.jsonl  ← rich kasett meta lives here
 *
 * Reads prefer the sidecar. Legacy sessions that have rich `[THREAD_META]`
 * inline in the OC JSONL `summary` field still work via fallback scanning.
 *
 * ## JSONL field path
 *
 * Real OC compaction events store the summary at TOP-LEVEL `summary`, not
 * `data.summary` (Phase A audit, 2026-05-12). The reader supports both:
 * top-level first, falling back to `data.summary` for legacy fixtures.
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
      // File doesn't exist yet (new session) — no compactions to read
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new KasettError(
        `Failed to read session file: ${filePath} — ${message}`,
        'READ_ERROR',
      );
    }

    return events;
  }

  /**
   * Read the last N compaction events that have thread meta.
   *
   * Sidecar-first: if a sidecar exists, prefer its entries (most-recent-last)
   * and fall back to JSONL-derived events for older slots.
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @param count - Maximum number of events to return
   * @returns The last N CompactionEvent objects with thread meta (oldest first)
   */
  async readLastNWithMeta(filePath: string, count: number): Promise<CompactionEvent[]> {
    if (count <= 0) return [];

    const sidecarEvents = sidecarExists(filePath)
      ? readSidecar(filePath).map(sidecarEntryToCompactionEvent)
      : [];

    const jsonlEvents = await this.readCompactionEvents(filePath);

    // Merge: sidecar is authoritative for any events it contains. Legacy
    // JSONL events without a sidecar match get appended (kept).
    const merged = mergeSidecarAndJsonl(sidecarEvents, jsonlEvents);

    const withMeta = merged.filter((e) => e.data.kaspiett != null);
    return withMeta.slice(-count);
  }

  /**
   * Read the most recent thread meta from the session.
   * Sidecar-first; falls back to JSONL.
   *
   * Returns the v1-shaped ThreadMeta. When the sidecar entry is v2, the
   * v1 shape is produced via `projectV2ToV1` (lossy projection for v1 readers).
   * Use `readLatestMetaV2` to access the full v2 object directly.
   */
  async readLatestMeta(filePath: string): Promise<ThreadMeta | null> {
    if (sidecarExists(filePath)) {
      const entries = readSidecar(filePath);
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.thread_meta_v3) return projectV2ToV1(projectV3ToV2(e.thread_meta_v3));
        if (e.thread_meta_v2) return projectV2ToV1(e.thread_meta_v2);
        if (e.thread_meta) return e.thread_meta;
      }
    }
    // Fallback: scan JSONL
    const all = await this.readCompactionEvents(filePath);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].data.kaspiett) return all[i].data.kaspiett!;
    }
    return null;
  }

  /**
   * Read the most recent v2 thread meta from the session, or null if none exists.
   *
   * V2-only — will not project v1 entries up to v2 (we have no `id`s or
   * `status` in v1 to fabricate). Use `readLatestMeta` for the unified view.
   *
   * If a v3 entry is present, it is projected down to v2 (drops key_state).
   */
  async readLatestMetaV2(filePath: string): Promise<ThreadMetaV2 | null> {
    if (sidecarExists(filePath)) {
      const entries = readSidecar(filePath);
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.thread_meta_v3) return projectV3ToV2(e.thread_meta_v3);
        if (e.thread_meta_v2) return e.thread_meta_v2;
      }
    }
    return null;
  }

  /**
   * Read the most recent v3 thread meta from the session, or null if none
   * exists. V3-only — won't synthesize a v3 from a v2 entry (no key_state
   * to fabricate). Use `readLatestMeta` / `readLatestMetaV2` for unified view.
   */
  async readLatestMetaV3(filePath: string): Promise<ThreadMetaV3 | null> {
    if (sidecarExists(filePath)) {
      const entries = readSidecar(filePath);
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].thread_meta_v3) return entries[i].thread_meta_v3!;
      }
    }
    return null;
  }

  /**
   * Read the last N thread metas with all available shapes (v1, v2, v3),
   * oldest first. Each slot reports every shape that's available so callers
   * can pick: orientation v3 uses v3+key_state when present, v2 falls back
   * to that, v1 falls back to either.
   *
   * For sidecar entries with `thread_meta_v3`, all three are populated
   * (v2 via `projectV3ToV2`, v1 via `projectV2ToV1`). For v2-only entries,
   * v1+v2 are populated. For legacy entries, only v1 is populated.
   */
  async readLastNWithMetaV3(
    filePath: string,
    count: number,
  ): Promise<Array<{ v1?: ThreadMeta; v2?: ThreadMetaV2; v3?: ThreadMetaV3 }>> {
    if (count <= 0) return [];

    const sidecarEntries = sidecarExists(filePath) ? readSidecar(filePath) : [];
    const jsonlEvents = await this.readCompactionEvents(filePath);

    const sidecarByStub = new Map<string, SidecarEntry>();
    for (const e of sidecarEntries) {
      if (e.stub_id) sidecarByStub.set(e.stub_id, e);
      sidecarByStub.set(e.compaction_id, e);
    }

    const KASETT_STUB_ID_RE = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
    const results: Array<{ v1?: ThreadMeta; v2?: ThreadMetaV2; v3?: ThreadMetaV3 }> = [];

    for (const ev of jsonlEvents) {
      const m = ev.data.summary.match(KASETT_STUB_ID_RE);
      let sidecar: SidecarEntry | undefined;
      if (m) sidecar = sidecarByStub.get(m[1]);

      if (sidecar) {
        const slot: { v1?: ThreadMeta; v2?: ThreadMetaV2; v3?: ThreadMetaV3 } = {};
        if (sidecar.thread_meta_v3) {
          slot.v3 = sidecar.thread_meta_v3;
          slot.v2 = projectV3ToV2(sidecar.thread_meta_v3);
          slot.v1 = projectV2ToV1(slot.v2);
        } else if (sidecar.thread_meta_v2) {
          slot.v2 = sidecar.thread_meta_v2;
          slot.v1 = projectV2ToV1(sidecar.thread_meta_v2);
        } else if (sidecar.thread_meta) {
          slot.v1 = sidecar.thread_meta;
        }
        if (slot.v1 || slot.v2 || slot.v3) results.push(slot);
        continue;
      }

      if (ev.data.kaspiett) {
        results.push({ v1: ev.data.kaspiett });
      }
    }

    const seenStubs = new Set<string>();
    for (const ev of jsonlEvents) {
      const m = ev.data.summary.match(KASETT_STUB_ID_RE);
      if (m) seenStubs.add(m[1]);
    }
    for (const e of sidecarEntries) {
      const id = e.stub_id ?? e.compaction_id;
      if (seenStubs.has(id)) continue;
      const slot: { v1?: ThreadMeta; v2?: ThreadMetaV2; v3?: ThreadMetaV3 } = {};
      if (e.thread_meta_v3) {
        slot.v3 = e.thread_meta_v3;
        slot.v2 = projectV3ToV2(e.thread_meta_v3);
        slot.v1 = projectV2ToV1(slot.v2);
      } else if (e.thread_meta_v2) {
        slot.v2 = e.thread_meta_v2;
        slot.v1 = projectV2ToV1(e.thread_meta_v2);
      } else if (e.thread_meta) {
        slot.v1 = e.thread_meta;
      }
      if (slot.v1 || slot.v2 || slot.v3) results.push(slot);
    }

    return results.slice(-count);
  }

  /**
   * Read the last N v1+v2 thread metas, oldest first. Each slot reports
   * BOTH shapes when available so callers can pick: the orientation
   * builder uses v2 when present, falls back to v1 when not.
   *
   * For sidecar entries with `thread_meta_v2`, both fields are populated
   * (v1 via `projectV2ToV1`). For legacy entries, only v1 is populated.
   * V3 entries are projected down to v2.
   */
  async readLastNWithMetaV2(
    filePath: string,
    count: number,
  ): Promise<Array<{ v1?: ThreadMeta; v2?: ThreadMetaV2 }>> {
    if (count <= 0) return [];

    const sidecarEntries = sidecarExists(filePath) ? readSidecar(filePath) : [];
    const jsonlEvents = await this.readCompactionEvents(filePath);

    // Build per-stub lookup of sidecar entries
    const sidecarByStub = new Map<string, SidecarEntry>();
    for (const e of sidecarEntries) {
      if (e.stub_id) sidecarByStub.set(e.stub_id, e);
      sidecarByStub.set(e.compaction_id, e);
    }

    const KASETT_STUB_ID_RE = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
    const results: Array<{ v1?: ThreadMeta; v2?: ThreadMetaV2 }> = [];

    for (const ev of jsonlEvents) {
      // First check if this JSONL slot has a matching sidecar (sidecar wins)
      const m = ev.data.summary.match(KASETT_STUB_ID_RE);
      let sidecar: SidecarEntry | undefined;
      if (m) sidecar = sidecarByStub.get(m[1]);

      if (sidecar) {
        const slot: { v1?: ThreadMeta; v2?: ThreadMetaV2 } = {};
        if (sidecar.thread_meta_v3) {
          slot.v2 = projectV3ToV2(sidecar.thread_meta_v3);
          slot.v1 = projectV2ToV1(slot.v2);
        } else if (sidecar.thread_meta_v2) {
          slot.v2 = sidecar.thread_meta_v2;
          slot.v1 = projectV2ToV1(sidecar.thread_meta_v2);
        } else if (sidecar.thread_meta) {
          slot.v1 = sidecar.thread_meta;
        }
        if (slot.v1 || slot.v2) results.push(slot);
        continue;
      }

      // No sidecar match — use JSONL kaspiett (v1 only) if present
      if (ev.data.kaspiett) {
        results.push({ v1: ev.data.kaspiett });
      }
    }

    // Append any orphaned sidecar entries (defensive)
    const seenStubs = new Set<string>();
    for (const ev of jsonlEvents) {
      const m = ev.data.summary.match(KASETT_STUB_ID_RE);
      if (m) seenStubs.add(m[1]);
    }
    for (const e of sidecarEntries) {
      const id = e.stub_id ?? e.compaction_id;
      if (seenStubs.has(id)) continue;
      const slot: { v1?: ThreadMeta; v2?: ThreadMetaV2 } = {};
      if (e.thread_meta_v3) {
        slot.v2 = projectV3ToV2(e.thread_meta_v3);
        slot.v1 = projectV2ToV1(slot.v2);
      } else if (e.thread_meta_v2) {
        slot.v2 = e.thread_meta_v2;
        slot.v1 = projectV2ToV1(e.thread_meta_v2);
      } else if (e.thread_meta) {
        slot.v1 = e.thread_meta;
      }
      if (slot.v1 || slot.v2) results.push(slot);
    }

    return results.slice(-count);
  }

  /**
   * Read the most recent compaction summary string.
   * Sidecar-first; if a rich summary is in the sidecar, return that. Otherwise
   * fall back to the most recent OC JSONL summary (which may be a stub).
   */
  async readLatestSummary(filePath: string): Promise<string | null> {
    if (sidecarExists(filePath)) {
      const entries = readSidecar(filePath);
      if (entries.length > 0) {
        return entries[entries.length - 1].summary_rich;
      }
    }
    const all = await this.readCompactionEvents(filePath);
    if (all.length === 0) return null;
    return all[all.length - 1].data.summary;
  }

  /**
   * Read the last N compaction summary strings, oldest first.
   *
   * Sidecar-first per slot: for each compaction position we prefer the
   * sidecar's rich summary over the JSONL stub.
   *
   * @param filePath - Absolute path to the session .jsonl file
   * @param count - Maximum number of summaries to return
   * @returns The last N summary strings, oldest first
   */
  async readLastNSummaries(filePath: string, count: number): Promise<string[]> {
    if (count <= 0) return [];

    const sidecarEntries = sidecarExists(filePath) ? readSidecar(filePath) : [];
    const jsonlEvents = await this.readCompactionEvents(filePath);

    // If we have sidecar entries, they are ordered chronologically and are
    // 1:1 with the kasett-handled compactions. Anything in the JSONL that
    // isn't already covered by a sidecar entry (e.g. a vanilla OC compaction
    // before kasett was active, or a stub that the worker never enriched)
    // gets included as-is.
    if (sidecarEntries.length === 0) {
      return jsonlEvents.slice(-count).map((e) => e.data.summary);
    }

    // Map sidecar entries by stub_id / compaction_id for lookup
    const sidecarByStub = new Map<string, SidecarEntry>();
    for (const e of sidecarEntries) {
      if (e.stub_id) sidecarByStub.set(e.stub_id, e);
      sidecarByStub.set(e.compaction_id, e);
    }

    // Per-slot resolution: for each JSONL compaction, prefer sidecar rich
    // summary if its stub id is present in the JSONL summary text.
    const KASETT_STUB_ID_RE = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
    const resolved: string[] = [];
    for (const ev of jsonlEvents) {
      const summary = ev.data.summary;
      const m = summary.match(KASETT_STUB_ID_RE);
      if (m) {
        const stubId = m[1];
        const sidecar = sidecarByStub.get(stubId);
        if (sidecar) {
          resolved.push(sidecar.summary_rich);
          continue;
        }
      }
      resolved.push(summary);
    }

    // Append any sidecar entries that don't have a matching JSONL slot
    // (shouldn't happen in practice but safe-guards against drift).
    const seenStubs = new Set<string>();
    for (const ev of jsonlEvents) {
      const m = ev.data.summary.match(KASETT_STUB_ID_RE);
      if (m) seenStubs.add(m[1]);
    }
    for (const e of sidecarEntries) {
      const id = e.stub_id ?? e.compaction_id;
      if (!seenStubs.has(id)) {
        resolved.push(e.summary_rich);
      }
    }

    return resolved.slice(-count);
  }

  /**
   * Parse a single JSONL line into a CompactionEvent.
   * Returns undefined if the line is not a valid compaction event.
   *
   * Supports both real OC layout (top-level `summary`) and legacy fixtures
   * (`data.summary`). Real production data uses the top-level layout.
   */
  private parseLine(line: string): CompactionEvent | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        (parsed as Record<string, unknown>).type === 'compaction'
      ) {
        const obj = parsed as Record<string, unknown>;

        // Try top-level `summary` first (real OC layout)
        let summary: string | undefined;
        let kaspiettRaw: unknown;
        if (typeof obj.summary === 'string') {
          summary = obj.summary;
          kaspiettRaw = obj.kaspiett;
        } else if (
          'data' in obj &&
          typeof obj.data === 'object' &&
          obj.data !== null
        ) {
          const data = obj.data as Record<string, unknown>;
          if (typeof data.summary === 'string') {
            summary = data.summary;
            kaspiettRaw = data.kaspiett;
          }
        }

        if (typeof summary !== 'string') return undefined;

        // Extract kaspiett if present as a structured field
        let kaspiett: ThreadMeta | undefined = parseKaspiett(kaspiettRaw);

        // If no structured field, try parsing [THREAD_META] (v1) or fenced
        // JSON (v2) from the summary text itself. This is what enables
        // backward compatibility for sessions that pre-date the sidecar AND
        // forward-compatibility for v2 inline summaries (rare but possible
        // when the LLM call lands directly in OC's storage path).
        if (!kaspiett) {
          // Try V3 → V2 → V1 in order; project the highest hit down to v1.
          const v3 = parseCompactionOutputV3(summary);
          if (v3.metaV1) {
            kaspiett = v3.metaV1;
          } else {
            const v2 = parseCompactionOutputV2(summary);
            if (v2.metaV1) {
              kaspiett = v2.metaV1;
            } else {
              const fromText = parseCompactionOutput(summary).meta;
              if (fromText) kaspiett = fromText;
            }
          }
        }

        return {
          type: 'compaction',
          id: typeof obj.id === 'string' ? obj.id : undefined,
          timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
          data: {
            summary,
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

/**
 * Coerce an unknown kaspiett raw object into a typed ThreadMeta, or undefined.
 */
function parseKaspiett(raw: unknown): ThreadMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const k = raw as Record<string, unknown>;
  if (
    typeof k.main === 'string' &&
    Array.isArray(k.sub) &&
    k.sub.length === 3 &&
    k.sub.every((s: unknown) => typeof s === 'string')
  ) {
    return {
      main: k.main,
      sub: k.sub as [string, string, string],
    };
  }
  return undefined;
}

/**
 * Convert a sidecar entry into a CompactionEvent for backward-compatible APIs.
 */
function sidecarEntryToCompactionEvent(entry: SidecarEntry): CompactionEvent {
  // Prefer v3 (project down to v1); fall back to v2, then v1.
  let meta: ThreadMeta | undefined;
  if (entry.thread_meta_v3) {
    meta = projectV2ToV1(projectV3ToV2(entry.thread_meta_v3));
  } else if (entry.thread_meta_v2) {
    meta = projectV2ToV1(entry.thread_meta_v2);
  } else if (entry.thread_meta) {
    meta = {
      main: entry.thread_meta.main,
      sub: entry.thread_meta.sub,
    };
  }
  return {
    type: 'compaction',
    id: entry.stub_id ?? entry.compaction_id,
    timestamp: entry.ts,
    data: {
      summary: entry.summary_rich,
      kaspiett: meta,
    },
  };
}

/**
 * Merge sidecar-derived events with JSONL events. Sidecar wins per stub_id.
 *
 * Strategy:
 *   - Walk JSONL events oldest-first
 *   - For each, if its summary contains a [KASETT_STUB::<id>] marker AND a
 *     sidecar entry with that id exists, replace it with the sidecar event
 *   - Otherwise keep the JSONL event
 *   - Append any sidecar events not represented in the JSONL (defensive)
 */
function mergeSidecarAndJsonl(
  sidecarEvents: CompactionEvent[],
  jsonlEvents: CompactionEvent[],
): CompactionEvent[] {
  const KASETT_STUB_ID_RE = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
  const sidecarById = new Map<string, CompactionEvent>();
  for (const e of sidecarEvents) {
    if (e.id) sidecarById.set(e.id, e);
  }

  const merged: CompactionEvent[] = [];
  const claimed = new Set<string>();
  for (const ev of jsonlEvents) {
    const m = ev.data.summary.match(KASETT_STUB_ID_RE);
    if (m) {
      const stubId = m[1];
      const sidecar = sidecarById.get(stubId);
      if (sidecar) {
        merged.push(sidecar);
        claimed.add(stubId);
        continue;
      }
    }
    merged.push(ev);
  }
  // Append any sidecar events not already claimed
  for (const e of sidecarEvents) {
    if (e.id && !claimed.has(e.id)) merged.push(e);
  }
  return merged;
}
