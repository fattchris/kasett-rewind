/**
 * Phase F — V3 parser truncation repair tests.
 *
 * Production evidence (2026-05-12 16:35 UTC compaction in topic-12388):
 * Sonnet 4.5 produced a 14,113-char structured JSON body inside a fenced
 * ```json``` block. The output hit max_tokens mid-string and the closing
 * fence was lost, so the strict V3 parser bailed with PARSE_NONE. These
 * tests exercise the new repair path.
 */
export {};
//# sourceMappingURL=parser-repair.test.d.ts.map