import type {
  CompactionSummary,
  SubThread,
  ThreadHistoryEntry,
  ThreadSnapshot,
} from '../types.js';

/**
 * Thread tracker — ensures threads evolve gradually across compactions
 * and never silently disappear.
 */
export class ThreadTracker {
  /**
   * Parse a structured compaction output (from the LLM) into a ThreadSnapshot.
   * Expects markdown format matching the compaction prompt template.
   */
  static parse(rawSummary: string): ThreadSnapshot {
    const mainThread = extractSection(rawSummary, 'Main Thread') || 'Unknown';
    const subThreads = parseSubThreads(rawSummary);
    const keyState = parseKeyState(rawSummary);
    const unresolved = parseUnresolved(rawSummary);
    const threadHistory = parseThreadHistory(rawSummary);

    return {
      mainThread,
      subThreads,
      keyState,
      unresolved,
      threadHistory,
    };
  }

  /**
   * Validate that thread evolution rules are respected:
   * - Every thread from previous compaction appears in current (active or history)
   * - No thread silently disappears
   * Returns list of violations (empty = valid).
   */
  static validate(
    current: ThreadSnapshot,
    previous: ThreadSnapshot | undefined,
  ): string[] {
    if (!previous) return []; // First compaction, no rules to enforce

    const violations: string[] = [];

    // Check main thread
    const currentAllThreadNames = new Set([
      current.mainThread.toLowerCase(),
      ...current.subThreads.map((t) => t.name.toLowerCase()),
      ...current.threadHistory.map((t) => t.thread.toLowerCase()),
    ]);

    // Previous main thread must appear somewhere
    if (!currentAllThreadNames.has(previous.mainThread.toLowerCase())) {
      // Check fuzzy match (substring)
      const found = [...currentAllThreadNames].some(
        (name) =>
          name.includes(previous.mainThread.toLowerCase().slice(0, 20)) ||
          previous.mainThread.toLowerCase().includes(name.slice(0, 20)),
      );
      if (!found) {
        violations.push(
          `Previous main thread "${previous.mainThread}" disappeared without explanation`,
        );
      }
    }

    // Previous sub-threads must appear somewhere
    for (const prevThread of previous.subThreads) {
      if (prevThread.status === 'completed' || prevThread.status === 'backgrounded') {
        continue; // Already resolved in previous compaction
      }
      const found = [...currentAllThreadNames].some(
        (name) =>
          name.includes(prevThread.name.toLowerCase().slice(0, 15)) ||
          prevThread.name.toLowerCase().includes(name.slice(0, 15)),
      );
      if (!found) {
        violations.push(
          `Previous sub-thread "${prevThread.name}" [${prevThread.status}] disappeared without explanation`,
        );
      }
    }

    return violations;
  }

  /**
   * Merge thread history from previous compaction into current snapshot.
   * Threads that were active in previous but not in current get added to history.
   */
  static mergeHistory(
    current: ThreadSnapshot,
    previous: CompactionSummary | undefined,
  ): ThreadSnapshot {
    if (!previous) return current;

    const prevSnapshot = previous.threadSnapshot;
    const currentActiveNames = new Set([
      current.mainThread.toLowerCase(),
      ...current.subThreads.map((t) => t.name.toLowerCase()),
    ]);

    // Carry forward previous history entries not already in current
    const existingHistoryNames = new Set(
      current.threadHistory.map((h) => h.thread.toLowerCase()),
    );

    for (const histEntry of prevSnapshot.threadHistory) {
      if (!existingHistoryNames.has(histEntry.thread.toLowerCase())) {
        current.threadHistory.push(histEntry);
      }
    }

    // Previous sub-threads that aren't in current active → add to history
    for (const prevSub of prevSnapshot.subThreads) {
      if (
        prevSub.status === 'active' &&
        !currentActiveNames.has(prevSub.name.toLowerCase()) &&
        !existingHistoryNames.has(prevSub.name.toLowerCase())
      ) {
        current.threadHistory.push({
          thread: prevSub.name,
          status: 'backgrounded',
          lastSeen: previous.timestamp,
        });
      }
    }

    // Cap history at 10 entries (drop oldest)
    if (current.threadHistory.length > 10) {
      current.threadHistory = current.threadHistory.slice(-10);
    }

    return current;
  }
}

// --- Parsing helpers ---

function extractSection(text: string, heading: string): string | undefined {
  const regex = new RegExp(
    `###?\\s*${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n###?\\s|$)`,
    'i',
  );
  const match = text.match(regex);
  return match?.[1]?.trim();
}

function parseSubThreads(text: string): SubThread[] {
  const section = extractSection(text, 'Active Sub-threads');
  if (!section) return [];

  const threads: SubThread[] = [];
  const lines = section.split('\n').filter((l) => l.trim().match(/^\d+\.|^-/));

  for (const line of lines) {
    const clean = line.replace(/^\d+\.\s*|^-\s*/, '').trim();
    const dashParts = clean.split('—');
    const name = dashParts[0]?.trim() || clean;
    const detail = dashParts[1]?.trim();

    // Try to extract status from brackets
    const statusMatch = name.match(/\[(active|completed|blocked|backgrounded)\]/i);
    const status = (statusMatch?.[1]?.toLowerCase() as SubThread['status']) || 'active';
    const cleanName = name.replace(/\s*\[.*?\]\s*/, '').trim();

    threads.push({ name: cleanName, status, detail });
  }

  return threads.slice(0, 3); // Max 3
}

function parseKeyState(text: string): Record<string, string> {
  const section = extractSection(text, 'Key State');
  if (!section) return {};

  const state: Record<string, string> = {};
  const lines = section.split('\n').filter((l) => l.trim().startsWith('-'));

  for (const line of lines) {
    const clean = line.replace(/^-\s*/, '').trim();
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0) {
      const key = clean.slice(0, colonIdx).trim();
      const value = clean.slice(colonIdx + 1).trim();
      state[key] = value;
    }
  }

  return state;
}

function parseUnresolved(text: string): string[] {
  const section = extractSection(text, 'Unresolved');
  if (!section) return [];

  return section
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

function parseThreadHistory(text: string): ThreadHistoryEntry[] {
  const section = extractSection(text, 'Thread History');
  if (!section) return [];

  const entries: ThreadHistoryEntry[] = [];
  const lines = section.split('\n').filter((l) => l.trim().startsWith('-'));

  for (const line of lines) {
    const clean = line.replace(/^-\s*/, '').trim();
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0) {
      const thread = clean.slice(0, colonIdx).trim();
      const rest = clean.slice(colonIdx + 1).trim();
      const statusMatch = rest.match(
        /^(completed|blocked|backgrounded|deprioritized|active)/i,
      );
      const status =
        (statusMatch?.[1]?.toLowerCase() as ThreadHistoryEntry['status']) || 'completed';
      entries.push({ thread, status, lastSeen: new Date().toISOString() });
    }
  }

  return entries;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
