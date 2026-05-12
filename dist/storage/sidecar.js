/**
 * sidecar.ts — Append-only sidecar store for kasett's rich compaction meta.
 *
 * ## Why a sidecar
 *
 * OC owns the session JSONL and holds an exclusive write lock on it whenever
 * the user is active. The previous hot-swap design tried to rewrite that JSONL
 * after the LLM produced a rich summary; in production, the lock never cleared
 * within the 30s wait window for active sessions, so 0% of stubs were ever
 * replaced (Phase A finding, 2026-05-12).
 *
 * The sidecar lives next to the session file and is written by kasett ONLY:
 *
 *     /…/sessions/<session>.jsonl              ← OC's territory
 *     /…/sessions/<session>.jsonl.kasett-meta.jsonl  ← kasett's territory
 *
 * One JSON object per line. Append-only — we never rewrite the file. POSIX
 * `O_APPEND` makes single appends atomic against concurrent writers, and we
 * have no concurrent writers in any case.
 *
 * ## Read order
 *
 * The session reader (storage/reader.ts) reads sidecar entries first. Legacy
 * sessions that have rich meta inline in the OC JSONL `summary` field still
 * work via fallback scanning of the JSONL.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, statSync, readdirSync, } from 'node:fs';
import { dirname, join, basename } from 'node:path';
/**
 * Resolve the sidecar path for a given session JSONL path.
 *
 * Convention: append `.kasett-meta.jsonl` to the full session filename.
 * This makes it trivial to discover sidecars (`*.kasett-meta.jsonl`) and
 * ensures unambiguous association with the source file.
 */
export function sidecarPathFor(sessionFile) {
    return `${sessionFile}.kasett-meta.jsonl`;
}
/**
 * Append one entry to the session's sidecar. Creates the file (and parent
 * directory if needed) on first write.
 *
 * Uses `appendFileSync` with `O_APPEND` semantics for atomicity. Throws on
 * any I/O error so callers can decide how to handle the failure (the kasett
 * hot-swap worker logs and continues; tests assert the throw).
 */
export function writeSidecarEntry(sessionFile, entry) {
    const sidecar = sidecarPathFor(sessionFile);
    const parentDir = dirname(sidecar);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(sidecar, line, { flag: 'a', encoding: 'utf-8' });
    return sidecar;
}
/**
 * Read all entries from a session's sidecar, oldest first.
 *
 * Returns an empty array if the sidecar doesn't exist (new session, never
 * compacted). Skips malformed lines silently — partial corruption shouldn't
 * lose the well-formed history.
 */
export function readSidecar(sessionFile) {
    const sidecar = sidecarPathFor(sessionFile);
    if (!existsSync(sidecar))
        return [];
    let raw;
    try {
        raw = readFileSync(sidecar, 'utf-8');
    }
    catch {
        return [];
    }
    const entries = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            // Light shape validation — we want to be lenient on read
            if (parsed &&
                typeof parsed === 'object' &&
                typeof parsed.summary_rich === 'string' &&
                typeof parsed.compaction_id === 'string') {
                entries.push(parsed);
            }
        }
        catch {
            // Skip malformed lines; don't crash on partial corruption
        }
    }
    return entries;
}
/**
 * Find the sidecar entry matching a particular compaction_id (or stub_id).
 *
 * Returns undefined if no entry matches.
 */
export function findEntryForCompaction(sessionFile, compactionId) {
    const entries = readSidecar(sessionFile);
    return entries.find((e) => e.compaction_id === compactionId || e.stub_id === compactionId);
}
/**
 * Returns true if the sidecar file exists and is non-empty.
 * Cheap stat-only check — does not parse the file.
 */
export function sidecarExists(sessionFile) {
    const sidecar = sidecarPathFor(sessionFile);
    if (!existsSync(sidecar))
        return false;
    try {
        return statSync(sidecar).size > 0;
    }
    catch {
        return false;
    }
}
/**
 * Resolve a session-key OR a session-file path to the actual session JSONL
 * path on disk. (Phase F bug fix.)
 *
 * Background: OC's compaction hook gives kasett the session-key
 * (`agent:main:telegram:group:-1003723465246:topic:12388`) but the worker
 * historically used it as a filesystem path — producing a sidecar at
 * `<session-key>.jsonl.kasett-meta.jsonl` instead of next to the real
 * `<uuid>-topic-N.jsonl` file. Daily review and the global index then
 * couldn't find the sidecar.
 *
 * Resolution order:
 *   1. If `sessionKeyOrPath` is already an absolute path that ends in
 *      `.jsonl` and exists — return it as-is.
 *   2. If it looks like a session-key (no path separator, no `.jsonl`),
 *      look it up in `<agentRoot>/sessions/sessions.json` and use the
 *      `sessionFile` field if present.
 *   3. As a fallback, scan `<agentRoot>/sessions/` for files matching
 *      `*-topic-<topicId>.jsonl` (where topicId is parsed from the key)
 *      and pick the most recently modified one.
 *   4. Return null if none of the strategies resolve.
 *
 * `agentRoot` is the per-agent directory (e.g. `~/.openclaw/agents/main`),
 * NOT the parent stateDir. Caller is responsible for joining stateDir +
 * 'agents/' + agentId.
 */
