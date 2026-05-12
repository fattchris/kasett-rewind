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
import { appendFileSync, mkdirSync, readFileSync, existsSync, } from 'node:fs';
import { join, dirname } from 'node:path';
import { isValidGlobalThreadRecord, } from './types.js';
/**
 * The filename, relative to the agent's sessions dir.
 */
export const GLOBAL_INDEX_FILENAME = '.kasett-global-threads.jsonl';
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
export function globalIndexPathFor(agentRoot) {
    // Normalize: if the caller already passed a sessions dir, don't double-append.
    const last = agentRoot.split('/').filter(Boolean).pop();
    const sessionsDir = last === 'sessions' ? agentRoot : join(agentRoot, 'sessions');
    return join(sessionsDir, GLOBAL_INDEX_FILENAME);
}
/**
 * Append a single record to the global index. Creates the file (and parent
 * dir) on first write. Validates shape before writing. Never throws.
 */
export function appendGlobalRecord(agentRoot, record) {
    if (!isValidGlobalThreadRecord(record)) {
        return { written: false, error: 'invalid_record' };
    }
    const path = globalIndexPathFor(agentRoot);
    try {
        const parent = dirname(path);
        if (!existsSync(parent)) {
            mkdirSync(parent, { recursive: true });
        }
        appendFileSync(path, JSON.stringify(record) + '\n', {
            flag: 'a',
            encoding: 'utf-8',
        });
        return { written: true, path };
    }
    catch (err) {
        return {
            written: false,
            error: String(err).slice(0, 200),
            path,
        };
    }
}
/**
 * Read all matching records from the global index, oldest first.
 *
 * Skips malformed lines silently — partial corruption (truncated last line,
 * mid-write power-off) shouldn't lose history.
 *
 * Returns an empty array if the file doesn't exist.
 */
export function readGlobalRecords(agentRoot, options = {}) {
    const path = globalIndexPathFor(agentRoot);
    if (!existsSync(path))
        return [];
    let raw;
    try {
        raw = readFileSync(path, 'utf-8');
    }
    catch {
        return [];
    }
    const cutoff = options.sinceMs
        ? Date.now() - options.sinceMs
        : undefined;
    const out = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            continue;
        }
        if (!isValidGlobalThreadRecord(parsed))
            continue;
        const r = parsed;
        if (cutoff !== undefined) {
            const tsMs = Date.parse(r.ts);
            if (Number.isNaN(tsMs) || tsMs < cutoff)
                continue;
        }
        if (options.thread_id && r.thread_id !== options.thread_id)
            continue;
        if (options.canonical_id &&
            (r.canonical_id ?? r.thread_id) !== options.canonical_id)
            continue;
        if (options.session_id && r.session_id !== options.session_id)
            continue;
        if (options.agent_id && r.agent_id !== options.agent_id)
            continue;
        out.push(r);
    }
    return out;
}
/**
 * Convenience: returns true when the index file exists.
 */
export function globalIndexExists(agentRoot) {
    return existsSync(globalIndexPathFor(agentRoot));
}
//# sourceMappingURL=index-writer.js.map