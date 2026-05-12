/**
 * Temporal decay weighting for compaction summaries.
 *
 * Weights govern how much each previous compaction summary influences
 * the new summary. Higher weight = more influence. Lower weight = older
 * context that should only be retained if still relevant.
 *
 * Example: weights [1.0, 0.6, 0.3] applied to the last 3 summaries means:
 *   - Most recent summary: 100% influence (reference heavily)
 *   - Previous summary: 60% influence (retain still-relevant threads)
 *   - Oldest summary: 30% influence (background context only)
 */
/**
 * Pair previous compaction summaries with their temporal decay weights.
 *
 * @param summaries - Previous summaries, most recent FIRST
 * @param weights - Weight per slot, most recent first (e.g. [1.0, 0.6, 0.3])
 * @returns Array of WeightedSummary objects, most recent first
 */
export function weightSummaries(summaries, weights) {
    if (summaries.length === 0)
        return [];
    return summaries.slice(0, weights.length).map((summary, i) => {
        const weight = weights[i] ?? 0;
        const label = i === 0
            ? `Previous summary (weight ${weight} — most recent)`
            : `Earlier summary (weight ${weight}${i === summaries.length - 1 && summaries.length > 1 ? ' — oldest context' : ''})`;
        return { summary, weight, label };
    });
}
/**
 * Classify sub-threads across a window of v2 metas using exact id matching.
 *
 * @param metas - Most-recent-first array of v2 metas (length 2-N)
 * @returns Per-thread classification
 */
export function classifyThreadsV2(metas) {
    if (metas.length === 0)
        return [];
    // Build per-thread appearance map
    const appearancesById = new Map();
    for (let i = 0; i < metas.length; i++) {
        for (const sub of metas[i].sub) {
            const existing = appearancesById.get(sub.id);
            if (existing) {
                existing.appearances += 1;
            }
            else {
                appearancesById.set(sub.id, {
                    label: sub.label,
                    appearances: 1,
                    firstSlot: i,
                    latestStatus: sub.status,
                });
            }
        }
    }
    const threshold = Math.max(2, Math.ceil(metas.length / 2));
    const result = [];
    for (const [id, info] of appearancesById) {
        let classification;
        const inMostRecent = metas[0].sub.some((s) => s.id === id);
        if (info.appearances >= threshold && inMostRecent) {
            classification = 'core';
        }
        else if (info.firstSlot === 0 && info.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        result.push({
            id,
            label: info.label,
            classification,
            appearances: info.appearances,
            latestStatus: info.latestStatus,
        });
    }
    return result;
}
/**
 * Classify sub-threads via substring matching on labels (v1 fallback path).
 *
 * Match rule: two labels A and B count as the same thread iff one contains
 * the other as a substring AND the shared length is ≥ 50% of the shorter.
 * This is the fuzzy heuristic from the strategic analysis — brittle, but
 * the best we can do without `id`s.
 *
 * @param metasAsLabels - Most-recent-first array of sub-thread label arrays
 * @returns Per-thread classification (id is the canonical label from the
 *          most recent appearance)
 */
export function classifyThreadsV1Fallback(metasAsLabels) {
    if (metasAsLabels.length === 0)
        return [];
    const norm = (s) => s.trim().toLowerCase();
    const isMatch = (a, b) => {
        const A = norm(a);
        const B = norm(b);
        if (!A || !B)
            return false;
        if (A === B)
            return true;
        const shorter = A.length < B.length ? A : B;
        const longer = A.length < B.length ? B : A;
        if (!longer.includes(shorter))
            return false;
        return shorter.length >= Math.ceil(longer.length / 2);
    };
    // Walk most-recent first, assigning each thread to a canonical id (the
    // label as first seen). Any subsequent label that matches is folded in.
    const canonical = [];
    for (let i = 0; i < metasAsLabels.length; i++) {
        for (const label of metasAsLabels[i]) {
            const trimmed = label.trim();
            if (!trimmed || trimmed.toLowerCase() === 'idle')
                continue;
            const existing = canonical.find((c) => isMatch(c.id, trimmed));
            if (existing) {
                existing.appearances += 1;
            }
            else {
                canonical.push({ id: trimmed, appearances: 1, firstSlot: i });
            }
        }
    }
    const threshold = Math.max(2, Math.ceil(metasAsLabels.length / 2));
    return canonical.map((c) => {
        let classification;
        const inMostRecent = metasAsLabels[0].some((l) => isMatch(c.id, l));
        if (c.appearances >= threshold && inMostRecent) {
            classification = 'core';
        }
        else if (c.firstSlot === 0 && c.appearances === 1) {
            classification = 'fresh';
        }
        else {
            classification = 'fading';
        }
        return {
            id: c.id,
            label: c.id,
            classification,
            appearances: c.appearances,
        };
    });
}
//# sourceMappingURL=weight.js.map