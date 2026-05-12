/**
 * Thread identity matcher (Phase D).
 *
 * Multi-tier matcher for tracking sub-thread continuity across compactions
 * even when the LLM drops or changes the stable `id`. Strategies tried in
 * order:
 *
 *   1. exact-id    — `current.id` equals `previous.id` (confidence 1.0)
 *   2. lexical     — Jaccard similarity on tokenized labels (≥0.5)
 *   3. semantic    — optional hash-fingerprint cosine similarity (≥0.55)
 *   4. none        — below all thresholds → genuinely new thread
 *
 * The lexical and semantic tiers exist for the inevitable case where the
 * LLM drifts: "infra-deploy" → "deploy" or "kasett-schema-v2" rebadged as
 * "schema-v3-prep". Without a fallback, our continuity classifier treats
 * those as distinct threads, which is wrong.
 *
 * ## Confidence scale
 *
 *   - exact-id: 1.0
 *   - lexical:  jaccard score itself (0.5 .. 1.0)
 *   - semantic: cosine score (0.55 .. 1.0)
 *   - none:     0
 *
 * Callers can use confidence directly (e.g., to decide rename vs created).
 *
 * ## "evolved"
 *
 * `evolved: true` means we matched a previous thread but the label changed.
 * This is the rename signal used by `lifecycle.ts`.
 */
import type { ThreadSubV2 } from './schema.js';
export type IdentityStrategy = 'exact-id' | 'lexical' | 'semantic' | 'none';
export interface IdentityMatch {
    strategy: IdentityStrategy;
    /** 0..1 confidence — see scale above. */
    confidence: number;
    /** ID of the matched thread in `previous`, when strategy !== 'none'. */
    matched_to?: string;
    /** True if matched but the label text changed. */
    evolved?: boolean;
}
export interface MatchOptions {
    /** Enable the semantic (hash-fingerprint) tier. Default: false. */
    useEmbedding?: boolean;
    /** Override lexical (jaccard) threshold. Default 0.5. */
    lexicalThreshold?: number;
    /** Override semantic (cosine) threshold. Default 0.55. */
    semanticThreshold?: number;
}
/**
 * Tokenize a label into a Set of comparable tokens:
 *   - lowercase
 *   - split on non-alphanumeric runs
 *   - drop tokens of length ≤ 2
 *   - drop stopwords
 *
 * Exported for tests; identity.ts callers should generally use the
 * public matcher.
 */
export declare function tokenize(s: string): Set<string>;
/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when either set is
 * empty (avoids spurious NaN-via-zero-division and avoids matching two
 * empty sets as identical).
 */
export declare function jaccard(a: Set<string>, b: Set<string>): number;
/**
 * Pick the best matching previous thread for `current` using the multi-tier
 * strategy described at the top of this file.
 *
 * Returns `{ strategy: 'none', confidence: 0 }` when no previous thread
 * exceeds any threshold — caller treats this as a brand-new thread.
 */
export declare function matchThread(current: ThreadSubV2, previous: ReadonlyArray<ThreadSubV2>, options?: MatchOptions): IdentityMatch;
/**
 * Match every thread in `current` against `previous`. Returns a Map keyed
 * by `current[i].id` so lifecycle.ts can do its book-keeping.
 *
 * Note: this is N×M where N = current count, M = previous count. With max-5
 * sub-threads per compaction (see schema.ts MAX_SUB), it's a constant
 * 25-comparison loop. No performance concern.
 */
export declare function matchAllThreads(current: ReadonlyArray<ThreadSubV2>, previous: ReadonlyArray<ThreadSubV2>, options?: MatchOptions): Map<string, IdentityMatch>;
//# sourceMappingURL=identity.d.ts.map