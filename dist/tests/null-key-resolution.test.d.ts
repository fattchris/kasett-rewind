/**
 * Tests for resolveSessionFileFromState with null/empty sessionKey (Bug 3 — Path C fix).
 *
 * OC's token-overflow compaction path (compact-CNsgTXwX.js → model-context-tokens)
 * fires before_compaction without sessionFile OR sessionKey in the hook payload.
 * The v2 fix handled null sessionFile but cascaded into broken string-matching
 * strategies when sessionKey was also null ("null".includes("null") = true, wrong path).
 *
 * The v3 fix (Bug 3) guards at the top of resolveSessionFileFromState: when
 * sessionKey is null/empty/whitespace, skip all key-based strategies and go
 * directly to the lock-file scan (OC holds a .jsonl.lock on the active session
 * file during compaction — exactly what we need).
 *
 * Tests cover:
 * - null sessionKey + single lock file → returns lock-derived path
 * - null sessionKey + no lock files → returns null
 * - empty string sessionKey treated same as null
 * - whitespace-only sessionKey treated same as null
 * - valid (non-empty) sessionKey → null-key branch is NOT entered (guard skipped)
 * - sessionsDir missing → returns null gracefully
 */
export {};
//# sourceMappingURL=null-key-resolution.test.d.ts.map