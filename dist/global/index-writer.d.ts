/**
 * Global thread index writer (Phase E).
 *
 * Append-only log of `GlobalThreadRecord` rows. Lives next to the session
 * files so it's discoverable by anyone who already knows where the agent's
 * sessions are.
 *
 *     ~/.openclaw/agents/<agent>/sessions/.kasett-global-threads.jsonl
 *
 * ## Concurrency
 *
 * Multiple sessions may compact concurrently. POSIX `O_APPEND` guarantees
 * a single `write()` of a short buffer is atomic — our line is one JSON
 * object plus `\n` and Node's `appendFileSync` opens with `O_APPEND` (the
 * `'a'` flag). Lines never interleave.
 *
 * ## Failure semantics
 *
 * Returns a `{ written, error }` tuple instead of throwing. Phase A's
 * lesson: any failure in the cross-cutting kasett write path that throws
 * up into the worker can mask a successful per-session sidecar write.
 * Callers (worker.ts) log the error but never abort the per-session
 * pipeline because the global index broke.
 */
import { type GlobalThreadRecord } from './types.js';
/**
 * The filename, relative to the agent's sessions dir.
 */
export declare const GLOBAL_INDEX_FILENAME = ".kasett-global-threads.jsonl";
/**
 * Build the absolute path to the global index file given an "agent root"
 * — the per-agent directory under `~/.openclaw/agents/<agent>/`.
 *
 * We accept either:
 *   - the agent root (e.g. `~/.openclaw/agents/main`)
 *   - the sessions dir directly (`~/.openclaw/agents/main/sessions`)
 *
 * because callers vary. Detection: if the path basename is `sessions`,
 * use it as-is; otherwise append `sessions`.
 */
export declare function globalIndexPathFor(agentRoot: string): string;
export interface AppendResult {
    written: boolean;
    error?: string;
    path?: string;
}
/**
 * Append a single record to the global index. Creates the file (and parent
 * dir) on first write. Validates shape before writing. Never throws.
 */
export declare function appendGlobalRecord(agentRoot: string, record: GlobalThreadRecord): AppendResult;
export interface ReadOptions {
    /** Only return records with `ts >= now - sinceMs`. */
    sinceMs?: number;
    /** Only return records with this thread_id. */
    thread_id?: string;
    /** Only return records with this canonical_id. */
    canonical_id?: string;
    /** Only return records with this session_id. */
    session_id?: string;
    /** Only return records with this agent_id. */
    agent_id?: string;
}
/**
 * Read all matching records from the global index, oldest first.
 *
 * Skips malformed lines silently — partial corruption (truncated last line,
 * mid-write power-off) shouldn't lose history.
 *
 * Returns an empty array if the file doesn't exist.
 */
export declare function readGlobalRecords(agentRoot: string, options?: ReadOptions): GlobalThreadRecord[];
/**
 * Convenience: returns true when the index file exists.
 */
export declare function globalIndexExists(agentRoot: string): boolean;
//# sourceMappingURL=index-writer.d.ts.map