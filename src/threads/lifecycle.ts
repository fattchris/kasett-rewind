/**
 * Lifecycle event detection (Phase D).
 *
 * Given the matcher output (current → previous matches) and the two thread
 * sets, derive a list of LifecycleEvents that describe how threads evolved
 * between compaction N-1 and N:
 *
 *   - created   — present in `current` but no match in `previous`
 *   - completed — present in `previous`, missing from `current`, status
 *                 was active/blocked → assumed completed (we can't
 *                 distinguish from "abandoned" without more context)
 *   - blocked   — status transitioned to blocked
 *   - renamed   — matched but label changed (matcher.evolved=true)
 *   - merged    — multiple `previous` threads matched onto one `current`
 *   - split     — one `previous` thread matched by multiple `current`
 *                 (rare; happens when the matcher's lexical/semantic tier
 *                 picks the same predecessor for two new threads)
 *
 * ## Advisory only
 *
 * These are hints for the steering prompt and the daily report. We do NOT
 * fail flow when classification is uncertain — we omit the event. The
 * downstream consumers (steering.ts, daily-compaction-review.sh) treat
 * absence as "no signal" rather than "no change".
 *
 * ## Edge cases
 *
 *   - A thread with `status: 'completed'` in `previous` that's gone in
 *     `current` is NOT re-emitted as a `completed` event (it already was).
 *   - A thread with `status: 'fading'` going missing is treated as gone,
 *     not as a fresh `completed` event.
 *   - When the matcher reports `matched_to` for multiple `current` threads
 *     pointing at the SAME previous, that's a split. When multiple
 *     previous match into one current, that's a merge.
 */

import type { ThreadSubV2 } from './schema.js';
import type { IdentityMatch } from './identity.js';
import { tokenize, jaccard } from './identity.js';

export type LifecycleEvent =
  | { kind: 'created'; thread_id: string; label: string }
  | { kind: 'completed'; thread_id: string; label: string }
  | { kind: 'blocked'; thread_id: string; label: string }
  | {
      kind: 'renamed';
      from_id: string;
      to_id: string;
      from_label: string;
      to_label: string;
      strategy: IdentityMatch['strategy'];
      confidence: number;
    }
  | { kind: 'merged'; from_ids: string[]; into_id: string }
  | { kind: 'split'; from_id: string; into_ids: string[] };

/**
 * Detect lifecycle events between two compactions.
 *
 * @param previous — sub-threads from compaction N-1 (most recent before)
 * @param current  — sub-threads from compaction N
 * @param matches  — Map keyed by current.id → IdentityMatch (from
 *                   identity.matchAllThreads)
 */
