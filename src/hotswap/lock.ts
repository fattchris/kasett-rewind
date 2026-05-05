/**
 * lock.ts — Lock acquisition/release helpers matching OC's pattern.
 *
 * OC uses `open(lockPath, 'wx')` (exclusive create) to acquire session write
 * locks. The lock file lives alongside the JSONL: `<sessionFile>.lock`.
 *
 * This module provides the same mechanism so kasett can safely acquire the
 * lock before rewriting the JSONL for a hot-swap.
 */

import { open, unlink, stat } from 'node:fs/promises';
import { FileHandle } from 'node:fs/promises';

export interface AcquireOptions {
  /** Maximum time to wait for the lock (milliseconds). Default: 30_000 */
  timeoutMs?: number;
  /** Polling interval between retries (milliseconds). Default: 100 */
  pollIntervalMs?: number;
  /**
   * Age (in ms) above which an existing lock is considered stale and
   * may be forcibly reclaimed. Default: 60_000 (1 minute).
   */
  staleLockMs?: number;
}

export interface LockHandle {
  /** Absolute path to the lock file */
  lockPath: string;
  /** Release the lock (delete the lock file). Idempotent. */
  release(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_STALE_MS = 60_000;

/**
 * Acquire an exclusive write lock for a session file.
 *
 * Uses `open(lockPath, 'wx')` — exclusive create — exactly as OC does.
 * If the lock is already held, polls at `pollIntervalMs` intervals until
 * `timeoutMs` elapses. Stale locks (older than `staleLockMs`) are
 * reclaimed automatically.
 *
 * @param sessionFile - Absolute path to the session `.jsonl` file
 * @param options - Optional tuning parameters
 * @returns LockHandle for releasing the lock when done
 * @throws Error if the lock cannot be acquired within `timeoutMs`
 */
export async function acquireLock(
  sessionFile: string,
  options?: AcquireOptions,
): Promise<LockHandle> {
  const lockPath = `${sessionFile}.lock`;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const staleLockMs = options?.staleLockMs ?? DEFAULT_STALE_MS;

  const deadline = Date.now() + timeoutMs;

  while (true) {
    // Attempt exclusive create
    let fh: FileHandle | null = null;
    try {
      fh = await open(lockPath, 'wx');
      // Acquired! Close the handle — we only need the file to exist as a lock
      await fh.close();
      return createHandle(lockPath);
    } catch (err: unknown) {
      if (fh) {
        try { await fh.close(); } catch { /* ignore */ }
      }

      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        // Unexpected error — propagate
        throw err;
      }

      // Lock already exists — check if it's stale
      if (await isStale(lockPath, staleLockMs)) {
        // Reclaim stale lock
        await unlink(lockPath).catch(() => {
          /* race: another process already removed it — fine */
        });
        continue;
      }
    }

    // Check timeout
    if (Date.now() >= deadline) {
      throw new Error(
        `[kasett-rewind] Timed out waiting for session write lock: ${lockPath} ` +
          `(${timeoutMs}ms elapsed)`,
      );
    }

    // Wait before next attempt
    await sleep(pollIntervalMs);
  }
}

/**
 * Check whether an existing lock file is stale (i.e., older than `staleLockMs`).
 * Returns true if the lock file doesn't exist (treat as acquirable) or is old enough.
 */
async function isStale(lockPath: string, staleLockMs: number): Promise<boolean> {
  try {
    const st = await stat(lockPath);
    const ageMs = Date.now() - st.mtimeMs;
    return ageMs > staleLockMs;
  } catch {
    // Lock file gone — treat as acquirable
    return true;
  }
}

/**
 * Create a LockHandle for the given lock path.
 */
function createHandle(lockPath: string): LockHandle {
  let released = false;
  return {
    lockPath,
    async release(): Promise<void> {
      if (released) return;
      released = true;
      await unlink(lockPath).catch(() => {
        /* already removed — idempotent */
      });
    },
  };
}

/**
 * Wait for the lock file to be absent (i.e., OC is between turns).
 * Used when we want to observe the inter-turn gap without acquiring the lock.
 *
 * @param sessionFile - Absolute path to the session `.jsonl` file
 * @param timeoutMs - How long to wait before giving up
 * @param pollIntervalMs - Polling interval
 * @returns true if lock cleared within timeout, false if timed out
 */
export async function waitForLockAbsent(
  sessionFile: string,
  timeoutMs: number,
  pollIntervalMs = DEFAULT_POLL_MS,
): Promise<boolean> {
  const lockPath = `${sessionFile}.lock`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await stat(lockPath);
      // Lock file exists — still mid-turn. Wait.
    } catch {
      // Lock file absent — inter-turn gap detected
      return true;
    }
    await sleep(pollIntervalMs);
  }

  // Check one last time
  try {
    await stat(lockPath);
    return false; // still locked
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
