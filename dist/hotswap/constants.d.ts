/**
 * Shared constants for the hot-swap compaction subsystem.
 */
/**
 * Regex for matching [THREAD_META]...[/THREAD_META] blocks.
 * Shared between stub.ts and worker.ts to avoid duplication.
 */
export declare const THREAD_META_REGEX: RegExp;
/**
 * Regex for detecting a [KASETT_STUB::<uuid>] marker in a compaction summary.
 * Captures the stub ID.
 */
export declare const KASETT_STUB_REGEX: RegExp;
/**
 * The prefix used in the stub marker (without the ID).
 * Used to generate and identify stub entries.
 */
export declare const KASETT_STUB_PREFIX = "[KASETT_STUB::";
//# sourceMappingURL=constants.d.ts.map