export function detectLifecycleEvents(
  previous: ReadonlyArray<ThreadSubV2>,
  current: ReadonlyArray<ThreadSubV2>,
  matches: ReadonlyMap<string, IdentityMatch>,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];

  const prevById = new Map<string, ThreadSubV2>();
  for (const p of previous) prevById.set(p.id, p);

  // Build a label-similarity fallback map: current.id → best previous thread
  // by Jaccard token overlap (threshold 0.1 — looser than the identity tier
  // which uses 0.5, to catch high-turnover regimes where even 0.1 overlap
  // is meaningful continuity signal).
  //
  // Used for `blocked` detection: in real-world compactions the LLM mints
  // 100% fresh IDs every compaction, so exact-id matches never fire, and
  // even Jaccard-0.5 rarely fires on short labels. Without this fallback,
  // `blocked` events are NEVER detected (confirmed by 2026-05-21 analysis).
  //
  // The label-similarity fallback is used ONLY for blocked detection, not
  // for rename/merge/split (which require higher confidence).
  const labelSimilarityFallback = new Map<string, string>(); // current.id → prev.id
  for (const c of current) {
    if (matches.get(c.id)?.strategy !== 'none') continue; // already matched
    const curTok = tokenize(c.label);
    let bestScore = 0;
    let bestPrevId: string | undefined;
    for (const p of previous) {
      const score = jaccard(curTok, tokenize(p.label));
      if (score > bestScore) {
        bestScore = score;
        bestPrevId = p.id;
      }
    }
    // Any non-zero overlap (>= 0.1 requires at least one shared token) is
    // used as a weak match for blocked detection. We do NOT emit a rename
    // event from this — only blocked.
    if (bestScore >= 0.1 && bestPrevId) {
      labelSimilarityFallback.set(c.id, bestPrevId);
    }
  }

  // Build reverse map: previous_id -> current_ids that matched it. Used
  // for split detection.
  const prevToCurrent = new Map<string, string[]>();
  for (const c of current) {
    const m = matches.get(c.id);
    if (!m || m.strategy === 'none' || !m.matched_to) continue;
    const list = prevToCurrent.get(m.matched_to);
    if (list) list.push(c.id);
    else prevToCurrent.set(m.matched_to, [c.id]);
  }

  // Build forward map: current_id -> previous_ids that matched into it.
  // For exact-id matches there's only one, but lexical/semantic could pick
  // the same current as the best fit for multiple previous if we ran the
  // matcher in reverse. We don't currently — but to detect merges, we walk
  // previous and ask "what current did each fall into?" — using the same
  // matcher.
  //
  // Rather than re-run the matcher reversed (more allocations), we infer
  // merges by counting how many previous IDs share the same matched
  // current. We do that via the matches Map: for current C with
  // matched_to=P, P is one predecessor. To detect merges we ALSO need to
  // know if any OTHER previous thread is "a predecessor" of C. The matches
  // Map only records ONE matched_to per current — so we can't see merges
  // through it directly without additional info.
  //
  // We solve this by walking previous threads that aren't matched_to of
  // any current AS A SOLO — and checking if they would best-match the
  // same current that another previous already maps into.
  //
  // Lightweight: for each previous with no current matching to it, find
  // any current whose matched_to belongs to a "different but related"
  // previous (label overlap). If the unmapped previous shares ≥0.5 jaccard
  // with the matched current's label, treat as merge.
  //
  // To keep this tractable and honest, we implement merge detection
  // conservatively: a merge is reported when the unmatched-previous label
  // is a strict substring of the current label (case-insensitive trim) or
  // vice versa. This is a HEURISTIC — over-detection is worse than under-
  // detection for advisory output.

  // First: created/renamed/completed/blocked from the explicit matches.
  const matchedPrevIds = new Set<string>();
  for (const c of current) {
    const m = matches.get(c.id);
    if (!m || m.strategy === 'none') {
      events.push({ kind: 'created', thread_id: c.id, label: c.label });
      continue;
    }
    if (m.matched_to) matchedPrevIds.add(m.matched_to);

    const prev = m.matched_to ? prevById.get(m.matched_to) : undefined;
    if (m.evolved && prev) {
      events.push({
        kind: 'renamed',
        from_id: prev.id,
        to_id: c.id,
        from_label: prev.label,
        to_label: c.label,
        strategy: m.strategy,
        confidence: m.confidence,
      });
    }

    // Status transition: previous active → current blocked
    // Primary path: explicit match via exact-id or lexical tier.
    if (prev && prev.status !== 'blocked' && c.status === 'blocked') {
      events.push({ kind: 'blocked', thread_id: c.id, label: c.label });
    }
    // Status transition: completed
    if (prev && prev.status !== 'completed' && c.status === 'completed') {
      events.push({ kind: 'completed', thread_id: c.id, label: c.label });
    }
  }

  // Label-similarity fallback for `blocked` detection (Fix 3).
  //
  // In high-turnover regimes (LLM mints 100% fresh IDs every compaction),
  // exact-id matches never fire and lexical-0.5 rarely fires on short labels.
  // Without this fallback, `blocked` events are never detected.
  //
  // Scope: only applies to threads that were NOT matched by the primary
  // matcher (strategy === 'none'). For matched threads, the primary blocked
  // detection path already handles them correctly (including stable-blocked
  // suppression via prev.status !== 'blocked' check).
  //
  // For each unmatched-current thread with status=blocked, check the
  // label-similarity fallback map:
  //   - If fallback found a previous thread that was NOT blocked → emit blocked.
  //   - If fallback found NO previous thread (genuinely new) → emit blocked.
  //   - If fallback found a previous thread that WAS blocked → suppress (stable).
  const blockedEventIds = new Set(events.filter((e) => e.kind === 'blocked').map((e) => {
    if (e.kind === 'blocked') return e.thread_id;
    return '';
  }));
  // Track which current threads were matched by the primary matcher.
  const primaryMatchedCurrentIds = new Set<string>();
  for (const c of current) {
    const m = matches.get(c.id);
    if (m && m.strategy !== 'none') primaryMatchedCurrentIds.add(c.id);
  }
  for (const c of current) {
    if (c.status !== 'blocked') continue;
    if (blockedEventIds.has(c.id)) continue; // already emitted via primary path
    if (primaryMatchedCurrentIds.has(c.id)) continue; // handled by primary path (suppressed correctly)
    // Only unmatched threads reach here (strategy === 'none' in primary matcher).
    const fallbackPrevId = labelSimilarityFallback.get(c.id);
    const fallbackPrev = fallbackPrevId ? prevById.get(fallbackPrevId) : undefined;
    if (fallbackPrev && fallbackPrev.status === 'blocked') {
      // Previous was already blocked — suppress (stable blocked state, not a new event).
      continue;
    }
    // Either fallbackPrev was not blocked, or there's no fallback evidence
    // at all (new thread showing up already blocked) — emit blocked event.
    events.push({ kind: 'blocked', thread_id: c.id, label: c.label });
  }

  // Threads in previous with no corresponding current → completed (only
  // if their previous status wasn't already completed/fading).
  for (const p of previous) {
    if (matchedPrevIds.has(p.id)) continue;
    if (p.status === 'completed' || p.status === 'fading') continue;
    events.push({ kind: 'completed', thread_id: p.id, label: p.label });
  }

  // Splits: one previous matched by multiple currents.
  for (const [prevId, curIds] of prevToCurrent) {
    if (curIds.length >= 2) {
      events.push({ kind: 'split', from_id: prevId, into_ids: curIds });
    }
  }

  // Merges (heuristic): for each current, count how many previous threads
  // either (a) explicitly matched into it OR (b) have a label that is a
  // case-insensitive substring of current.label (or vice versa).
  for (const c of current) {
    const directMatched = c;
    const directMatch = matches.get(c.id);
    const explicit = directMatch?.matched_to;
    const candidates = new Set<string>();
    if (explicit) candidates.add(explicit);

    const cLabel = directMatched.label.trim().toLowerCase();
    if (cLabel.length === 0) continue;

    for (const p of previous) {
      if (p.id === explicit) continue;
      // Skip previous threads already accounted for as predecessors of
      // OTHER currents — those are not merging into c.
      if (matchedPrevIds.has(p.id) && !candidates.has(p.id)) continue;
      const pLabel = p.label.trim().toLowerCase();
      if (pLabel.length === 0) continue;
      if (cLabel === pLabel) continue; // identical labels = exact-id should have caught it
      const shorter = cLabel.length < pLabel.length ? cLabel : pLabel;
      const longer = cLabel.length < pLabel.length ? pLabel : cLabel;
      if (longer.includes(shorter) && shorter.length >= 4) {
        candidates.add(p.id);
      }
    }

    if (candidates.size >= 2) {
      events.push({
        kind: 'merged',
        from_ids: Array.from(candidates).sort(),
        into_id: c.id,
      });
    }
  }

  return events;
}

/**
 * Tally lifecycle events into per-kind counts. Used by the identity report
 * and the daily review.
 */
export function summarizeLifecycle(
  events: ReadonlyArray<LifecycleEvent>,
): Record<LifecycleEvent['kind'], number> {
  const out: Record<LifecycleEvent['kind'], number> = {
    created: 0,
    completed: 0,
    blocked: 0,
    renamed: 0,
    merged: 0,
    split: 0,
  };
  for (const e of events) out[e.kind] += 1;
  return out;
}