export function resolveSessionFilePath(agentRoot, sessionKeyOrPath) {
    if (!sessionKeyOrPath)
        return null;
    // Strategy 1: already a real path?
    if (sessionKeyOrPath.includes('/') && sessionKeyOrPath.endsWith('.jsonl')) {
        if (existsSync(sessionKeyOrPath))
            return sessionKeyOrPath;
        // Path-shaped but missing — fall through to other strategies
    }
    const sessionsDir = join(agentRoot, 'sessions');
    // Strategy 2: sessions.json lookup by exact key. The input may be either
    // a bare session-key (`agent:main:...:topic:12388`) or a path with the
    // session-key embedded as the basename. We try both forms.
    const storeFile = join(sessionsDir, 'sessions.json');
    if (existsSync(storeFile)) {
        try {
            const raw = readFileSync(storeFile, 'utf-8');
            const store = JSON.parse(raw);
            // Try both: full input (minus .jsonl) AND just the basename.
            const candidates = new Set();
            candidates.add(sessionKeyOrPath.replace(/\.jsonl$/, ''));
            candidates.add(basename(sessionKeyOrPath).replace(/\.jsonl$/, ''));
            let entry;
            for (const lookupKey of candidates) {
                entry =
                    store[lookupKey] ??
                        Object.entries(store).find(([k]) => k.toLowerCase() === lookupKey.toLowerCase())?.[1];
                if (entry)
                    break;
            }
            if (entry?.sessionFile) {
                if (existsSync(entry.sessionFile))
                    return entry.sessionFile;
                // sessionFile recorded but stale — try sessionId-based reconstruction
                if (entry.sessionId) {
                    const direct = join(sessionsDir, `${entry.sessionId}.jsonl`);
                    if (existsSync(direct))
                        return direct;
                }
            }
            else if (entry?.sessionId) {
                const direct = join(sessionsDir, `${entry.sessionId}.jsonl`);
                if (existsSync(direct))
                    return direct;
            }
        }
        catch {
            // Fall through
        }
    }
    // Strategy 3: parse topic id from key, scan for *-topic-<id>.jsonl
    // pattern. Pick the most recently modified.
    const stripped = sessionKeyOrPath.replace(/\.jsonl$/, '');
    const topicMatch = /:topic:(\d+)$/i.exec(stripped);
    if (topicMatch && existsSync(sessionsDir)) {
        try {
            const topicId = topicMatch[1];
            const suffix = `-topic-${topicId}.jsonl`;
            const candidates = readdirSync(sessionsDir).filter((f) => {
                if (!f.endsWith(suffix))
                    return false;
                // Skip checkpoint files (they have `.checkpoint.` in the name).
                if (f.includes('.checkpoint.'))
                    return false;
                return true;
            });
            if (candidates.length === 1) {
                return join(sessionsDir, candidates[0]);
            }
            if (candidates.length > 1) {
                let newest = candidates[0];
                let newestMtime = 0;
                for (const c of candidates) {
                    try {
                        const m = statSync(join(sessionsDir, c)).mtimeMs;
                        if (m > newestMtime) {
                            newestMtime = m;
                            newest = c;
                        }
                    }
                    catch {
                        // skip
                    }
                }
                return join(sessionsDir, newest);
            }
        }
        catch {
            // Fall through
        }
    }
    // Strategy 4: exact filename match in the sessions dir.
    if (existsSync(sessionsDir)) {
        try {
            const want = basename(sessionKeyOrPath).endsWith('.jsonl')
                ? basename(sessionKeyOrPath)
                : `${basename(sessionKeyOrPath)}.jsonl`;
            const all = readdirSync(sessionsDir);
            if (all.includes(want))
                return join(sessionsDir, want);
        }
        catch {
            // Fall through
        }
    }
    return null;
}
//# sourceMappingURL=sidecar.js.map