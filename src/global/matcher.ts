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
import { jaccard, tokenize } from '../threads/identity.js';
import { fingerprint, fingerprintCosine } from '../threads/embedding.js';

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

const DEFAULT_LEXICAL_THRESHOLD = 0.5;
const DEFAULT_SEMANTIC_THRESHOLD = 0.55;
const DEFAULT_MIN_LEXICAL_TOKENS = 3;

/**
 * Resolve a candidate to its canonical_id (or report "none").
 *
 * Walks records reverse-chronologically and stops at the first hit per
 * tier. Higher tiers always beat lower tiers (exact-id beats lexical
 * regardless of recency).
 */
export function findCanonicalThread(
  candidate: { thread_id: string; label: string },
  globalRecords: ReadonlyArray<GlobalThreadRecord>,
  options: MatchOptions = {},
): CrossSessionMatch {
  if (globalRecords.length === 0) {
    return { match_strategy: 'none', confidence: 0 };
  }

  const lexThreshold = options.lexicalThreshold ?? DEFAULT_LEXICAL_THRESHOLD;
  const semThreshold = options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
  const minTokens = options.minLexicalTokens ?? DEFAULT_MIN_LEXICAL_TOKENS;

  // Sort by ts descending. Don't mutate caller's array.
  const sorted = [...globalRecords].sort((a, b) =>
    (b.ts || '').localeCompare(a.ts || ''),
  );

  // Tier 1: exact-id. We check both thread_id and canonical_id because the
  // candidate's id might match either an alias or the canonical itself.
  for (const r of sorted) {
    if (options.excludeSessionId && r.session_id === options.excludeSessionId)
      continue;
    if (r.thread_id === candidate.thread_id) {
      return {
        canonical_id: r.canonical_id ?? r.thread_id,
        match_strategy: 'exact-id',
        confidence: 1.0,
        contributing_record: r,
      };
    }
    if (r.canonical_id && r.canonical_id === candidate.thread_id) {
      return {
        canonical_id: r.canonical_id,
        match_strategy: 'exact-id',
        confidence: 1.0,
        contributing_record: r,
      };
    }
  }

  // Tier 2: lexical (Jaccard).
  const candTokens = tokenize(candidate.label);
  if (candTokens.size >= minTokens) {
    let best: { r: GlobalThreadRecord; score: number } | undefined;
    for (const r of sorted) {
      if (options.excludeSessionId && r.session_id === options.excludeSessionId)
        continue;
      const recTokens = tokenize(r.label);
      if (recTokens.size < minTokens) continue;
      const score = jaccard(candTokens, recTokens);
      if (score >= lexThreshold && (!best || score > best.score)) {
        best = { r, score };
      }
    }
    if (best) {
      return {
        canonical_id: best.r.canonical_id ?? best.r.thread_id,
        match_strategy: 'lexical',
        confidence: best.score,
        contributing_record: best.r,
      };
    }
  }

  // Tier 3: semantic (opt-in). Only fires when explicitly enabled because
  // hash fingerprints across the cross-session label space are noisy.
  if (options.useEmbedding) {
    const candFp = fingerprint(candidate.label);
    let best: { r: GlobalThreadRecord; score: number } | undefined;
    for (const r of sorted) {
      if (options.excludeSessionId && r.session_id === options.excludeSessionId)
        continue;
      const score = fingerprintCosine(candFp, fingerprint(r.label));
      if (score >= semThreshold && (!best || score > best.score)) {
        best = { r, score };
      }
    }
    if (best) {
      return {
        canonical_id: best.r.canonical_id ?? best.r.thread_id,
        match_strategy: 'semantic',
        confidence: best.score,
        contributing_record: best.r,
      };
    }
  }

  return { match_strategy: 'none', confidence: 0 };
}

/**
 * Resolve canonical_ids for a batch of candidates. Convenience wrapper —
 * walks the records once per candidate (the records list is small enough
 * that O(N*M) is fine in practice; max-5 sub-threads × ~1k records).
 */
export function findCanonicalThreadsBatch(
  candidates: ReadonlyArray<{ thread_id: string; label: string }>,
  globalRecords: ReadonlyArray<GlobalThreadRecord>,
  options: MatchOptions = {},
): Map<string, CrossSessionMatch> {
  const out = new Map<string, CrossSessionMatch>();
  for (const c of candidates) {
    out.set(c.thread_id, findCanonicalThread(c, globalRecords, options));
  }
  return out;
}
