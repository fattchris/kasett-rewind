/**
 * Shared constants for the hot-swap compaction subsystem.
 */
/**
 * Regex for matching [THREAD_META]...[/THREAD_META] blocks.
 * Shared between stub.ts and worker.ts to avoid duplication.
 */
export const THREAD_META_REGEX = /\[THREAD_META\]\s*\n([\s\S]*?)\n?\s*\[\/THREAD_META\]/;
/**
 * Regex for detecting a [KASETT_STUB::<uuid>] marker in a compaction summary.
 * Captures the stub ID.
 */
export const KASETT_STUB_REGEX = /\[KASETT_STUB::([0-9a-f-]{36})\]/i;
/**
 * The prefix used in the stub marker (without the ID).
 * Used to generate and identify stub entries.
 */
export const KASETT_STUB_PREFIX = '[KASETT_STUB::';
//# sourceMappingURL=constants.js.map