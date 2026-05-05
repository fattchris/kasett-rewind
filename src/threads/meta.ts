/**
 * Thread meta types and utilities.
 * ThreadMeta is always 1 main thread + exactly 3 sub-threads.
 */

import type { ThreadMeta } from '../types.js';

/**
 * Create an empty/default ThreadMeta.
 */
export function emptyThreadMeta(): ThreadMeta {
  return {
    main: '',
    sub: ['', '', ''],
  };
}

/**
 * Validate that a ThreadMeta has the correct shape.
 * Returns true if valid (main is non-empty, sub has exactly 3 entries).
 */
export function isValidThreadMeta(meta: unknown): meta is ThreadMeta {
  if (typeof meta !== 'object' || meta === null) return false;
  const obj = meta as Record<string, unknown>;
  if (typeof obj.main !== 'string' || obj.main.length === 0) return false;
  if (!Array.isArray(obj.sub) || obj.sub.length !== 3) return false;
  return obj.sub.every((s: unknown) => typeof s === 'string' && s.length > 0);
}

export type { ThreadMeta };
