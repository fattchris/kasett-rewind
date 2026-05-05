# OC JSONL Internals — Hot-Swap Compaction Feasibility

**Investigation date:** 2026-05-05  
**Source files read:**
- `/usr/lib/node_modules/openclaw/dist/pi-embedded-runner-C72h-nWV.js`
- `/usr/lib/node_modules/openclaw/dist/compact-CNsgTXwX.js`
- `/usr/lib/node_modules/openclaw/dist/model-context-tokens-CwcLB3PA.js`
- `/usr/lib/node_modules/openclaw/dist/session-write-lock-Dk7FbMr_.js`
- `/usr/lib/node_modules/openclaw/node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js`
- `/usr/lib/node_modules/openclaw/node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.js`
- `/usr/lib/node_modules/openclaw/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js`

---

## Question 1: Does OC re-read the compaction summary from JSONL on each turn, or cache it in memory?

**Answer: OC re-reads from file on EVERY turn. No cross-turn caching of the summary.**

### Proof

On every incoming message, `runEmbeddedPiAgent()` is called fresh (it's invoked per-message from `agent-runner.runtime-CH0aH7T6.js` line 881). Inside that function, the JSONL is opened from disk every time:

```javascript
// pi-embedded-runner-C72h-nWV.js line 5848
sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), { ... });
```

`SessionManager.open()` in `session-manager.js` line 976–991:
```javascript
static open(path, sessionDir, cwdOverride) {
    const entries = loadEntriesFromFile(path);  // ← readFileSync from disk
    const header = entries.find((e) => e.type === "session");
    const cwd = cwdOverride ?? header?.cwd ?? process.cwd();
    const dir = sessionDir ?? resolve(path, "..");
    return new SessionManager(cwd, dir, path, true);
}
```

`loadEntriesFromFile()` calls `readFileSync(filePath, "utf8")` — synchronous full file read on every turn.

After `SessionManager.open()`, `createAgentSession()` is called with the loaded manager. Inside `sdk.js` line 79:
```javascript
const existingSession = sessionManager.buildSessionContext();
// ...
agent.state.messages = existingSession.messages;  // line 204
```

`buildSessionContext()` walks the in-memory entry tree (already parsed from file) and constructs messages, including emitting the compaction summary as the first message when a compaction entry is present (`session-manager.js` line 176):
```javascript
messages.push(createCompactionSummaryMessage(compaction.summary, compaction.tokensBefore, compaction.timestamp));
```

### What `sessionManagerCache` / `prewarmSessionFile` does

There IS a `sessionManagerCache` (`model-context-tokens-CwcLB3PA.js` line 5773), and `prewarmSessionFile` pre-opens the file handle to warm the OS page cache. But this is an **OS I/O optimization only** — it does NOT cache the parsed entries or the `SessionManager` object between turns. The full file is re-parsed from disk on every turn regardless.

### Implication for hot-swap

**This is favorable.** If kasett rewrites the compaction entry in the JSONL between turns (while OC is idle), the next turn will pick up the updated summary automatically. There is no in-memory SessionManager instance that persists between turns and would "hold" the old summary.

---

## Question 2: Can we rewrite a JSONL line in-place?

**Answer: OC never rewrites individual lines — it uses atomic tmp+rename for full rewrites, and appendFileSync for incremental writes. However, kasett CAN safely rewrite the file between turns using the same tmp+rename pattern OC uses.**

### Write patterns in OC source code

#### Pattern A: Incremental `appendFileSync` (per-message during a turn)

The live SessionManager calls `appendFileSync` for each new entry as the conversation proceeds:

```javascript
// session-manager.js line 556/561
_persist(entry) {
    if (!this.flushed) {
        for (const e of this.fileEntries) {
            appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
        }
        this.flushed = true;
    } else {
        appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
}
```

This is strictly append-only — no in-place line modification ever happens during a live turn.

#### Pattern B: Atomic `writeFile` + `rename` for compaction/truncation

When compaction or post-compaction truncation rewrites the whole file, OC uses a temp file:

```javascript
// compact-CNsgTXwX.js lines 114-116 (hardenManualCompactionBoundary)
const tmpFile = `${params.sessionFile}.manual-compaction-tmp`;
await fs.writeFile(tmpFile, content, "utf-8");
await fs.rename(tmpFile, params.sessionFile);

// compact-CNsgTXwX.js lines 254-257 (truncateSessionAfterCompaction)
const tmpFile = `${sessionFile}.truncate-tmp`;
await fs.writeFile(tmpFile, content, "utf-8");
await fs.rename(tmpFile, sessionFile);
```

#### What this means for hot-swap

A "hot-swap" that replaces the stub compaction entry with a full summary CANNOT safely modify individual JSONL lines in-place (file position offsets would shift). Instead, kasett must do a full file rewrite using the same tmp+rename atomic swap:

1. Read the JSONL file
2. Parse all entries
3. Find the compaction entry with `type: "compaction"` and `id === stubEntryId`
4. Replace `entry.summary` with the full LLM-generated summary
5. Serialize all entries back: `[header, ...entries].map(e => JSON.stringify(e)).join("\n") + "\n"`
6. Write to `${sessionFile}.kasett-swap-tmp`
7. `fs.rename(tmpFile, sessionFile)` — atomic

**After compaction, the JSONL has the full history (not just recent messages).** `truncateAfterCompaction` is NOT configured on this instance (verified: not in `openclaw.json`). The file can be 71–300+ lines. For the 71-line example above: header (1) + model/thinking setup (~3) + 47 message entries + 1 compaction entry + 19 entries after compaction = 71 lines. The compaction entry is at line 52 of 71.

---

## Question 3: Does OC lock the JSONL during writes?

**Answer: YES — OC acquires an exclusive `.jsonl.lock` file for the ENTIRE duration of each turn, including all writes. The lock file uses PID + timestamp + start time for stale detection. Kasett MUST acquire this lock before rewriting the file.**

### Lock file mechanism

Location: `session-write-lock-Dk7FbMr_.js`

The lock is a separate file at `${sessionFile}.lock`. OC acquires it with `fs.open(lockPath, "wx")` (exclusive create) and writes a JSON payload:
```json
{
  "pid": 12345,
  "createdAt": "2026-05-05T16:00:00.000Z",
  "starttime": 1234567890
}
```

The lock is held for the **entire turn** — acquired before the session file is touched:

```javascript
// pi-embedded-runner-C72h-nWV.js line 5458
const sessionLock = await acquireSessionWriteLock({
    sessionFile: params.sessionFile,
    maxHoldMs: resolveSessionLockMaxHoldFromTimeout({ timeoutMs: ... })
});
// ... entire session run happens ...
// released in finally block (line 4311):
await params.sessionLock.release();
```

Same pattern in `compact-CNsgTXwX.js` lines 744–751: the compaction operation also acquires the write lock before touching the file.

### Stale lock detection

`acquireSessionWriteLock()` handles stale lock reclamation with three staleness checks:
1. **dead-pid**: `isPidAlive(pid)` returns false
2. **recycled-pid**: process start time changed for the same PID
3. **too-old**: lock age > 1800 seconds (default `DEFAULT_STALE_MS`)

If a lock is stale, it is silently deleted and reclaimed. A watchdog timer (`DEFAULT_WATCHDOG_INTERVAL_MS = 60s`) runs periodic cleanup.

### The `.jsonl.lock` files currently in the sessions dir

Confirmed live lock files:
```
/home/node/.openclaw/agents/main/sessions/0702701b-81ed-4abf-8e90-20f15c75fb97.jsonl.lock
/home/node/.openclaw/agents/main/sessions/653253cb-a394-4676-9a32-2e69bc1f90b7-topic-20751.jsonl.lock
/home/node/.openclaw/agents/main/sessions/f9c1b1c6-7407-4c85-8b41-f28ac8415fae.jsonl.lock
```

These are created by `acquireSessionWriteLock` and cleaned up on lock release or process exit.

### Lock behavior for kasett's hot-swap

**Kasett must acquire the lock before rewriting.** The safe approach:

```javascript
// Before rewriting the JSONL:
const lockPath = `${sessionFile}.lock`;
// Try open(lockPath, 'wx') to check if OC currently holds it
// If EEXIST → OC is mid-turn → wait and retry
// If acquired → do tmp+rename swap → release lock

// Actually simpler: just wait until OC is idle between turns
// (lock is released as soon as a turn finishes)
// Then: write tmp, rename — the window between turns has no lock held
```

**Key timing insight:** The lock is held for the entire turn duration (message receipt → LLM response → tool calls → response sent). Between turns, NO lock is held. So kasett can safely rewrite the file during the inter-turn gap as long as it:
1. Checks that the lock file doesn't exist (or is stale), OR
2. Acquires the lock itself using the same `open(lockPath, 'wx')` mechanism

---

## Summary for Hot-Swap Feasibility

| Question | Answer | Hot-swap impact |
|----------|--------|-----------------|
| Does OC cache summary in memory? | **NO** — full file re-read every turn via `SessionManager.open()` | ✅ Favorable: rewrite between turns takes effect next turn |
| Can we rewrite a JSONL line in-place? | **NO** — must do full file rewrite | ⚠️ Must use tmp+rename atomic swap; simple but requires reading full file |
| Does OC lock the JSONL? | **YES** — `.jsonl.lock` file, held entire turn | ⚠️ Must check for lock; safe to write during inter-turn gap |

### Recommended kasett hot-swap flow

```
kasett.summarize():
  1. Immediately append a stub compaction entry to JSONL (sync, via appendFileSync)
     → stub: { type: "compaction", id: <uuid>, summary: "[summary pending...]", ... }
     → return stub entry id to OC immediately
  
  Background process (after LLM finishes):
  2. Wait for OC lock to be absent (poll for .jsonl.lock absence OR just try 'wx' open)
  3. Read full JSONL, parse entries
  4. Find compaction entry where id === stubEntryId
  5. Replace summary field with full LLM summary
  6. Serialize all entries → write to ${sessionFile}.kasett-swap-tmp
  7. fs.rename(tmp, sessionFile) — atomic
  8. Done — next OC turn picks up the full summary automatically
```

**Risk:** If OC compacts again before kasett finishes the hot-swap, there may be two compaction entries. OC's `buildSessionContext()` uses the LAST compaction entry it finds in the tree path — so the stub wouldn't cause data loss, but the hot-swap must target the correct entry ID.

**Alternative (simpler):** If kasett can make the stub summary "good enough" for one turn (e.g., a brief bullet summary), the full replacement becomes a quality improvement rather than a correctness requirement. The stub prevents the agent from starting with an empty summary while the real one generates.
