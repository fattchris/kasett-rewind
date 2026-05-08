/**
 * lock.ts — Lock acquisition/release helpers matching OC's pattern.
 *
 * OC uses `open(lockPath, 'wx')` (exclusive create) to acquire session write
 * locks. The lock file lives alongside the JSONL: `<sessionFile>.lock`.
 *
 * This module provides the same mechanism so kasett can safely acquire the
 * lock before rewriting the JSONL for a hot-swap.
 */
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
export declare function acquireLock(sessionFile: string, options?: AcquireOptions): Promise<LockHandle>;
/**
 * Wait for the lock file to be absent (i.e., OC is between turns).
 * Used when we want to observe the inter-turn gap without acquiring the lock.
 *
 * @param sessionFile - Absolute path to the session `.jsonl` file
 * @param timeoutMs - How long to wait before giving up
 * @param pollIntervalMs - Polling interval
 * @returns true if lock cleared within timeout, false if timed out
 */
export declare function waitForLockAbsent(sessionFile: string, timeoutMs: number, pollIntervalMs?: number): Promise<boolean>;
//# sourceMappingURL=lock.d.ts.map