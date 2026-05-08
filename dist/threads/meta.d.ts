/**
 * Thread meta types and utilities.
 * ThreadMeta is always 1 main thread + exactly 3 sub-threads.
 */
import type { ThreadMeta } from '../types.js';
/**
 * Create an empty/default ThreadMeta.
 */
export declare function emptyThreadMeta(): ThreadMeta;
/**
 * Validate that a ThreadMeta has the correct shape.
 * Returns true if valid (main is non-empty, sub has exactly 3 entries).
 */
export declare function isValidThreadMeta(meta: unknown): meta is ThreadMeta;
export type { ThreadMeta };
//# sourceMappingURL=meta.d.ts.map