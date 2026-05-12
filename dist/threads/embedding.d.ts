/**
 * Hash-fingerprint pseudo-embedding (Phase D, optional semantic tier).
 *
 * ## What this is — and what it isn't
 *
 * This is NOT a real semantic embedding. It does NOT understand synonyms,
 * does NOT cluster "deploy" and "rollout" together unless they happen to
 * share other tokens, and is NOT a substitute for a learned model.
 *
 * What it IS: a deterministic, dependency-free, fast bag-of-tokens
 * fingerprint. Each label is tokenized (same rules as identity.ts), each
 * token is hashed mod N (default 256), and we set the corresponding bit
 * in a Uint8Array. Two fingerprints can be compared via cosine similarity
 * over their bit-vectors.
 *
 * Why bother: the lexical Jaccard tier handles most cases (~80% of the
 * drift we expect). The remaining 20% is "labels share intent but no
 * tokens" — e.g., "GitHub PR" → "merge request". Real embeddings would
 * catch that, but we can't ship one with no deps. The fingerprint catches
 * a slightly different case: where labels share *most* tokens but the
 * Jaccard ratio is below 0.5 because of one extra word. Cosine over a
 * bit-vector is more forgiving than Jaccard for short noisy tokens.
 *
 * ## Honesty
 *
 * On randomly chosen unrelated label pairs the fingerprint cosine is near
 * 0; on related-but-reworded pairs it's typically 0.3–0.7. We treat ≥0.55
 * as a match. False positives DO happen (cosine collisions in N=256). The
 * matcher uses fingerprint as a TERTIARY tier — exact-id and Jaccard get
 * first crack, so collisions only matter when the LLM's drift skipped both.
 *
 * If we ever want a real semantic tier, swap this module out — the public
 * API (`fingerprint`, `fingerprintCosine`) is small enough.
 */
/**
 * Default fingerprint dimensionality. 256 keeps the per-label payload at
 * 32 bytes (256 bits / 8). Doubling to 512 cuts collision rate roughly in
 * half but is overkill for label-similarity at this scale.
 */
export declare const DEFAULT_DIMS = 256;
/**
 * Build a bit-vector fingerprint of a label.
 *
 * Steps:
 *   1. Tokenize (same rules as identity.ts).
 *   2. For each token, take a stable hash (SHA-1, truncated to 32 bits)
 *      and reduce mod `dims`.
 *   3. Set the corresponding bit.
 *
 * Returns a Uint8Array of length `dims/8` (8 bits per byte).
 *
 * Determinism: SHA-1 is deterministic; same label always produces the same
 * fingerprint. Tested in tests/embedding.test.ts.
 */
export declare function fingerprint(label: string, dims?: number): Uint8Array;
/**
 * Cosine similarity between two bit-vectors. Treats bits as components in
 * {0,1}^dims. With binary vectors:
 *
 *     cos(a, b) = popcount(a AND b) / sqrt(popcount(a) * popcount(b))
 *
 * Returns 0 when either vector is empty (no set bits) — same convention as
 * Jaccard.
 *
 * Throws if the two vectors are different lengths (programming error).
 */
export declare function fingerprintCosine(a: Uint8Array, b: Uint8Array): number;
//# sourceMappingURL=embedding.d.ts.map