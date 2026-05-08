/**
 * Thread meta types and utilities.
 * ThreadMeta is always 1 main thread + exactly 3 sub-threads.
 */
/**
 * Create an empty/default ThreadMeta.
 */
export function emptyThreadMeta() {
    return {
        main: '',
        sub: ['', '', ''],
    };
}
/**
 * Validate that a ThreadMeta has the correct shape.
 * Returns true if valid (main is non-empty, sub has exactly 3 entries).
 */
export function isValidThreadMeta(meta) {
    if (typeof meta !== 'object' || meta === null)
        return false;
    const obj = meta;
    if (typeof obj.main !== 'string' || obj.main.length === 0)
        return false;
    if (!Array.isArray(obj.sub) || obj.sub.length !== 3)
        return false;
    return obj.sub.every((s) => typeof s === 'string' && s.length > 0);
}
//# sourceMappingURL=meta.js.map