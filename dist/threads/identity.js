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
import { fingerprint, fingerprintCosine } from './embedding.js';
const DEFAULT_LEXICAL_THRESHOLD = 0.5;
const DEFAULT_SEMANTIC_THRESHOLD = 0.55;
// ---------------------------------------------------------------------------
// Tokenization + Jaccard
// ---------------------------------------------------------------------------
/**
 * Common English stopwords plus a few connector tokens that hurt Jaccard
 * signal for short labels (e.g. "deploy to prod" vs "deploy on prod").
 */
const STOPWORDS = new Set([
    'the',
    'a',
    'an',
    'to',
    'of',
    'for',
    'in',
    'on',
    'and',
    'or',
    'with',
    'is',
    'was',
    'are',
    'this',
    'that',
    'be',
    'by',
    'at',
    'as',
    'it',
]);
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
export function tokenize(s) {
    return new Set(s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}
/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when either set is
 * empty (avoids spurious NaN-via-zero-division and avoids matching two
 * empty sets as identical).
 */
export function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
// ---------------------------------------------------------------------------
// Multi-tier matcher
// ---------------------------------------------------------------------------
/**
 * Pick the best matching previous thread for `current` using the multi-tier
 * strategy described at the top of this file.
 *
 * Returns `{ strategy: 'none', confidence: 0 }` when no previous thread
 * exceeds any threshold — caller treats this as a brand-new thread.
 */
export function matchThread(current, previous, options = {}) {
    if (previous.length === 0) {
        return { strategy: 'none', confidence: 0 };
    }
    // Tier 1: exact ID match
    const idHit = previous.find((p) => p.id === current.id);
    if (idHit) {
        return {
            strategy: 'exact-id',
            confidence: 1.0,
            matched_to: idHit.id,
            evolved: idHit.label !== current.label,
        };
    }
    const lexThreshold = options.lexicalThreshold ?? DEFAULT_LEXICAL_THRESHOLD;
    const semThreshold = options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
    // Tier 2: lexical (Jaccard on label tokens)
    const curTokens = tokenize(current.label);
    let bestLex;
    for (const p of previous) {
        const score = jaccard(curTokens, tokenize(p.label));
        if (score >= lexThreshold && (!bestLex || score > bestLex.score)) {
            bestLex = { p, score };
        }
    }
    if (bestLex) {
        return {
            strategy: 'lexical',
            confidence: bestLex.score,
            matched_to: bestLex.p.id,
            evolved: true, // ID didn't match → label changed by definition
        };
    }
    // Tier 3: semantic (hash-fingerprint cosine)
    if (options.useEmbedding) {
        const curFp = fingerprint(current.label);
        let bestSem;
        for (const p of previous) {
            const score = fingerprintCosine(curFp, fingerprint(p.label));
            if (score >= semThreshold && (!bestSem || score > bestSem.score)) {
                bestSem = { p, score };
            }
        }
        if (bestSem) {
            return {
                strategy: 'semantic',
                confidence: bestSem.score,
                matched_to: bestSem.p.id,
                evolved: true,
            };
        }
    }
    return { strategy: 'none', confidence: 0 };
}
/**
 * Match every thread in `current` against `previous`. Returns a Map keyed
 * by `current[i].id` so lifecycle.ts can do its book-keeping.
 *
 * Note: this is N×M where N = current count, M = previous count. With max-5
 * sub-threads per compaction (see schema.ts MAX_SUB), it's a constant
 * 25-comparison loop. No performance concern.
 */
export function matchAllThreads(current, previous, options = {}) {
    const out = new Map();
    for (const c of current) {
        out.set(c.id, matchThread(c, previous, options));
    }
    return out;
}
//# sourceMappingURL=identity.js.map