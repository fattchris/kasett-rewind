/**
 * Cross-session thread matcher (Phase E).
 *
 * Resolves a candidate `{thread_id, label}` to a canonical_id by walking
 * the global index in reverse-chronological order and applying the same
 * multi-tier strategy as `src/threads/identity.ts`:
 *
 *   1. exact-id    — candidate.thread_id === record.thread_id (or
 *                    record.canonical_id). Confidence 1.0.
 *   2. lexical     — Jaccard similarity ≥ 0.5 on label tokens.
 *   3. semantic    — hash-fingerprint cosine ≥ 0.55 (opt-in).
 *   4. none        — below all thresholds → candidate is brand-new.
 *
 * ## Same-label, different work
 *
 * The "deploy" problem from the task description: "deploy" in topic-A is
 * Claudia, "deploy" in topic-B is MoltAIMux. Lexical match would falsely
 * merge them.
 *
 * Defenses:
 *   - We prefer exact-id matches when the LLM provided a stable id.
 *   - Lexical match REQUIRES at least 3 distinct meaningful tokens in the
 *     candidate label (after stopword filter) before it can fire across
 *     sessions. A bare "deploy" can't cross session boundaries via Jaccard.
 *   - Cross-session semantic matching is OFF by default. The label space
 *     is too sparse to trust hash fingerprints across topics.
 *
 * If a thread genuinely needs to merge across sessions despite these
 * defenses, the LLM has plenty of context to assign the same `id` and
 * the exact-id tier will catch it.
 */
import type { GlobalThreadRecord } from './types.js';
export type MatchStrategy = 'exact-id' | 'lexical' | 'semantic' | 'none';
export interface CrossSessionMatch {
    canonical_id?: string;
    match_strategy: MatchStrategy;
    /** 0..1. exact-id=1.0, lexical=jaccard, semantic=cosine, none=0. */
    confidence: number;
    /** The most recent record that won the match (when strategy !== 'none'). */
    contributing_record?: GlobalThreadRecord;
}
export interface MatchOptions {
    /** Enable hash-fingerprint cosine tier. Default: false. */
    useEmbedding?: boolean;
    /** Lexical Jaccard threshold. Default 0.5. */
    lexicalThreshold?: number;
    /** Semantic cosine threshold. Default 0.55. */
    semanticThreshold?: number;
    /**
     * Minimum number of meaningful tokens (post-stopword filter) required in
     * the candidate label before lexical match can fire. Default 3.
     * Defends against bare "deploy" crossing session boundaries.
     */
    minLexicalTokens?: number;
    /**
     * If provided, ignore records from this session — useful when the caller
     * already handled within-session matching via identity.ts and only wants
     * to see cross-session candidates.
     */
    excludeSessionId?: string;
}
/**
 * Resolve a candidate to its canonical_id (or report "none").
 *
 * Walks records reverse-chronologically and stops at the first hit per
 * tier. Higher tiers always beat lower tiers (exact-id beats lexical
 * regardless of recency).
 */
export declare function findCanonicalThread(candidate: {
    thread_id: string;
    label: string;
}, globalRecords: ReadonlyArray<GlobalThreadRecord>, options?: MatchOptions): CrossSessionMatch;
/**
 * Resolve canonical_ids for a batch of candidates. Convenience wrapper —
 * walks the records once per candidate (the records list is small enough
 * that O(N*M) is fine in practice; max-5 sub-threads × ~1k records).
 */
export declare function findCanonicalThreadsBatch(candidates: ReadonlyArray<{
    thread_id: string;
    label: string;
}>, globalRecords: ReadonlyArray<GlobalThreadRecord>, options?: MatchOptions): Map<string, CrossSessionMatch>;
//# sourceMappingURL=matcher.d.ts.map